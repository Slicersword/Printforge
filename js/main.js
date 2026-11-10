import { initKernel, K, worldManifold, localGeometry, free, kindDef } from './kernel.js';
import { Scene, makeShape, uid, nextColor, cloneObj } from './scene.js';
import { SHAPES, defaults } from './shapes.js';
import { Viewport } from './viewport.js';
import { Library, shapesTab, renderOutline, renderInspector, renderSelbar, h, axisMap, numField, row } from './ui.js';
import { PRINTERS, printerById } from './printers.js';
import { toSTL, toOBJ, to3MF, zip, importFile, download } from './io.js';
import { eulerMatrix, transformDir, fmt, eulerFromMatrix } from './math.js';
import { hex } from './renderer.js';

const STORE_KEY = 'printforge.autosave.v1';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } } };

class App {
  constructor() { this.listeners = {}; this.mode = 'design'; this.lockRatio = false; this.plugins = []; }
  on(e, f) { (this.listeners[e] ||= []).push(f); }
  emit(e, ...a) { (this.listeners[e] || []).forEach((f) => f(...a)); }

  async start() {
    await initKernel();
    this.scene = new Scene();
    this.view = new Viewport(this, document.getElementById('view'));
    this.library = new Library(this);
    this.library.addTab('shapes', 'Shapes', shapesTab(this));
    for (const p of this.plugins) p(this);
    this._bindChrome();
    this.scene.on('change', () => this._changed());
    this.scene.on('select', () => this._selChanged());
    this.scene.on('toast', (m) => this.toast(m));
    this.on('measure', (on) => { document.getElementById('measureBtn').classList.toggle('on', on); if (on) this.toast('Click two points to measure. Esc to stop.'); });
    this.scene.on('select', () => { if (this._cut && !this.scene.selection.has(this._cut.id)) { this._cut = null; this.view.extraLines = null; } });
    this.applyTheme(store.get('printforge.theme'));
    this.applyPrinter();
    const saved = store.get(STORE_KEY);
    if (saved) { try { this.scene.load(JSON.parse(saved)); if (this.scene.objects.length) this.toast('Restored your last design'); } catch { /* ignore broken autosave */ } }
    this._changed(); this._selChanged();
    this.view.fit();
    document.getElementById('loading').classList.add('done');
    this.ready = true; this.emit('ready');
  }

  // ------------------------------------------------------------ change plumbing
  _changed() {
    const s = this.scene;
    document.getElementById('docName').value = s.name;
    document.getElementById('emptyHint').hidden = s.objects.length > 0;
    renderOutline(this); renderInspector(this); renderSelbar(this); this.renderStatus();
    this.view.redraw(); this.emit('change');
    clearTimeout(this._save); this._save = setTimeout(() => store.set(STORE_KEY, JSON.stringify(s.toJSON())), 600);
  }
  _selChanged() { renderOutline(this); renderInspector(this); renderSelbar(this); this.renderStatus(); this.view.redraw(); }
  refresh() { renderInspector(this); renderSelbar(this); renderOutline(this); }
  onLiveChange() { clearTimeout(this._live); this._live = setTimeout(() => { renderInspector(this); this.renderStatus(); }, 60); }

