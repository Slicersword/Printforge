// Transform tool bar (Move, Rotate, Scale, Lay on face, Cut, Boolean, Measure) and the Mesh Boolean tool.
// Modelled on Bambu Studio's gizmo bar and its Mesh Boolean gizmo, and on PaliCAD's union / subtract / intersect.
import { h } from './ui.js';
import { K, worldManifold, renderData, free } from './kernel.js';
import { hex } from './renderer.js';
import { eulerMatrix, eulerFromMatrix, mul, fmt } from './math.js';

const I = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="10" height="10" rx="1"/><path d="M11 3h10v10M21 3l-8 8M15 3h6v6"/></svg>',
  flatten: '<svg viewBox="0 0 24 24"><path d="M6 15l6-9 6 9z"/><path d="M3 19h18" stroke-width="2.2"/></svg>',
  cut: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M2 12h20" stroke-dasharray="2.5 2"/></svg>',
  boolean: '<svg viewBox="0 0 24 24"><circle cx="9.5" cy="12" r="6"/><circle cx="14.5" cy="12" r="6"/><path d="M12 7.2a6 6 0 0 0 0 9.6 6 6 0 0 0 0-9.6z" fill="currentColor" stroke="none"/></svg>',
  measure: '<svg viewBox="0 0 24 24"><path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/></svg>',
};
function xyzOnly(m) { const np = m.numProp, vp = m.vertProperties; if (np === 3) return new Float32Array(vp); const n = vp.length / np, out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { out[i * 3] = vp[i * np]; out[i * 3 + 1] = vp[i * np + 1]; out[i * 3 + 2] = vp[i * np + 2]; } return out; }
const VENN = {
  union: '<svg viewBox="0 0 24 24"><circle cx="9.5" cy="12" r="6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="6" fill="currentColor" stroke="none"/></svg>',
  subtract: '<svg viewBox="0 0 24 24"><path d="M9.5 6a6 6 0 1 0 0 12 6 6 0 0 0 4.9-2.5 6 6 0 0 1 0-7A6 6 0 0 0 9.5 6z" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="6"/></svg>',
  intersect: I.boolean,
};
const OPS = {
  union: { label: 'Union', verb: 'Merged', note: 'Merge every part into one solid.' },
  subtract: { label: 'Subtract', verb: 'Subtracted', note: 'Cut the “Cut away” parts out of each “Keep” part.' },
  intersect: { label: 'Intersect', verb: 'Intersected', note: 'Keep only the volume every part shares.' },
};

/** Rotation that turns unit vector a onto unit vector b (column-major 4×4). */
export function rotBetween(a, b) {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; const m = new Float64Array(16); m[15] = 1;
  let ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; let s = Math.hypot(...ax);
  if (s < 1e-9) {
    if (c > 0) { m[0] = m[5] = m[10] = 1; return m; }
    ax = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]]; s = Math.hypot(...ax); const [x, y, z] = ax.map((v) => v / s);
    m[0] = 2 * x * x - 1; m[1] = 2 * x * y; m[2] = 2 * x * z; m[4] = 2 * x * y; m[5] = 2 * y * y - 1; m[6] = 2 * y * z; m[8] = 2 * x * z; m[9] = 2 * y * z; m[10] = 2 * z * z - 1; return m;
  }
  const [x, y, z] = ax.map((v) => v / s); const t = 1 - c;
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}

