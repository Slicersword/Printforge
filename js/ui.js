// DOM panels: library, object outline, inspector, selection toolbar.
import { SHAPES, icon, defaults } from './shapes.js';
import { kindDef } from './kernel.js';
import { fmt, eulerMatrix, transformDir } from './math.js';
import { PALETTE, makeShape } from './scene.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

// ---------------------------------------------------------------- numeric field with expressions
const SAFE = /^[\d\s+\-*/().,%^a-z_]*$/i;
const FN = { sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, pi: Math.PI, inch: 25.4 };
export function evalExpr(str, vars = {}) {
  const s = String(str).trim().replace(/,/g, '.').replace(/\^/g, '**'); if (!s) return NaN;
  if (!SAFE.test(s)) return NaN;
  const names = (s.match(/[a-z_][a-z_0-9]*/gi) || []);
  const scope = { ...FN, ...vars };
  for (const n of names) if (!(n in scope)) return NaN;
  try { const v = Function(...Object.keys(scope), `"use strict"; return (${s});`)(...Object.values(scope)); return typeof v === 'number' && isFinite(v) ? v : NaN; } catch { return NaN; }
}
export function numField(value, onCommit, { step = 1, min = -Infinity, max = Infinity, int = false, label, digits = 2 } = {}) {
  const inp = h('input', { type: 'text', class: 'num', inputmode: 'decimal', value: fmt(value, digits), 'aria-label': label, spellcheck: 'false' });
  let last = value;
  const commit = (v) => {
    if (!isFinite(v)) { inp.classList.add('bad'); return; }
    v = Math.min(max, Math.max(min, int ? Math.round(v) : v)); inp.classList.remove('bad'); inp.value = fmt(v, digits);
    if (Math.abs(v - last) > 1e-9) { last = v; onCommit(v); }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(evalExpr(inp.value)); inp.select(); }
    else if (e.key === 'Escape') { inp.value = fmt(last, digits); inp.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
      const cur = evalExpr(inp.value); commit((isFinite(cur) ? cur : last) + k);
    }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(evalExpr(inp.value)));
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  inp.addEventListener('wheel', (e) => { if (document.activeElement !== inp) return; e.preventDefault(); const cur = evalExpr(inp.value); commit((isFinite(cur) ? cur : last) + (e.deltaY < 0 ? step : -step)); }, { passive: false });
  inp.title = 'Type a number or a sum like 40/2+3. Arrow keys step (Shift ×10).';
  return inp;
}
export function row(label, control, unit) {
  return h('div', { class: 'row' }, h('label', {}, label, unit ? h('span', { class: 'unit' }, ` ${unit}`) : null), control);
}

/** Generic parameter form from a schema. onChange(newParams) fires per edit. */
export function paramForm(schema, params, onChange) {
  const fs = h('fieldset');
  for (const f of schema) {
    if (f.when && !f.when(params)) continue;
    let ctl;
    const set = (v) => onChange({ ...params, [f.key]: v });
    if (f.type === 'num' || f.type === 'int') ctl = numField(params[f.key] ?? f.def, set, { step: f.step, min: f.min, max: f.max, int: f.type === 'int', label: f.label, digits: f.digits ?? 3 });
    else if (f.type === 'select') ctl = h('select', { onchange: (e) => set(e.target.value), 'aria-label': f.label }, ...f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(params[f.key]) === String(v) }, l); }));
    else if (f.type === 'bool') ctl = h('input', { type: 'checkbox', checked: !!params[f.key], onchange: (e) => set(e.target.checked), 'aria-label': f.label, style: { justifySelf: 'end' } });
    else if (f.type === 'text') ctl = h('input', { type: 'text', value: params[f.key] ?? '', onchange: (e) => set(e.target.value), onkeydown: (e) => e.stopPropagation(), 'aria-label': f.label });
    else if (f.type === 'color') ctl = h('input', { type: 'color', value: params[f.key], onchange: (e) => set(e.target.value), style: { justifySelf: 'end' } });
    fs.append(row(f.label, ctl, f.unit && f.unit !== 'mm' ? f.unit : (f.type === 'num' && f.unit === 'mm' ? '' : '')));
  }
  return fs;
}

