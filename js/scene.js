// Document model: a flat list of top-level objects (groups nest children), undo history and selection.
import { trs, mul, invert, decompose } from './math.js';
import { localGeometry, renderData, setMeshStore } from './kernel.js';

let nextId = 1;
export const uid = () => `o${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const PALETTE = ['#2F9C95', '#E4A23A', '#4F7CDB', '#D9534F', '#7FB04A', '#9B6BD3', '#E0789B', '#5F6B7A', '#F2D04B', '#3BB5D9'];
let colorIdx = 0;
export const nextColor = () => PALETTE[colorIdx++ % PALETTE.length];

class Emitter {
  constructor() { this.l = {}; }
  on(e, f) { (this.l[e] ||= []).push(f); return () => { this.l[e] = this.l[e].filter((x) => x !== f); }; }
  emit(e, ...a) { (this.l[e] || []).forEach((f) => f(...a)); }
}

export class Scene extends Emitter {
  constructor() {
    super();
    this.meshes = new Map(); // meshId -> {v: Float32Array, t: Uint32Array}
    setMeshStore(this.meshes);
    this.reset();
  }
  reset() {
    this.name = 'Untitled design';
    this.objects = [];
    this.selection = new Set();
    this.undoStack = []; this.redoStack = [];
    this.settings = { printer: 'bambu-lab-x1-carbon', snap: 1, material: 'pla', infill: 15, walls: 2, layer: 0.2, overhang: 45, units: 'mm' };
    this.emit('change', { structure: true });
  }

  // ------------------------------------------------ queries
  get(id) { return this.objects.find((o) => o.id === id); }
  selected() { return this.objects.filter((o) => this.selection.has(o.id)); }
  /** Local geometry entry + render data, or {error}. */
  geometry(obj) {
    try { const e = localGeometry(obj); renderData(e); obj._error = null; return e; }
    catch (err) { obj._error = err.message || String(err); return null; }
  }
  matrix(obj) { return trs(obj.pos, obj.rot, obj.scale); }
  worldBox(obj) {
    const e = this.geometry(obj); if (!e) return null;
    const { min, max } = e.render.bbox; const m = this.matrix(obj);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    // Use the hull of transformed vertices for a tight box when rotated.
    const P = e.render.P; const step = P.length > 30000 ? Math.ceil(P.length / 30000) * 3 : 3;
    for (let i = 0; i < P.length; i += step) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < lo[0]) lo[0] = wx; if (wy < lo[1]) lo[1] = wy; if (wz < lo[2]) lo[2] = wz;
      if (wx > hi[0]) hi[0] = wx; if (wy > hi[1]) hi[1] = wy; if (wz > hi[2]) hi[2] = wz;
    }
    void min; void max;
    return { min: lo, max: hi };
  }
  selectionBox(list = this.selected()) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], any = false;
    for (const o of list) { const b = this.worldBox(o); if (!b) continue; any = true; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min[i]); hi[i] = Math.max(hi[i], b.max[i]); } }
    return any ? { min: lo, max: hi } : null;
  }

  // ------------------------------------------------ history
  snapshot() { return JSON.stringify({ objects: this.objects.map(strip), name: this.name, settings: this.settings }); }
  restore(snap) {
    const s = JSON.parse(snap); this.objects = s.objects; this.name = s.name; this.settings = s.settings;
    const ids = new Set(this.objects.map((o) => o.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.emit('change', { structure: true }); this.emit('select');
  }
  /** Run fn as one undoable step. */
  edit(label, fn, opts = {}) {
    const before = this.snapshot();
    const r = fn();
    this.undoStack.push({ label, snap: before }); if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.emit('change', { structure: opts.structure !== false, label });
    return r;
  }
  /** Begin a continuous edit (e.g. dragging); call commit() at the end. */
  begin(label) { this._pending = { label, snap: this.snapshot() }; }
  commit() {
    if (!this._pending) return;
    if (this._pending.snap !== this.snapshot()) { this.undoStack.push(this._pending); this.redoStack = []; this.dirty = true; }
    this._pending = null; this.emit('change', { structure: true });
  }
  undo() { const s = this.undoStack.pop(); if (!s) return; this.redoStack.push({ label: s.label, snap: this.snapshot() }); this.restore(s.snap); this.emit('toast', `Undid ${s.label}`); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.undoStack.push({ label: s.label, snap: this.snapshot() }); this.restore(s.snap); this.emit('toast', `Redid ${s.label}`); }

  // ------------------------------------------------ selection
  select(ids, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of [].concat(ids)) { if (additive && this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); }
    this.emit('select');
  }
  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit('select'); } }

  // ------------------------------------------------ mutations
  add(obj, { select = true, label = `add ${obj.name}`, drop = true } = {}) {
    return this.edit(label, () => {
      this.objects.push(obj);
      if (drop) this.dropToPlate([obj], true);
      if (select) { this.selection.clear(); this.selection.add(obj.id); this.emit('select'); }
      return obj;
    });
  }
  remove(ids) {
    const set = new Set(ids); if (!set.size) return;
    this.edit('delete', () => { this.objects = this.objects.filter((o) => !set.has(o.id)); ids.forEach((i) => this.selection.delete(i)); });
    this.emit('select');
  }
  duplicate(ids, offset = [10, 10, 0]) {
    const copies = [];
    this.edit('duplicate', () => {
      for (const id of ids) { const o = this.get(id); if (!o) continue; const c = cloneObj(o); c.pos = [o.pos[0] + offset[0], o.pos[1] + offset[1], o.pos[2] + offset[2]]; c.name = o.name; this.objects.push(c); copies.push(c); }
      this.selection = new Set(copies.map((c) => c.id));
    });
    this.emit('select');
    return copies;
  }
  group(ids) {
    const list = ids.map((i) => this.get(i)).filter(Boolean);
    if (list.length < 2) return null;
    if (!list.some((o) => !o.hole)) { this.emit('toast', 'A group needs at least one solid. Turn one shape back into a solid first.'); return null; }
    const box = this.selectionBox(list); const c = box.min.map((v, i) => (v + box.max[i]) / 2);
    let g;
    this.edit('group', () => {
      const children = list.map((o) => ({ ...o, pos: [o.pos[0] - c[0], o.pos[1] - c[1], o.pos[2] - c[2]] }));
      g = { id: uid(), type: 'group', name: 'Group', color: list.find((o) => !o.hole)?.color || nextColor(), hole: false, visible: true, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], children };
      // Geometry is not re-centred for groups; recentre now.
      const idx = Math.min(...list.map((o) => this.objects.indexOf(o)));
      this.objects = this.objects.filter((o) => !ids.includes(o.id));
      this.objects.splice(idx, 0, g);
      g.pos = c;
      this.selection = new Set([g.id]);
    });
    this.emit('select');
    return g;
  }
  ungroup(ids) {
    const out = [];
    this.edit('ungroup', () => {
      for (const id of ids) {
        const g = this.get(id); if (!g || g.type !== 'group') continue;
        const G = this.matrix(g); const idx = this.objects.indexOf(g);
        const kids = g.children.map((ch) => {
          const d = decompose(mul(G, trs(ch.pos, ch.rot, ch.scale)));
          if (d) return { ...ch, pos: d.pos, rot: d.rot, scale: d.scale };
          return { ...ch, pos: [...g.pos], rot: [...g.rot], scale: [...g.scale] }; // fallback; sheared transforms are kept approximate
        });
        this.objects.splice(idx, 1, ...kids); out.push(...kids);
      }
      this.selection = new Set(out.map((o) => o.id));
    });
    this.emit('select');
    return out;
  }
  update(id, patch, label = 'edit') { this.edit(label, () => { const o = this.get(id); Object.assign(o, patch); }); }
  /** Move selection so its lowest point sits on the plate. */
  dropToPlate(list = this.selected(), silent = false) {
    const f = () => { for (const o of list) { const b = this.worldBox(o); if (b) o.pos = [o.pos[0], o.pos[1], o.pos[2] - b.min[2]]; } };
    if (silent) f(); else this.edit('drop to plate', f);
  }
  /** Express the inverse of world matrix (for picking). */
  inverse(obj) { return invert(this.matrix(obj)); }

  // ------------------------------------------------ persistence
  toJSON() {
    const used = new Set(); const walk = (o) => { if (o.type === 'mesh') used.add(o.meshId); (o.children || []).forEach(walk); };
    this.objects.forEach(walk);
    const meshes = {};
    for (const id of used) { const m = this.meshes.get(id); if (m) meshes[id] = { v: b64(new Uint8Array(m.v.buffer, m.v.byteOffset, m.v.byteLength)), t: b64(new Uint8Array(m.t.buffer, m.t.byteOffset, m.t.byteLength)) }; }
    return { app: 'printforge', version: 1, name: this.name, settings: this.settings, objects: this.objects.map(strip), meshes };
  }
  load(data) {
    if (!data || !Array.isArray(data.objects)) throw new Error('This file is not a PrintForge project.');
    this.reset();
    for (const [id, m] of Object.entries(data.meshes || {})) this.meshes.set(id, { v: new Float32Array(unb64(m.v).buffer), t: new Uint32Array(unb64(m.t).buffer) });
    this.objects = data.objects; this.name = data.name || 'Untitled design';
    this.settings = { ...this.settings, ...(data.settings || {}) };
    this.emit('change', { structure: true }); this.emit('select');
  }
}

export function strip(o) {
  const c = {}; for (const k in o) if (!k.startsWith('_')) c[k] = o[k];
  if (c.children) c.children = c.children.map(strip);
  return JSON.parse(JSON.stringify(c));
}
export function cloneObj(o) { const c = strip(o); const re = (x) => { x.id = uid(); (x.children || []).forEach(re); }; re(c); return c; }

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

export function makeShape(kind, params, extra = {}) {
  return { id: uid(), type: 'shape', kind, name: extra.name || kind, params, color: extra.color || nextColor(), hole: !!extra.hole, visible: true, pos: extra.pos || [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
}