export function install(app) {
  // ------------------------------------------------------------ tool bar
  const stage = document.getElementById('stage');
  const tools = [
    ['move', 'Move', 'M', 'Drag the arrows to move along X, Y or Z. Drag the part itself to slide it on the plate.'],
    ['rotate', 'Rotate', 'R', 'Drag a ring to turn around that axis. Shift snaps to 15°.'],
    ['scale', 'Scale', 'S', 'Drag a cube to stretch one direction, or the white corner cube to scale evenly. Ctrl: one side only.'],
    ['flatten', 'Lay on face', 'F', 'Click a flat face to put it down on the plate.'],
  ];
  const bar = h('div', { class: 'gizmobar', id: 'gizmobar', role: 'toolbar', 'aria-label': 'Transform tools' },
    ...tools.map(([id, label, key, tip]) => h('button', { 'data-tool': id, title: `${label} (${key})\n${tip}`, 'aria-label': `${label} (${key})`, 'aria-pressed': 'false', html: `${I[id]}<span>${label}</span><kbd>${key}</kbd>`, onclick: () => app.setTool(id) })),
    h('span', { class: 'sep' }),
    h('button', { 'data-act': 'cut', title: 'Cut in two (C)', 'aria-label': 'Cut (C)', html: `${I.cut}<span>Cut</span><kbd>C</kbd>`, onclick: () => app.openCut() }),
    h('button', { 'data-act': 'boolean', title: 'Mesh boolean: union, subtract or intersect parts (B)', 'aria-label': 'Boolean (B)', html: `${I.boolean}<span>Boolean</span><kbd>B</kbd>`, onclick: () => app.openBoolean() }),
    h('button', { 'data-act': 'measure', title: 'Measure between two points (U)', 'aria-label': 'Measure (U)', html: `${I.measure}<span>Measure</span><kbd>U</kbd>`, onclick: () => app.view.setMeasure(!app.view.measure) }));
  stage.appendChild(bar);
  const sync = () => {
    const design = app.mode === 'design'; bar.hidden = !design;
    const any = app.scene?.selection.size > 0;
    bar.querySelectorAll('[data-tool]').forEach((b) => { const on = b.dataset.tool === app.view.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('dim', !any); });
    bar.querySelector('[data-act="cut"]').classList.toggle('dim', app.scene?.selection.size !== 1);
    bar.querySelector('[data-act="boolean"]').classList.toggle('on', !!app.boolTool);
    bar.querySelector('[data-act="measure"]').classList.toggle('on', !!app.view.measure);
  };
  app.on('tool', sync); app.on('mode', () => { if (app.mode !== 'design') closeBoolean(); sync(); }); app.on('measure', sync); app.on('change', sync);
  app.scene.on('select', () => { sync(); if (app.boolTool) schedule(); }); app.on('ready', sync);

  const TIPS = { move: 'Move: drag an arrow, or drag the part across the plate.', rotate: 'Rotate: drag a coloured ring. Shift snaps to 15°.', scale: 'Scale: drag a cube to stretch, the white corner cube to scale evenly. Ctrl+drag stretches one side only.', flatten: 'Lay on face: click any flat face to put it on the plate. Esc to stop.' };
  app.setTool = (t) => {
    if (app.mode !== 'design') app.setMode('design');
    if (app.view.measure) app.view.setMeasure(false);
    const was = app.view.tool; app.view.setTool(t);
    if (was !== t) app.toast(TIPS[t]);
    if (t !== 'flatten' && !app.scene.selection.size) app.toast(`${TIPS[t]} Select a part first.`);
  };
  app.openCut = () => {
    const sel = app.scene.selected();
    if (sel.length !== 1) { app.toast('Cut: select one part first.'); return; }
    closeBoolean();
    const box = app.scene.worldBox(sel[0]); if (!box) return;
    app._cut = { id: sel[0].id, axis: 2, at: +((box.min[2] + box.max[2]) / 2).toFixed(2), open: true };
    document.getElementById('app').classList.add('show-right'); app.refresh();
    setTimeout(() => document.querySelector('#inspector details.cut')?.scrollIntoView({ block: 'nearest' }), 0);
  };

  // ------------------------------------------------------------ lay on face
  app.layOnFace = (o, n) => {
    const s = app.scene; if (!o) return;
    const before = s.worldBox(o); const cx = (before.min[0] + before.max[0]) / 2, cy = (before.min[1] + before.max[1]) / 2;
    s.edit('lay on face', () => {
      o.rot = eulerFromMatrix(mul(rotBetween(n, [0, 0, -1]), eulerMatrix(o.rot)));
      const nb = s.worldBox(o); o.pos = [o.pos[0] + cx - (nb.min[0] + nb.max[0]) / 2, o.pos[1] + cy - (nb.min[1] + nb.max[1]) / 2, o.pos[2] - nb.min[2]];
      s.selection = new Set([o.id]);
    });
    s.emit('select');
    app.toast('Face placed on the plate. Click another face, or press M to move.');
  };

  // ------------------------------------------------------------ mesh boolean
  // State: { op, roles: Map(id -> 'A' | 'B'), keep, preview }
  let timer = 0, lastKey = '', result = null; // result: { mans: [Manifold], items, error, stats }
  const releasePreview = () => {
    if (result) { result.mans?.forEach(free); result.items?.forEach((it) => app.view.r.release(it.rd)); }
    result = null; app.view.preview = null; lastKey = '';
  };
  function closeBoolean() {
    if (!app.boolTool) return;
    app.boolTool = null; app.toolPanel = null; releasePreview(); app.refresh?.(); app.view.redraw(); sync?.();
  }
  app.closeBoolean = closeBoolean;
  app.openBoolean = (op) => {
    if (app.mode !== 'design') app.setMode('design');
    const s = app.scene; const sel = s.selected();
    if (app.boolTool) { if (op) { app.boolTool.op = op; schedule(); app.refresh(); } return; }
    if (app.view.measure) app.view.setMeasure(false);
    app._cut = null; app.view.extraLines = null;
    const roles = new Map(); sel.forEach((o, i) => roles.set(o.id, o.hole ? 'B' : i === 0 ? 'A' : 'B'));
    if (sel.length && ![...roles.values()].includes('A')) roles.set(sel[0].id, 'A');
    app.boolTool = { op: op || (sel.some((o) => o.hole) ? 'subtract' : 'subtract'), roles, keep: false, preview: true };
    app.toolPanel = panel;
    document.getElementById('app').classList.add('show-right');
    schedule(); app.refresh(); sync();
    if (sel.length < 2) app.toast('Mesh boolean: Shift+click parts to add them.');
  };
  const members = () => { const s = app.scene; const bt = app.boolTool; const sel = s.selected().filter((o) => o.visible !== false);
    for (const o of sel) if (!bt.roles.has(o.id)) bt.roles.set(o.id, o.hole ? 'B' : 'B');
    if (sel.length && !sel.some((o) => bt.roles.get(o.id) === 'A')) bt.roles.set(sel[0].id, 'A');
    return sel.map((o) => ({ o, role: bt.roles.get(o.id) })); };
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { compute(); app.refresh(); app.view.redraw(); }, 40); }
  app.on('change', () => { if (app.boolTool) schedule(); });

  /** Bambu Studio's messages, so the wording matches what people know from the slicer. */
  function check(op, list) {
    const A = list.filter((m) => m.role === 'A'), B = list.filter((m) => m.role === 'B');
    if (op === 'union' && list.length < 2) return 'Union needs at least two parts. Shift+click another part.';
    if (op === 'intersect' && list.length < 2) return 'Intersect needs at least two parts. Shift+click another part.';
    if (op === 'subtract' && (!A.length || !B.length)) return 'Subtract needs at least one part to keep and one to cut away.';
    return null;
  }
  function compute() {
    const bt = app.boolTool; if (!bt) return;
    const list = members();
    const key = JSON.stringify([bt.op, bt.preview, list.map((m) => [m.o.id, m.role, m.o.pos, m.o.rot, m.o.scale, m.o.params, m.o.meshId, m.o.children?.length])]);
    if (key === lastKey) return; releasePreview(); lastKey = key;
    const err = check(bt.op, list); if (err) { result = { error: err }; return; }
    const solids = new Map();
    try {
      for (const m of list) solids.set(m.o.id, worldManifold(m.o));
      let mans = [];
      if (bt.op === 'union') mans = [K.Manifold.union(list.map((m) => solids.get(m.o.id)))];
      else if (bt.op === 'intersect') mans = [K.Manifold.intersection(list.map((m) => solids.get(m.o.id)))];
      else {
        const cutters = list.filter((m) => m.role === 'B').map((m) => solids.get(m.o.id));
        const tool = cutters.length > 1 ? K.Manifold.union(cutters) : cutters[0];
        mans = list.filter((m) => m.role === 'A').map((m) => solids.get(m.o.id).subtract(tool));
        if (cutters.length > 1) free(tool);
      }
      const owners = bt.op === 'subtract' ? list.filter((m) => m.role === 'A').map((m) => m.o) : [list.find((m) => m.role === 'A')?.o || list[0].o];
      const empty = mans.map((m) => m.isEmpty());
      if (empty.every(Boolean)) {
        mans.forEach(free);
        result = { error: bt.op === 'intersect' ? 'No overlapping region found. Move the parts so they overlap.' : bt.op === 'subtract' ? 'Nothing is left: the cutters remove the whole part.' : 'The result came out empty.' };
        return;
      }
      const vol = mans.reduce((t, m) => t + m.volume(), 0), tris = mans.reduce((t, m) => t + m.numTri(), 0);
      const items = bt.preview ? mans.map((m, i) => {
        if (empty[i]) return null;
        const rd = renderData({ man: m, render: null }); const I4 = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        return { rd, model: I4, normalMat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), rgb: hex(owners[i]?.color || '#2F9C95'), hole: false, selected: true, centre: [0, 0, 0] };
      }).filter(Boolean) : [];
      result = { mans, owners, empty, items, stats: { vol, tris, parts: mans.filter((m, i) => !empty[i]).reduce((t, m) => t + m.decompose().map((p) => (free(p), 1)).length, 0) } };
      app.view.preview = bt.preview ? { items, ghost: new Map(list.map((m) => [m.o.id, bt.op === 'subtract' ? m.role : 'A'])) } : null;
    } catch (e) {
      result = { error: `Boolean failed: ${e.message}. Check that the parts are closed solids.` };
    } finally { solids.forEach(free); }
  }

  function apply() {
    const bt = app.boolTool; const s = app.scene; compute();
    if (!result || result.error) { app.toast(result?.error || 'Nothing to apply yet.'); return; }
    const list = members(); const n = list.length;
    const made = [];
    s.edit(`boolean ${OPS[bt.op].label.toLowerCase()}`, () => {
      result.mans.forEach((m, i) => {
        if (result.empty[i]) return; const o = result.owners[i]; const mesh = m.getMesh();
        const name = bt.op === 'union' ? `${o.name} union` : bt.op === 'subtract' ? `${o.name} cut` : `${o.name} intersect`;
        made.push(app.addMesh(name, xyzOnly(mesh), mesh.triVerts, o.color));
      });
      const ids = new Set(list.map((m) => m.o.id));
      const idx = Math.min(...list.map((m) => s.objects.indexOf(m.o)));
      if (bt.keep) for (const m of list) m.o.visible = false; else s.objects = s.objects.filter((o) => !ids.has(o.id));
      s.objects.splice(Math.min(idx, s.objects.length), 0, ...made);
      s.selection = new Set(made.map((o) => o.id));
    });
    app.toast(`${OPS[bt.op].verb} ${n} parts into ${made.length > 1 ? `${made.length} meshes` : 'one mesh'}.${bt.keep ? ' The originals are hidden in the Objects list.' : ''}`);
    closeBoolean(); s.emit('select');
  }

  function panel() {
    const bt = app.boolTool; const s = app.scene; if (!bt) return [];
    if (lastKey === '') compute();
    const list = members();
    const setRole = (id, r) => { bt.roles.set(id, r); schedule(); app.refresh(); };
    const row = (m) => h('li', { class: 'bool-row' },
      h('span', { class: 'sw' + (m.o.hole ? ' hole' : ''), style: { background: m.o.color } }), h('span', { class: 'nm', title: m.o.name }, m.o.name),
      bt.op === 'subtract' ? h('span', { class: 'seg mini' },
        h('button', { 'aria-pressed': String(m.role === 'A'), onclick: () => setRole(m.o.id, 'A'), title: 'Keep this part and cut into it' }, 'Keep'),
        h('button', { 'aria-pressed': String(m.role === 'B'), class: 'hole-on', onclick: () => setRole(m.o.id, 'B'), title: 'Use this part as a cutter' }, 'Cut away')) : null,
      h('button', { class: 'x', title: 'Leave this part out', 'aria-label': `Leave ${m.o.name} out`, onclick: () => s.select(m.o.id, true) }, '×'));
    const A = list.filter((m) => m.role === 'A'), B = list.filter((m) => m.role === 'B');
    const groups = bt.op === 'subtract'
      ? [h('p', { class: 'grp-label' }, `Keep (${A.length})`), h('ul', { class: 'bool-list' }, ...A.map(row)), h('p', { class: 'grp-label cut' }, `Cut away (${B.length})`), h('ul', { class: 'bool-list' }, ...B.map(row))]
      : [h('p', { class: 'grp-label' }, `Parts (${list.length})`), h('ul', { class: 'bool-list' }, ...list.map(row))];
    const st = result?.stats;
    return [
      h('div', { class: 'tool-head' }, h('h3', {}, 'Mesh boolean'), h('button', { class: 'btn', onclick: closeBoolean }, 'Close')),
      h('div', { class: 'seg ops', role: 'group', 'aria-label': 'Operation' }, ...Object.entries(OPS).map(([k, v]) =>
        h('button', { 'aria-pressed': String(bt.op === k), onclick: () => { bt.op = k; schedule(); app.refresh(); }, html: `${VENN[k]}<span>${v.label}</span>` }))),
      h('p', { class: 'note' }, OPS[bt.op].note),
      ...groups,
      !list.length ? h('p', { class: 'note' }, 'Select two or more parts. Shift+click in the view or in the Objects list.') : null,
      bt.op === 'subtract' && list.length > 1 ? h('button', { class: 'btn', style: { width: '100%' }, onclick: () => { for (const m of list) bt.roles.set(m.o.id, m.role === 'A' ? 'B' : 'A'); schedule(); app.refresh(); } }, 'Swap Keep and Cut away') : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: bt.preview, onchange: (e) => { bt.preview = e.target.checked; lastKey = ''; schedule(); } }), 'Show the result in the view'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: bt.keep, onchange: (e) => { bt.keep = e.target.checked; } }), 'Keep the original parts (hidden)'),
      result?.error ? h('div', { class: 'error-box' }, result.error)
        : st ? h('p', { class: 'note result' }, `Result: ${st.parts} solid piece${st.parts === 1 ? '' : 's'}, ${fmt(st.vol / 1000, 2)} cm³, ${st.tris.toLocaleString()} triangles.`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary wide', disabled: !!result?.error || !list.length, onclick: apply }, `Apply ${OPS[bt.op].label.toLowerCase()}`),
        h('button', { class: 'btn wide', onclick: closeBoolean }, 'Cancel')),
      h('p', { class: 'note' }, 'The result is a single mesh. To keep shapes editable, mark cutters as holes and Group them (Ctrl G) instead.'),
    ];
  }

  // ------------------------------------------------------------ search palette
  const add = (label, run, keys) => app.addAction({ label, group: 'Transform', keys, run });
  add('Move tool', () => app.setTool('move'), 'M');
  add('Rotate tool', () => app.setTool('rotate'), 'R');
  add('Scale tool', () => app.setTool('scale'), 'S');
  add('Lay on face', () => app.setTool('flatten'), 'F');
  add('Cut in two', () => app.openCut(), 'C');
  add('Mesh boolean', () => app.openBoolean(), 'B');
  add('Boolean union', () => app.openBoolean('union'));
  add('Boolean subtract', () => app.openBoolean('subtract'));
  add('Boolean intersect', () => app.openBoolean('intersect'));
  add('Reset rotation', () => { const s = app.scene; s.edit('reset rotation', () => s.selected().forEach((o) => { const b = s.worldBox(o); o.rot = [0, 0, 0]; app._keepFloor(o, b); })); });
  add('Reset scale', () => { const s = app.scene; s.edit('reset scale', () => s.selected().forEach((o) => { const b = s.worldBox(o); o.scale = [1, 1, 1]; app._keepFloor(o, b); })); });
}