// ---------------------------------------------------------------- library
export class Library {
  constructor(app) {
    this.app = app; this.tabs = []; this.active = null;
    this.tabsEl = document.getElementById('leftTabs'); this.body = document.getElementById('leftBody');
  }
  addTab(id, label, render) { this.tabs.push({ id, label, render }); if (!this.active) this.active = id; this.renderTabs(); }
  show(id) { this.active = id; this.renderTabs(); }
  renderTabs() {
    this.tabsEl.replaceChildren(...this.tabs.map((t) => h('button', { role: 'tab', 'aria-selected': String(t.id === this.active), onclick: () => this.show(t.id) }, t.label)));
    const t = this.tabs.find((x) => x.id === this.active); this.body.replaceChildren(); if (t) t.render(this.body);
  }
}

export function shapesTab(app) {
  return (el) => {
    const cats = [...new Set(SHAPES.map((s) => s.category))];
    for (const cat of cats) {
      el.append(h('div', { class: 'group-label' }, cat));
      el.append(h('div', { class: 'shape-grid' }, ...SHAPES.filter((s) => s.category === cat).map((s) =>
        h('button', { class: 'shape-btn' + (s.hole ? ' is-hole' : ''), title: s.note || `Add a ${s.label.toLowerCase()}${s.hole ? ' (as a hole)' : ''}`, onclick: () => app.addShape(s.kind), html: icon(s.icon) }, h('span', {}, s.label)))));
    }
    el.append(h('p', { class: 'note', style: { marginTop: '12px' } }, 'Holes cut into solids once you group them. Select a hole and a solid, then press ', h('kbd', {}, 'Ctrl G'), '.'));
  };
}

// ---------------------------------------------------------------- outline
export function renderOutline(app) {
  const ul = document.getElementById('objectList'); const s = app.scene;
  document.getElementById('objCount').textContent = s.objects.length ? String(s.objects.length) : '';
  if (!s.objects.length) { ul.replaceChildren(h('li', { class: 'empty' }, 'Nothing on the plate yet.')); return; }
  const eyeOn = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/></svg>';
  const items = [];
  for (const o of s.objects) {
    const li = h('li', { class: s.selection.has(o.id) ? 'sel' : '', onclick: (e) => s.select(o.id, e.shiftKey || e.ctrlKey || e.metaKey), ondblclick: () => app.openEditor(o), title: o._error || '' },
      h('span', { class: 'sw' + (o.hole ? ' hole' : ''), style: { background: o.color } }),
      h('span', { class: 'nm' }, o.name), o._error ? h('span', { class: 'err', title: o._error }, '!') : null,
      h('button', { class: 'eye', title: o.visible === false ? 'Show' : 'Hide', 'aria-label': o.visible === false ? 'Show' : 'Hide', html: o.visible === false ? eyeOff : eyeOn, onclick: (e) => { e.stopPropagation(); s.update(o.id, { visible: o.visible === false }, o.visible === false ? 'show' : 'hide'); } }));
    items.push(li);
    if (o.type === 'group' && s.selection.has(o.id)) for (const c of o.children) items.push(h('li', { class: 'child' }, h('span', { class: 'sw' + (c.hole ? ' hole' : ''), style: { background: c.color } }), h('span', { class: 'nm' }, c.name)));
  }
  ul.replaceChildren(...items);
}

// ---------------------------------------------------------------- inspector
const ROT_ICON = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>';