  renderStatus() {
    const s = this.scene; const el = document.getElementById('status'); const sel = s.selected();
    const box = sel.length ? s.selectionBox(sel) : null; const p = printerById(s.settings.printer);
    const items = [h('span', {}, h('b', {}, `${p.vendor} ${p.model}`), ` ${p.w}×${p.d}×${p.h} mm`)];
    if (box) items.push(h('span', {}, 'Selection ', h('b', {}, `${fmt(box.max[0] - box.min[0], 1)} × ${fmt(box.max[1] - box.min[1], 1)} × ${fmt(box.max[2] - box.min[2], 1)} mm`)));
    const errs = s.objects.filter((o) => o._error).length; if (errs) items.push(h('span', { class: 'warn' }, `${errs} shape(s) need attention`));
    const looseHoles = s.objects.filter((o) => o.hole && o.visible !== false).length;
    if (looseHoles && this.mode === 'design') items.push(h('span', {}, `${looseHoles} loose hole(s), group to cut`));
    items.push(h('span', { style: { marginLeft: 'auto' } }, `Snap ${s.settings.snap || 'off'}${s.settings.snap ? ' mm' : ''}`));
    el.replaceChildren(...items);
  }
  toast(msg, ms = 2200) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toast); this._toast = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ objects
  spawnPoint(size = 20, sizeY = size) {
    // Place new things near the view centre, on the plate, avoiding overlap with the selection.
    const t = this.view.r.cam.target; const b = this.view.r.bed;
    const boxes = this.scene.objects.filter((o) => o.visible !== false).map((o) => this.scene.worldBox(o)).filter(Boolean);
    const hx = size / 2 + 3, hy = sizeY / 2 + 3; const step = Math.max(10, Math.min(size, sizeY) / 2 + 6);
    const free = (x, y) => Math.abs(x) + hx <= b.w / 2 && Math.abs(y) + hy <= b.d / 2 && boxes.every((bb) => x + hx < bb.min[0] || x - hx > bb.max[0] || y + hy < bb.min[1] || y - hy > bb.max[1]);
    const cx = Math.round(t[0] / 5) * 5, cy = Math.round(t[1] / 5) * 5;
    for (let ring = 0; ring < 30; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const x = cx + i * step, y = cy + j * step; if (free(x, y)) return [x, y, 0];
    }
    // The plate is full: put it to the right of everything so nothing overlaps (the print check will flag it).
    const right = boxes.length ? Math.max(...boxes.map((bb) => bb.max[0])) : 0;
    return [Math.round(right + hx + 6), 0, 0];
  }
  addShape(kind, params, extra = {}) {
    const def = kindDef(kind) || { label: kind, params: [] };
    if (!params) { params = {}; for (const f of def.params || []) params[f.key] = f.def; }
    const o = makeShape(kind, params, { name: extra.name || def.label, hole: extra.hole ?? def.hole, color: extra.color });
    if (extra.pos) o.pos = extra.pos;
    else { const e = this.scene.geometry(o); const bb = e?.render.bbox; o.pos = bb ? this.spawnPoint(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) : this.spawnPoint(); }
    this.scene.add(o, { label: `add ${o.name.toLowerCase()}` });
    if (o._error) this.toast(o._error, 4000);
    this.closeDrawers();
    return o;
  }
  addMesh(name, v, t, color, pos) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]); }
    const c = lo.map((x, i) => (x + hi[i]) / 2); const vv = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 3) { vv[i] = v[i] - c[0]; vv[i + 1] = v[i + 1] - c[1]; vv[i + 2] = v[i + 2] - c[2]; }
    const meshId = 'm' + uid(); this.scene.meshes.set(meshId, { v: vv, t: new Uint32Array(t) });
    return { id: uid(), type: 'mesh', meshId, name, color: color || nextColor(), hole: false, visible: true, pos: pos || c, rot: [0, 0, 0], scale: [1, 1, 1] };
  }
  resize(o, axis, val, uniform) {
    const box = this.scene.worldBox(o); const cur = box.max[axis] - box.min[axis]; if (cur <= 1e-9) return;
    const f = val / cur; const map = axisMap(o);
    this.scene.edit('resize', () => {
      const wasOnPlate = Math.abs(box.min[2]) < 0.01;
      if (uniform) o.scale = o.scale.map((s) => s * f); else o.scale = o.scale.map((s, i) => (i === map[axis] ? s * f : s));
      const nb = this.scene.worldBox(o);
      // keep the bottom where it was
      o.pos = [o.pos[0], o.pos[1], o.pos[2] + (wasOnPlate ? -nb.min[2] : box.min[2] - nb.min[2])];
    });
  }
  /** Change shape parameters, keeping the part's bottom where it was. */
  setParams(o, params, label = 'change shape') {
    const s = this.scene; const before = s.worldBox(o);
    s.edit(label, () => { o.params = params; if (before) this._keepFloor(o, before); });
    if (o._error) this.toast(o._error, 4000);
  }
  rotateTo(o, axis, deg) { this.scene.edit('rotate', () => { const box = this.scene.worldBox(o); o.rot = o.rot.map((r, i) => (i === axis ? deg : r)); this._keepFloor(o, box); }); }
  rotateBy(list, axis, d) {
    this.scene.edit('rotate', () => {
      for (const o of list) {
        const box = this.scene.worldBox(o);
        // Compose in world space: R' = Rw * R, then convert back to Euler.
        const axisVec = [0, 0, 0]; axisVec[axis] = 1;
        const Rw = eulerMatrix(axisVec.map((a) => a * d)); const R = eulerMatrix(o.rot);
        const m = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += Rw[k * 4 + r] * R[c * 4 + k]; m[c * 4 + r] = s; }
        o.rot = eulerFromMatrix(m);
        this._keepFloor(o, box);
      }
    });
  }
  _keepFloor(o, oldBox) { const nb = this.scene.worldBox(o); if (!nb || !oldBox) return; o.pos = [o.pos[0], o.pos[1], o.pos[2] + oldBox.min[2] - nb.min[2]]; }
  mirror(axis) {
    const sel = this.scene.selected(); if (!sel.length) return;
    this.scene.edit('mirror', () => sel.forEach((o) => { const map = axisMap(o); o.scale = o.scale.map((s, i) => (i === map[axis] ? -s : s)); }));
  }
  align(axis, where) {
    const s = this.scene; const sel = s.selected(); const all = s.selectionBox(sel);
    const target = where < 0 ? all.min[axis] : where > 0 ? all.max[axis] : (all.min[axis] + all.max[axis]) / 2;
    s.edit('align', () => sel.forEach((o) => { const b = s.worldBox(o); const cur = where < 0 ? b.min[axis] : where > 0 ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2; o.pos[axis] += target - cur; o.pos = [...o.pos]; }));
  }
  distribute(axis) {
    const s = this.scene; const sel = s.selected(); if (sel.length < 3) { this.toast('Select three or more objects to space them evenly.'); return; }
    const boxes = sel.map((o) => ({ o, b: s.worldBox(o) })).sort((a, b) => a.b.min[axis] - b.b.min[axis]);
    const total = boxes.reduce((t, x) => t + x.b.max[axis] - x.b.min[axis], 0);
    const span = boxes[boxes.length - 1].b.max[axis] - boxes[0].b.min[axis]; const gap = (span - total) / (boxes.length - 1);
    s.edit('space evenly', () => { let cur = boxes[0].b.min[axis]; for (const { o, b } of boxes) { o.pos[axis] += cur - b.min[axis]; o.pos = [...o.pos]; cur += b.max[axis] - b.min[axis] + gap; } });
  }
  openEditor(o) {
    const def = o.type === 'shape' && this.editors?.[o.kind];
    if (def) def(o); else if (o.type === 'group') this.toast('Ungroup (Ctrl+Shift+G) to edit the shapes inside.');
  }

  // ------------------------------------------------------------ commands
  cmd(name) {
    const s = this.scene; const ids = [...s.selection];
    const need = () => { if (!ids.length) { this.toast('Select something first.'); return false; } return true; };
    switch (name) {
      case 'undo': s.undo(); break;
      case 'redo': s.redo(); break;
      case 'delete': if (need()) s.remove(ids); break;
      case 'duplicate': if (need()) s.duplicate(ids); break;
      case 'group': if (ids.length < 2) this.toast('Select two or more objects to group (Shift+click).'); else s.group(ids); break;
      case 'ungroup': s.ungroup(ids); break;
      case 'toggleHole': if (need()) { const all = s.selected().every((o) => o.hole); s.edit(all ? 'make solid' : 'make hole', () => s.selected().forEach((o) => { o.hole = !all; })); } break;
      case 'rotZ': if (need()) this.rotateBy(s.selected(), 2, 90); break;
      case 'drop': if (need()) s.dropToPlate(); break;
      case 'selectAll': s.select(s.objects.map((o) => o.id)); break;
      case 'split': if (need()) this.split(ids); break;
      case 'bake': if (need()) this.bake(ids); break;
      case 'new': if (!s.objects.length || confirmLoss('Start a new design?')) { s.reset(); this.applyPrinter(); this.view.fit(false); } break;
      case 'open': document.getElementById('fileOpen').click(); break;
      case 'save': this.saveProject(); break;
      case 'import': document.getElementById('fileImport').click(); break;
      case 'exportMenu': { const m = document.getElementById('exportMenu'); m.hidden = !m.hidden; break; }
      case 'theme': this.applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true); break;
      case 'help': this.showHelp(); break;
      case 'frame': this.view.fit(); break;
      default:
        if (name.startsWith('export:')) { document.getElementById('exportMenu').hidden = true; this.export(name.slice(7)); }
    }
  }
  split(ids) {
    const s = this.scene; let made = 0;
    s.edit('split into parts', () => {
      for (const id of ids) {
        const o = s.get(id); if (!o) continue; const w = worldManifold(o); const parts = w.decompose();
        if (parts.length < 2) { free(w); continue; }
        const idx = s.objects.indexOf(o); const objs = parts.map((p, i) => { const m = p.getMesh(); const r = this.addMesh(`${o.name} ${i + 1}`, xyzOnly(m), m.triVerts, o.color); free(p); return r; });
        s.objects.splice(idx, 1, ...objs); made += objs.length; free(w);
      }
      s.selection.clear();
    });
    this.toast(made ? `Split into ${made} parts` : 'This object is already a single part.');
    s.emit('select');
  }
  /** Cut an object in two with a plane across one world axis. */
  cut(o, axis, at) {
    const s = this.scene; const n = [0, 0, 0]; n[axis] = 1; let w;
    try { w = worldManifold(o); } catch (e) { this.toast(e.message); return; }
    const [hi, lo] = w.splitByPlane(n, at); free(w);
    if (hi.isEmpty() || lo.isEmpty()) { free(hi); free(lo); this.toast('The cut plane misses this object. Move it inside the part.'); return; }
    s.edit('cut in two', () => {
      const mk = (m, suffix) => { const mesh = m.getMesh(); const r = this.addMesh(`${o.name} ${suffix}`, xyzOnly(mesh), mesh.triVerts, o.color); free(m); return r; };
      const a = mk(lo, axis === 2 ? 'bottom' : 'A'), b = mk(hi, axis === 2 ? 'top' : 'B');
      s.objects.splice(s.objects.indexOf(o), 1, a, b);
      if (axis === 2) { const ba = s.worldBox(a), bb = s.worldBox(b); b.pos = [b.pos[0] + (ba.max[0] - bb.min[0]) + 8, b.pos[1], b.pos[2] - bb.min[2]]; }
      else { b.pos = b.pos.map((v, i) => (i === axis ? v + 5 : v)); }
      s.selection = new Set([a.id, b.id]);
    });
    this.view.extraLines = null; s.emit('select');
    this.toast(axis === 2 ? 'Cut in two. The top half now stands on its cut face.' : 'Cut in two. The halves are 5 mm apart.');
  }
  bake(ids) {
    const s = this.scene;
    s.edit('freeze as mesh', () => ids.forEach((id) => { const o = s.get(id); if (!o) return; const w = worldManifold(o); const m = w.getMesh(); const r = this.addMesh(o.name, xyzOnly(m), m.triVerts, o.color); r.hole = o.hole; s.objects.splice(s.objects.indexOf(o), 1, r); s.selection.delete(id); s.selection.add(r.id); free(w); }));
  }
  /** World meshes of everything printable. */
  printableParts(onlySel = false) {
    const s = this.scene; const parts = [];
    for (const o of s.objects) {
      if (o.visible === false || o.hole) continue; if (onlySel && !s.selection.has(o.id)) continue;
      try { const w = worldManifold(o); const m = w.getMesh(); parts.push({ name: o.name, color: o.color, v: xyzOnly(m), t: new Uint32Array(m.triVerts), man: w }); }
      catch (e) { this.toast(`${o.name}: ${e.message}`); }
    }
    return parts;
  }
  async export(kind) {
    const s = this.scene; const parts = this.printableParts(kind === 'sel-stl');
    if (!parts.length) { this.toast(kind === 'sel-stl' ? 'Select a solid to export.' : 'There is nothing solid to export yet.'); return; }
    const base = (s.name || 'design').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design';
    try {
      if (kind === 'stl' || kind === 'sel-stl') download(toSTL(parts, base), `${base}.stl`);
      else if (kind === '3mf') download(await to3MF(parts, { title: s.name }), `${base}.3mf`);
      else if (kind === 'obj') { const { obj, mtl } = toOBJ(parts, base); download(await zip([{ name: `${base}.obj`, data: new Uint8Array(await obj.arrayBuffer()) }, { name: `${base}.mtl`, data: new Uint8Array(await mtl.arrayBuffer()) }]), `${base}-obj.zip`); }
      else if (kind === 'parts') { const files = []; const used = {}; for (const p of parts) { let n = p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'part'; used[n] = (used[n] || 0) + 1; if (used[n] > 1) n += `-${used[n]}`; files.push({ name: `${n}.stl`, data: new Uint8Array(await toSTL([p], n).arrayBuffer()) }); } download(await zip(files), `${base}-parts.zip`); }
      this.toast(`Exported ${parts.length} part${parts.length > 1 ? 's' : ''}`);
    } finally { parts.forEach((p) => free(p.man)); }
  }
  saveProject() {
    const s = this.scene; const data = JSON.stringify(s.toJSON());
    const base = (s.name || 'design').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design';
    download(new Blob([data], { type: 'application/json' }), `${base}.pforge`); s.dirty = false; this.toast('Saved project file');
  }
  async openProject(file) {
    try { const data = JSON.parse(await file.text()); this.scene.load(data); this.applyPrinter(); this.view.fit(false); this.toast(`Opened ${file.name}`); }
    catch (e) { this.toast(e.message || 'This file could not be opened.', 4000); }
  }
  async importFiles(files) {
    const s = this.scene; const added = [];
    for (const f of files) {
      try {
        const parts = await importFile(f);
        for (const p of parts) { if (!p.t.length) continue; const o = this.addMesh(p.name, p.v, p.t, p.color); localGeometry(o); added.push(o); }
      } catch (e) { this.toast(`${f.name}: ${e.message}`, 5000); }
    }
    if (!added.length) return;
    s.edit('import', () => { for (const o of added) { s.objects.push(o); } s.dropToPlate(added, true); s.selection = new Set(added.map((o) => o.id)); });
    // Centre the import on the plate if it came in far away.
    const box = s.selectionBox(added); const b = this.view.r.bed;
    if (box && (Math.abs(box.min[0]) > b.w || Math.abs(box.min[1]) > b.d)) { const c = box.min.map((v, i) => (v + box.max[i]) / 2); added.forEach((o) => { o.pos = [o.pos[0] - c[0], o.pos[1] - c[1], o.pos[2]]; }); }
    s.emit('select'); this._changed(); this.view.fit(); this.toast(`Imported ${added.length} object${added.length > 1 ? 's' : ''}`);
  }

  // ------------------------------------------------------------ settings, theme, help
  applyPrinter() {
    const s = this.scene.settings; const p = printerById(s.printer);
    const w = s.printer === 'custom' ? (s.customW || 200) : p.w, d = s.printer === 'custom' ? (s.customD || 200) : p.d, hh = s.printer === 'custom' ? (s.customH || 200) : p.h;
    Object.assign(this.view.r.bed, { w, d, h: hh, round: false }); this.view.r._bedKey = null; this.view.redraw(); this.renderStatus?.();
  }
  applyTheme(t, persist) {
    const root = document.documentElement;
    if (t === 'dark' || t === 'light') root.dataset.theme = t; else delete root.dataset.theme;
    if (persist) store.set('printforge.theme', t);
    const cs = getComputedStyle(root); const dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    const th = this.view.r.theme; th.dark = dark; th.bg = hex(cs.getPropertyValue('--bg').trim() || '#E6EBEF'); th.accent = hex(cs.getPropertyValue('--accent').trim() || '#13858C');
    this.view.r._bedKey = null; this.view.redraw();
  }
  platePanel() {
    const s = this.scene; const st = s.settings;
    const printerSel = h('select', { 'aria-label': 'Printer', onchange: (e) => { s.edit('printer', () => { st.printer = e.target.value; }); this.applyPrinter(); this.view.fit(); } },
      ...[...new Set(PRINTERS.map((p) => p.vendor))].map((v) => h('optgroup', { label: v }, ...PRINTERS.filter((p) => p.vendor === v).map((p) => h('option', { value: p.id, selected: p.id === st.printer }, `${p.model}${p.id === 'custom' ? '' : `  (${p.w}×${p.d}×${p.h})`}`)))));
    const out = [h('h3', {}, 'Plate'), h('fieldset', {}, h('legend', {}, 'Printer'), printerSel)];
    if (st.printer === 'custom') out.push(h('fieldset', {}, h('legend', {}, 'Build volume (mm)'),
      ...['W', 'D', 'H'].map((l, i) => row(['Width', 'Depth', 'Height'][i], numField(st[`custom${l}`] || 200, (v) => { s.edit('build volume', () => { st[`custom${l}`] = v; }); this.applyPrinter(); }, { min: 20, max: 2000 })))));
    out.push(h('fieldset', {}, h('legend', {}, 'Snap when dragging'),
      h('div', { class: 'seg' }, ...[0, 0.1, 0.5, 1, 5, 10].map((v) => h('button', { 'aria-pressed': String(st.snap === v), onclick: () => { st.snap = v; this.view.r.gridStep = v >= 5 ? v : 10; this._changed(); } }, v ? String(v) : 'Off'))),
      h('p', { class: 'note' }, 'Hold Ctrl while dragging to move freely, Shift to keep to one axis.')));
    out.push(h('fieldset', {}, h('legend', {}, 'How it works'),
      h('p', { class: 'note' }, 'Add shapes from the library and drag them around the plate. The cone above a selection lifts it. Mark shapes as holes, select a hole and a solid together and Group to cut. Switch to Prepare to print for checks, orientation and estimates.')));
    return out;
  }
  showHelp() {
    const keys = [['Orbit', 'Left-drag empty space / right-drag'], ['Pan', 'Middle-drag / Shift+right-drag'], ['Zoom', 'Scroll / pinch'], ['Select more', 'Shift+click'], ['Duplicate while dragging', 'Alt+drag'], ['Free move (no snap)', 'Ctrl+drag'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Duplicate', 'Ctrl+D'], ['Group / ungroup', 'Ctrl+G / Ctrl+Shift+G'], ['Hole ↔ solid', 'H'], ['Turn 90°', 'R'], ['Drop to plate', 'D'],
      ['Nudge', 'Arrows (Shift ×10)'], ['Raise / lower', 'Page Up / Page Down'], ['Delete', 'Delete / Backspace'], ['Select all', 'Ctrl+A'], ['Fit view', 'F'], ['Views', '7 top · 1 front · 3 right · 0 iso · 5 persp'],
      ['Quick box / cylinder / sphere', 'B / C / S'], ['Measure', 'M'], ['Save / open', 'Ctrl+S / Ctrl+O'], ['Export STL', 'Ctrl+E']];
    this.modal('Shortcuts', h('div', { class: 'help-grid' }, ...keys.map(([a, b]) => h('div', {}, h('span', {}, a), h('kbd', {}, b)))),
      h('p', { class: 'note', style: { marginTop: '14px' } }, 'Number fields accept sums like 40/2+3 and inches like 2*inch. Arrow keys step values; Shift steps by ten.'));
  }
  modal(title, ...body) {
    const d = document.getElementById('modal'); let foot = null;
    if (body.length && body[body.length - 1]?.classList?.contains('modal-foot')) foot = body.pop();
    d.replaceChildren(h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn', onclick: () => d.close(), 'aria-label': 'Close' }, 'Close')), h('div', { class: 'modal-body' }, ...body), foot);
    d.showModal(); return d;
  }
  closeDrawers() { document.getElementById('app').classList.remove('show-left', 'show-right'); }
  setMode(m) {
    this.mode = m; this.view.mode = m;
    document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    document.getElementById('layerbar').hidden = m !== 'prepare' || !this.prepPanel;
    this.emit('mode', m); this._changed();
  }

  // ------------------------------------------------------------ chrome & keyboard
  _bindChrome() {
    document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.cmd(b.dataset.cmd); }));
    document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) document.getElementById('exportMenu').hidden = true; });
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { const r = this.view.setView(b.dataset.view); if (b.dataset.view === 'proj') b.textContent = r ? 'Persp' : 'Ortho'; }));
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    document.querySelectorAll('[data-drawer]').forEach((b) => b.addEventListener('click', () => { const app = document.getElementById('app'); const c = `show-${b.dataset.drawer}`; const on = !app.classList.contains(c); app.classList.remove('show-left', 'show-right'); if (on) app.classList.add(c); }));
    const dn = document.getElementById('docName');
    dn.addEventListener('change', () => this.scene.edit('rename design', () => { this.scene.name = dn.value.trim() || 'Untitled design'; }));
    dn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') dn.blur(); });
    document.getElementById('fileOpen').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.openProject(f); e.target.value = ''; });
    document.getElementById('fileImport').addEventListener('change', (e) => { this.importFiles([...e.target.files]); e.target.value = ''; });
    const stage = document.getElementById('stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); });
    stage.addEventListener('drop', (e) => { e.preventDefault(); const files = [...e.dataTransfer.files]; const proj = files.find((f) => /\.(pforge|json)$/i.test(f.name)); if (proj) this.openProject(proj); else this.importFiles(files); });
    window.addEventListener('beforeunload', (e) => { if (this.scene.dirty && this.scene.objects.length && !store.get(STORE_KEY)) { e.preventDefault(); } });
    document.addEventListener('keydown', (e) => this._key(e));
  }
  _key(e) {
    const t = e.target; if (t.matches?.('input, textarea, select, [contenteditable]') || document.getElementById('modal').open) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase(); const s = this.scene;
    const go = (fn) => { e.preventDefault(); fn(); };
    if (mod && k === 'z') return go(() => (e.shiftKey ? s.redo() : s.undo()));
    if (mod && k === 'y') return go(() => s.redo());
    if (mod && k === 'd') return go(() => this.cmd('duplicate'));
    if (mod && k === 'g') return go(() => this.cmd(e.shiftKey ? 'ungroup' : 'group'));
    if (mod && k === 'a') return go(() => this.cmd('selectAll'));
    if (mod && k === 's') return go(() => this.cmd('save'));
    if (mod && k === 'o') return go(() => this.cmd('open'));
    if (mod && k === 'e') return go(() => this.export('stl'));
    if (mod && k === 'c') { this._clip = s.selected().map(cloneObj); return; }
    if (mod && k === 'v') return go(() => { if (!this._clip?.length) return; const copies = this._clip.map(cloneObj); copies.forEach((c) => { c.pos = [c.pos[0] + 10, c.pos[1] + 10, c.pos[2]]; }); s.edit('paste', () => { s.objects.push(...copies); s.selection = new Set(copies.map((c) => c.id)); }); s.emit('select'); });
    if (mod) return;
    const sel = s.selected();
    if (k === 'delete' || k === 'backspace') return go(() => this.cmd('delete'));
    if (k === 'escape') return go(() => { if (this.view.measure) this.view.setMeasure(false); else s.clearSelection(); });
    if (k === 'm') return go(() => this.view.setMeasure(!this.view.measure));
    if (k === 'h') return go(() => this.cmd('toggleHole'));
    if (k === 'r') return go(() => this.cmd('rotZ'));
    if (k === 'd') return go(() => this.cmd('drop'));
    if (k === 'f') return go(() => this.view.fit());
    if (k === 'b') return go(() => this.addShape('box'));
    if (k === 'c') return go(() => this.addShape('cylinder'));
    if (k === 's') return go(() => this.addShape('sphere'));
    if (k === '?') return go(() => this.showHelp());
    const views = { 7: 'top', 1: 'front', 3: 'right', 0: 'iso' }; if (views[k]) return go(() => this.view.setView(views[k]));
    if (k === '5') return go(() => { const r = this.view.setView('proj'); document.getElementById('projBtn').textContent = r ? 'Persp' : 'Ortho'; });
    const step = (e.shiftKey ? 10 : 1) * (s.settings.snap || 1);
    const nud = { arrowleft: [-step, 0, 0], arrowright: [step, 0, 0], arrowup: [0, step, 0], arrowdown: [0, -step, 0], pageup: [0, 0, step], pagedown: [0, 0, -step] }[k];
    if (nud && sel.length) return go(() => {
      // Arrow keys move relative to the camera so "up" is away from the viewer.
      let d = nud; if (k.startsWith('arrow')) { const yaw = this.view.r.cam.yaw * Math.PI / 180; const fx = -Math.cos(yaw), fy = -Math.sin(yaw); const ax = Math.abs(fx) > Math.abs(fy) ? [Math.sign(fx), 0] : [0, Math.sign(fy)]; const right = [ax[1], -ax[0]]; d = [right[0] * nud[0] + ax[0] * nud[1], right[1] * nud[0] + ax[1] * nud[1], 0]; }
      s.edit('nudge', () => sel.forEach((o) => { o.pos = [o.pos[0] + d[0], o.pos[1] + d[1], o.pos[2] + d[2]]; }), { structure: false });
    });
  }
}

function xyzOnly(m) { const np = m.numProp, vp = m.vertProperties; if (np === 3) return new Float32Array(vp); const n = vp.length / np, out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { out[i * 3] = vp[i * np]; out[i * 3 + 1] = vp[i * np + 1]; out[i * 3 + 2] = vp[i * np + 2]; } return out; }
function confirmLoss(msg) { return window.confirm(`${msg} Unsaved changes stay in your browser's autosave only until you add something new.`); }
export { xyzOnly, eulerFromMatrix };
void transformDir; void K;

export const app = new App();
window.printforge = app;
// Feature modules register themselves before start().
const mods = await Promise.allSettled([import('./generators.js'), import('./sketch.js'), import('./script.js'), import('./printprep.js'), import('./textshape.js')]);
for (const m of mods) if (m.status === 'fulfilled' && m.value.install) app.plugins.push(m.value.install);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !navigator.webdriver) navigator.serviceWorker.register('sw.js').catch(() => {});
app.start().catch((e) => { document.getElementById('loading').innerHTML = `<p style="max-width:420px;text-align:center">PrintForge could not start: ${e.message}. Use a current Chrome, Edge, Firefox or Safari, and open the page through a web server (GitHub Pages works).</p>`; console.error(e); });