export function renderInspector(app) {
  const el = document.getElementById('inspector'); const s = app.scene; const sel = s.selected();
  if (app.mode === 'prepare' && app.prepPanel) { el.replaceChildren(...app.prepPanel()); return; }
  if (app.mode === 'preview' && app.previewPanel) { el.replaceChildren(...app.previewPanel().filter(Boolean)); return; }
  if (!sel.length) { el.replaceChildren(...app.platePanel()); return; }
  if (sel.length > 1) { el.replaceChildren(...multiPanel(app, sel)); return; }
  const o = sel[0]; const box = s.worldBox(o);
  const parts = [];
  parts.push(h('div', { class: 'insp-head' },
    h('input', { type: 'text', value: o.name, 'aria-label': 'Name', onchange: (e) => s.update(o.id, { name: e.target.value || o.name }, 'rename'), onkeydown: (e) => e.stopPropagation() }),
    h('input', { type: 'color', value: o.color, title: 'Colour', onchange: (e) => s.update(o.id, { color: e.target.value }, 'colour') })));
  parts.push(h('div', { class: 'seg', role: 'group', 'aria-label': 'Solid or hole' },
    h('button', { 'aria-pressed': String(!o.hole), onclick: () => o.hole && s.update(o.id, { hole: false }, 'make solid') }, 'Solid'),
    h('button', { class: 'hole-on', 'aria-pressed': String(!!o.hole), onclick: () => !o.hole && s.update(o.id, { hole: true }, 'make hole') }, 'Hole')));
  parts.push(h('div', { class: 'swatches' }, ...PALETTE.map((c) => h('button', { style: { background: c }, title: c, 'aria-label': `Colour ${c}`, onclick: () => s.update(o.id, { color: c, hole: false }, 'colour') }))));
  if (o._error) parts.push(h('div', { class: 'error-box' }, o._error));

  if (box) {
    const c = box.min.map((v, i) => (v + box.max[i]) / 2); const size = box.max.map((v, i) => v - box.min[i]);
    const moveTo = (axis, val) => s.edit('move', () => { const d = axis < 2 ? val - c[axis] : val - box.min[2]; o.pos = o.pos.map((p, i) => (i === axis ? p + d : p)); });
    parts.push(h('fieldset', {}, h('legend', {}, 'Position (centre X, Y · bottom Z)'), xyz(['X', 'Y', 'Z'], [c[0], c[1], box.min[2]], moveTo)));
    const resize = (axis, val) => { if (val <= 0) return; app.resize(o, axis, val, app.lockRatio); };
    parts.push(h('fieldset', {}, h('legend', {}, 'Size'), xyz(['W', 'D', 'H'], size, resize),
      h('label', { class: 'note', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: app.lockRatio, onchange: (e) => { app.lockRatio = e.target.checked; } }), 'Keep proportions')));
  }
  parts.push(h('fieldset', {}, h('legend', {}, 'Rotation (degrees)'),
    xyz(['X', 'Y', 'Z'], o.rot, (axis, val) => app.rotateTo(o, axis, val)),
    h('div', { class: 'rot-btns' }, ...['X', 'Y', 'Z'].flatMap((a, i) => [-90, 90].map((d) => h('button', { class: 'btn', title: `Turn ${d > 0 ? '+' : ''}${d}° around ${a}`, onclick: () => app.rotateBy([o], i, d) }, `${a}${d > 0 ? '+' : '−'}90`))))));

  if (o.type === 'shape') {
    const def = kindDef(o.kind); const schema = def?.schema ? def.schema(o.params) : def?.params;
    if (schema?.length) {
      const form = paramForm(schema, o.params, (p) => app.setParams(o, p, `change ${def.label?.toLowerCase() || 'shape'}`));
      parts.push(h('fieldset', {}, h('legend', {}, `${def.label || o.kind} settings`), ...form.childNodes));
      if (def.note) parts.push(h('p', { class: 'note' }, def.note));
    }
    if (def?.editor) parts.push(h('button', { class: 'btn primary', onclick: () => app.openEditor(o) }, def.editorLabel || 'Edit'));
    if (o.kind === 'script' && app.openAI) parts.push(h('button', { class: 'btn', onclick: () => app.openAI() }, 'Change with AI…'));
  }
  if (o.type === 'group') parts.push(h('p', { class: 'note' }, `Group of ${o.children.length}: ${o.children.filter((c) => c.hole).length} hole(s) cut from ${o.children.filter((c) => !c.hole).length} solid(s).`));
  if (o.type === 'mesh') parts.push(h('p', { class: 'note' }, 'Imported mesh. Move, scale, rotate, group and cut it like any other shape.'));

  if (box) parts.push(cutUI(app, o, box));
  parts.push(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => app.cmd('duplicate') }, 'Duplicate'),
    h('button', { class: 'btn', onclick: () => app.cmd('drop') }, 'Drop to plate'),
    h('button', { class: 'btn', onclick: () => app.mirror(0) }, 'Mirror X'),
    h('button', { class: 'btn', onclick: () => app.mirror(1) }, 'Mirror Y'),
    o.type === 'group' ? h('button', { class: 'btn wide', onclick: () => app.cmd('ungroup') }, 'Ungroup') : null,
    h('button', { class: 'btn', onclick: () => app.cmd('split') }, 'Split into parts'),
    h('button', { class: 'btn', onclick: () => app.cmd('bake') }, 'Freeze as mesh'),
    h('button', { class: 'btn danger wide', onclick: () => app.cmd('delete') }, 'Delete')));
  el.replaceChildren(...parts);
}

function cutUI(app, o, box) {
  const st = app._cut && app._cut.id === o.id ? app._cut : (app._cut = { id: o.id, axis: 2, at: +((box.min[2] + box.max[2]) / 2).toFixed(2), open: false });
  const preview = () => {
    if (!st.open) { app.view.extraLines = null; app.view.redraw(); return; }
    const a = st.axis, b = box, pad = 4; const lo = b.min.map((v) => v - pad), hi = b.max.map((v) => v + pad); const pts = [];
    const corner = (u, v) => { const p = [0, 0, 0]; p[a] = st.at; const [i, j] = [0, 1, 2].filter((k) => k !== a); p[i] = u ? hi[i] : lo[i]; p[j] = v ? hi[j] : lo[j]; return p; };
    const c = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]; for (let k = 0; k < 4; k++) pts.push(...c[k], ...c[(k + 1) % 4]); pts.push(...c[0], ...c[2], ...c[1], ...c[3]);
    app.view.extraLines = [{ data: new Float32Array(pts), color: [0.95, 0.45, 0.15, 1], noDepth: true }]; app.view.redraw();
  };
  const det = h('details', { class: 'cut', open: st.open, ontoggle: (e) => { st.open = e.target.open; preview(); } }, h('summary', {}, 'Cut in two'),
    h('div', { class: 'seg', style: { margin: '8px 0' } }, ...['X', 'Y', 'Z'].map((l, i) => h('button', { 'aria-pressed': String(st.axis === i), onclick: () => { st.axis = i; st.at = +((box.min[i] + box.max[i]) / 2).toFixed(2); renderInspector(app); preview(); } }, i === 2 ? 'Height (Z)' : l))),
    row(st.axis === 2 ? 'Cut height' : `Cut at ${'XY'[st.axis]}`, numField(st.at, (v) => { st.at = v; preview(); }, { min: box.min[st.axis], max: box.max[st.axis], step: 0.5 })),
    h('button', { class: 'btn primary', style: { width: '100%', marginTop: '6px' }, onclick: () => { st.open = false; app.cut(o, st.axis, st.at); } }, 'Cut'),
    h('p', { class: 'note' }, 'Split a tall part to fit the printer or to avoid supports. Halves become separate meshes.'));
  if (st.open) setTimeout(preview, 0);
  return det;
}

function multiPanel(app, sel) {
  const s = app.scene; const holes = sel.filter((o) => o.hole).length;
  const al = (axis, where, label) => h('button', { class: 'btn', title: label, onclick: () => app.align(axis, where) }, label);
  return [
    h('h3', {}, `${sel.length} objects selected`),
    h('p', { class: 'note' }, holes ? `${holes} hole(s) will cut the ${sel.length - holes} solid(s) when grouped.` : 'Group them to merge into one part.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary wide', onclick: () => app.cmd('group') }, 'Group (Ctrl G)'),
      h('button', { class: 'btn', onclick: () => app.cmd('duplicate') }, 'Duplicate'),
      h('button', { class: 'btn', onclick: () => app.cmd('drop') }, 'Drop to plate'),
      h('button', { class: 'btn', onclick: () => s.edit('make solid', () => sel.forEach((o) => { o.hole = false; })) }, 'All solid'),
      h('button', { class: 'btn', onclick: () => s.edit('make hole', () => sel.forEach((o) => { o.hole = true; })) }, 'All holes')),
    h('fieldset', {}, h('legend', {}, 'Align'),
      h('div', { class: 'actions', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
        al(0, -1, 'Left'), al(0, 0, 'Centre X'), al(0, 1, 'Right'),
        al(1, -1, 'Front'), al(1, 0, 'Centre Y'), al(1, 1, 'Back'),
        al(2, -1, 'Bottom'), al(2, 0, 'Middle Z'), al(2, 1, 'Top')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => app.distribute(0) }, 'Space evenly X'), h('button', { class: 'btn', onclick: () => app.distribute(1) }, 'Space evenly Y'))),
    h('div', { class: 'swatches' }, ...PALETTE.map((c) => h('button', { style: { background: c }, 'aria-label': `Colour ${c}`, onclick: () => s.edit('colour', () => sel.forEach((o) => { o.color = c; o.hole = false; })) }))),
    h('button', { class: 'btn danger', onclick: () => app.cmd('delete') }, 'Delete selected'),
  ];
}

export function xyz(labels, values, onSet) {
  return h('div', { class: 'xyz' }, ...labels.map((l, i) => h('label', {}, h('span', {}, l), numField(values[i], (v) => onSet(i, v), { label: l, step: 1 }))));
}

// ---------------------------------------------------------------- selection toolbar
export function renderSelbar(app) {
  const bar = document.getElementById('selbar'); const sel = app.scene.selected();
  if (!sel.length || app.mode !== 'design') { bar.hidden = true; return; }
  bar.hidden = false;
  const b = (label, cmd, title, svg) => h('button', { onclick: () => app.cmd(cmd), title, html: (svg || '') + `<span>${label}</span>` });
  const one = sel.length === 1 ? sel[0] : null;
  bar.replaceChildren(...[
    sel.length > 1 ? b('Group', 'group', 'Merge, cutting holes (Ctrl+G)', '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="11" height="11" rx="1"/><rect x="10" y="10" width="11" height="11" rx="1"/></svg>') : null,
    one?.type === 'group' ? b('Ungroup', 'ungroup', 'Split the group back into its shapes (Ctrl+Shift+G)', '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>') : null,
    b(sel.every((o) => o.hole) ? 'Solid' : 'Hole', 'toggleHole', 'Switch between solid and hole (H)', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="3 2.4"/></svg>'),
    h('span', { class: 'sep' }),
    b('Duplicate', 'duplicate', 'Duplicate (Ctrl+D)', '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>'),
    b('Turn', 'rotZ', 'Turn 90° on the plate (R)', ROT_ICON),
    b('Drop', 'drop', 'Drop to plate (D)', '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>'),
    h('span', { class: 'sep' }),
    b('Delete', 'delete', 'Delete (Del)', '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'),
  ].filter(Boolean));
}

export { defaults, makeShape };
export function axisMap(o) {
  // For each world axis, which local axis lines up best (used for resizing rotated objects).
  const R = eulerMatrix(o.rot); const out = [];
  for (let w = 0; w < 3; w++) { let best = 0, bv = -1; for (let l = 0; l < 3; l++) { const d = transformDir(R, l === 0 ? [1, 0, 0] : l === 1 ? [0, 1, 0] : [0, 0, 1]); if (Math.abs(d[w]) > bv) { bv = Math.abs(d[w]); best = l; } } out.push(best); }
  return out;
}
