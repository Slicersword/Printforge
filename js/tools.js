// Transform tool bar (Move, Rotate, Scale, Lay on face, Cut, Boolean, Measure) and the Mesh Boolean tool.
// Modelled on Bambu Studio's gizmo bar and its Mesh Boolean gizmo, and on PaliCAD's union / subtract / intersect.
import { h, numField, row } from './ui.js';
import { findEdges, edgeLabel } from './fillet.js';
import { geo } from './geo.js';
import { fromMan, toMan } from './geoops.js';
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
  fillet: '<svg viewBox="0 0 24 24"><path d="M4 20V10a6 6 0 0 1 6-6h10"/><path d="M4 20h16V4" stroke-dasharray="2 2"/></svg>',
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
  const add0 = (label, run, keys) => app.addAction({ label, group: 'Edit', keys, run });
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
    h('button', { 'data-act': 'fillet', title: 'Fillet or chamfer edges: click the edges to round (E)', 'aria-label': 'Fillet edges (E)', html: `${I.fillet}<span>Fillet</span><kbd>E</kbd>`, onclick: () => app.openFillet() }),
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

  // ------------------------------------------------------------ resizable side panels
  const root = document.getElementById('app'); const PKEY = 'printforge.panels';
  const DEF = { left: 268, right: 292 }, MIN = { left: 210, right: 240 };
  let sizes = { ...DEF }; try { Object.assign(sizes, JSON.parse(localStorage.getItem(PKEY) || '{}')); } catch { /* private mode */ }
  const maxW = () => Math.max(300, Math.floor(window.innerWidth * 0.42));
  const applySizes = (save) => {
    for (const k of ['left', 'right']) { sizes[k] = Math.round(Math.min(maxW(), Math.max(MIN[k], sizes[k]))); root.style.setProperty(`--${k}-size`, `${sizes[k]}px`); }
    splitters.forEach((el) => el.setAttribute('aria-valuenow', String(sizes[el.dataset.side])));
    if (save) try { localStorage.setItem(PKEY, JSON.stringify(sizes)); } catch { /* ignore */ }
  };
  const splitters = ['left', 'right'].map((side) => {
    const el = h('div', { class: `splitter splitter-${side}`, 'data-side': side, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize the ${side === 'left' ? 'library' : 'properties'} panel`, tabindex: '0', title: 'Drag to resize. Double-click to reset.', 'aria-valuemin': String(MIN[side]) });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('resizing');
      const x0 = e.clientX, w0 = sizes[side];
      const move = (ev) => { sizes[side] = w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX); applySizes(false); };
      const up = () => { el.removeEventListener('pointermove', move); el.classList.remove('drag'); document.body.classList.remove('resizing'); applySizes(true); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', up, { once: true });
    });
    el.addEventListener('dblclick', () => { sizes[side] = DEF[side]; applySizes(true); });
    el.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d) return; e.preventDefault(); e.stopPropagation(); sizes[side] += (side === 'left' ? d : -d) * (e.shiftKey ? 40 : 10); applySizes(true); });
    root.appendChild(el); return el;
  });
  applySizes(false); window.addEventListener('resize', () => applySizes(false));

  // ------------------------------------------------------------ collapsible panels and focus mode
  const PANEL_KEY = 'printforge.panelsHidden';
  let hidden = { left: false, right: false }; try { Object.assign(hidden, JSON.parse(localStorage.getItem(PANEL_KEY) || '{}')); } catch { /* ignore */ }
  const applyHidden = () => {
    root.classList.toggle('hide-left', hidden.left); root.classList.toggle('hide-right', hidden.right);
    focusBtn?.classList.toggle('on', hidden.left && hidden.right);
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(hidden)); } catch { /* ignore */ }
  };
  app.togglePanel = (side) => { hidden[side] = !hidden[side]; applyHidden(); };
  app.toggleFocus = () => { const both = hidden.left && hidden.right; hidden.left = hidden.right = !both; applyHidden(); app.toast(both ? 'Panels back.' : 'Focus on the model: press \\ to bring the panels back.'); };
  const nav = document.querySelector('.viewnav');
  const focusBtn = h('button', { title: 'Focus on the model: hide both panels (\\)', 'aria-label': 'Focus on the model', onclick: () => app.toggleFocus(), html: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg><span>Focus</span>' });
  nav?.appendChild(focusBtn);
  for (const side of ['left', 'right']) {
    // small tab on the panel edge to fold it away / bring it back
    const tab = h('button', { class: `panel-tab panel-tab-${side}`, title: `${side === 'left' ? 'Hide or show the library' : 'Hide or show the properties'} (${side === 'left' ? '[' : ']'})`, 'aria-label': `Toggle the ${side === 'left' ? 'library' : 'properties'} panel`, onclick: () => app.togglePanel(side), html: '<svg viewBox="0 0 24 24"><path d="M14 7l-5 5 5 5"/></svg>' });
    root.appendChild(tab);
  }
  applyHidden();

  // ------------------------------------------------------------ section view (clipping plane)
  const sec = { axis: 2, t: 0.5, flip: false, on: false };
  const secBar = h('div', { class: 'layerbar secbar', id: 'secbar', hidden: true },
    h('b', {}, 'Section'), h('div', { class: 'seg mini', role: 'group', 'aria-label': 'Cut across' }, ...['X', 'Y', 'Z'].map((a, i) => h('button', { 'data-axis': String(i), onclick: () => { sec.axis = i; applySec(); } }, a))),
    h('input', { type: 'range', id: 'secSlider', min: '0', max: '1', step: '0.001', value: '0.5', 'aria-label': 'Section position', oninput: (e) => { sec.t = +e.target.value; applySec(); } }),
    h('output', { id: 'secOut' }), h('button', { class: 'btn', title: 'Look from the other side', onclick: () => { sec.flip = !sec.flip; applySec(); } }, 'Flip'),
    h('button', { class: 'btn', onclick: () => app.toggleSection(false) }, 'Off'));
  stage.appendChild(secBar);
  const sceneBox = () => { const s = app.scene; const list = s.objects.filter((o) => o.visible !== false); const bb = list.length ? s.selectionBox(list) : null; return bb || { min: [-50, -50, 0], max: [50, 50, 50] }; };
  function applySec() {
    const bb = sceneBox(); const a = sec.axis; const lo = bb.min[a] - 0.01, hi = bb.max[a] + 0.01; const v = lo + (hi - lo) * sec.t;
    const n = [0, 0, 0]; n[a] = sec.flip ? -1 : 1; app.view.r.section = sec.on ? { n, d: sec.flip ? -v : v } : null;
    secBar.querySelectorAll('[data-axis]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.axis === a)));
    document.getElementById('secOut').textContent = `${'XYZ'[a]} = ${v.toFixed(1)} mm`;
    app.view.redraw();
  }
  app.toggleSection = (on = !sec.on) => {
    sec.on = on && app.mode === 'design'; secBar.hidden = !sec.on; applySec(); sync?.();
    bar.querySelector('[data-act="section"]')?.classList.toggle('on', sec.on);
    if (sec.on) app.toast('Section view: drag the slider to cut through the parts. Cut faces show in orange.');
  };
  app.on('mode', () => { if (sec.on && app.mode !== 'design') app.toggleSection(false); });
  app.on('change', () => { if (sec.on) applySec(); });
  bar.insertBefore(h('button', { 'data-act': 'section', title: 'Section view: cut through the model on X, Y or Z (X)', 'aria-label': 'Section view (X)', html: '<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M3 14l18-6" stroke-dasharray="2.5 2"/></svg><span>Section</span><kbd>X</kbd>', onclick: () => app.toggleSection() }), bar.querySelector('[data-act="measure"]'));

  // ------------------------------------------------------------ thin walls: purple where a wall is thinner than two nozzle widths
  app.toggleThin = (on = !app.view.thinWalls) => {
    app.view.thinWalls = !!on; const b = bar.querySelector('[data-act="thin"]'); b?.classList.toggle('on', app.view.thinWalls); b?.setAttribute('aria-pressed', String(app.view.thinWalls));
    app.view.redraw(); if (!on) return;
    const lim = app.view.thinLimit(); app.toast(`Thin walls: checking… purple marks walls thinner than ${lim} mm (two ${lim / 2} mm nozzle widths).`, 2500);
    const report = () => { const r = app.view.thinSummary(); if (!r || !app.view.thinWalls) return; app.off?.('thin', report);
      app.toast(r.area ? `Thin walls: ${Math.round(r.area)} mm² thinner than ${lim} mm on ${r.parts} part${r.parts === 1 ? '' : 's'} (purple). Thicken them or they may print weak or not at all.` : `No walls thinner than ${lim} mm.`, 5000); };
    app.on('thin', report); setTimeout(report, 50);
  };
  bar.insertBefore(h('button', { 'data-act': 'thin', 'aria-pressed': 'false', title: 'Thin walls: shade walls thinner than two nozzle widths in purple, while you design', 'aria-label': 'Thin walls', html: '<svg viewBox="0 0 24 24"><path d="M4 20V6h4v14M12 20V6h1.5v14" /><path d="M17 20V6h3v14" stroke-dasharray="2 2"/></svg><span>Thin walls</span>', onclick: () => app.toggleThin() }), bar.querySelector('[data-act="measure"]'));
  app.addAction?.({ label: 'Thin walls (show walls thinner than 2 nozzle widths)', group: 'View', run: () => app.toggleThin() });

  // ------------------------------------------------------------ X-ray: hidden edges only when asked for
  app.toggleXray = (on = !app.view.r.xray) => {
    app.view.r.xray = !!on; bar.querySelector('[data-act="xray"]')?.classList.toggle('on', app.view.r.xray);
    bar.querySelector('[data-act="xray"]')?.setAttribute('aria-pressed', String(app.view.r.xray));
    app.view.redraw(); if (on) app.toast('X-ray: hidden edges show faintly through the parts. Click X-ray again to hide them.');
  };
  bar.insertBefore(h('button', { 'data-act': 'xray', 'aria-pressed': 'false', title: 'X-ray: show hidden edges through the parts (off by default)', 'aria-label': 'X-ray', html: '<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10" stroke-dasharray="2 2"/></svg><span>X-ray</span>', onclick: () => app.toggleXray() }), bar.querySelector('[data-act="measure"]'));
  app.addAction?.({ label: 'X-ray (show hidden edges)', group: 'View', run: () => app.toggleXray() });

  // ------------------------------------------------------------ right-click menu
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (menu && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
  window.addEventListener('blur', closeMenu);
  // The browser's own right-click menu: Windows fires `contextmenu` after mouse-up, when our menu is already under
  // the pointer, so blocking it on the canvas alone isn't enough. Block it over the 3D view, its toolbars and our
  // menus; text fields and the panels keep the browser menu (copy, paste, spelling).
  document.addEventListener('contextmenu', (e) => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (menu || t.closest('#stage, .ctx-menu, .dropdown-menu')) e.preventDefault();
  }, true);
  app.showContextMenu = (x, y, obj) => {
    closeMenu(); const s = app.scene; const sel = s.selected(); const one = sel.length === 1 ? sel[0] : null;
    const item = (label, key, run, opts = {}) => h('button', { role: 'menuitem', class: opts.danger ? 'danger' : '', disabled: !!opts.disabled, onclick: () => { closeMenu(); run(); } }, h('span', {}, label), key ? h('kbd', {}, key) : null);
    const sep = () => h('div', { class: 'cm-sep', role: 'separator' });
    const centre = () => { const bb = s.selectionBox(sel); if (!bb) return; const dx = -(bb.min[0] + bb.max[0]) / 2, dy = -(bb.min[1] + bb.max[1]) / 2; s.edit('centre on the plate', () => sel.forEach((o) => { o.pos = [o.pos[0] + dx, o.pos[1] + dy, o.pos[2] - bb.min[2]]; })); app.view.fit(); };
    const kids = obj && sel.length ? [
      h('div', { class: 'cm-title' }, one ? one.name : `${sel.length} parts`),
      item('Centre on the plate', '', centre), item('Drop to the plate', 'D', () => app.cmd('drop')), item('Lay on face', 'F', () => app.setTool('flatten')), item('Turn 90°', 'Shift R', () => app.cmd('rotZ')),
      sep(), item('Duplicate', mod('D'), () => app.cmd('duplicate')), item(one?.hole ? 'Make solid' : 'Make a hole', 'H', () => app.cmd('toggleHole')),
      one && !one.hole ? item('Fillet edges…', 'E', () => app.openFillet()) : null,
      item('Merge', mod('G'), () => app.cmd('merge'), { disabled: sel.length < 2 }), item('Unmerge', isMac ? '⇧⌘G' : 'Ctrl Shift G', () => app.cmd('unmerge')),
      sel.length > 1 ? item('Mesh boolean…', 'B', () => app.openBoolean()) : null,
      one ? item('Cut in two…', 'C', () => app.openCut()) : null, one ? item('Texture…', '', () => app.openTexture?.()) : null,
      app.canMakeMany?.(one || {}) ? item('Make many at once…', '', () => app.makeMany(one)) : null,
      sep(), item('Hide', '', () => s.edit('hide', () => sel.forEach((o) => { o.visible = false; }))), item('Export selection as STL', '', () => app.cmd('export:sel-stl')),
      item('Auto-arrange the plate', '', () => app.arrange?.()), sep(), item('Delete', 'Del', () => app.cmd('delete'), { danger: true }),
    ] : [
      item('Fit everything', 'Z', () => app.view.fit()), item('Select all', mod('A'), () => app.cmd('selectAll'), { disabled: !s.objects.length }),
      item('Auto-arrange the plate', '', () => app.arrange?.(), { disabled: !s.objects.length }), item('Show hidden parts', '', () => s.edit('show all', () => s.objects.forEach((o) => { o.visible = true; })), { disabled: !s.objects.some((o) => o.visible === false) }),
      sep(), item('Add a box', '', () => app.addShape('box')), item('Import a file…', mod('I'), () => app.cmd('import')), item('Search every tool…', mod('K'), () => app.openPalette?.()),
      sep(), item(sec.on ? 'Turn off section view' : 'Section view', 'X', () => app.toggleSection()), item(app.view.r.xray ? 'Turn off X-ray' : 'X-ray (hidden edges)', '', () => app.toggleXray()), item('Focus on the model', '\\', () => app.toggleFocus()),
    ];
    menu = h('div', { class: 'ctx-menu', role: 'menu', 'aria-label': 'Actions' }, ...kids.filter(Boolean));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect(); menu.style.left = `${Math.min(x, innerWidth - r.width - 6)}px`; menu.style.top = `${Math.min(y, innerHeight - r.height - 6)}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
    menu.addEventListener('keydown', (e) => { const bs = [...menu.querySelectorAll('button:not(:disabled)')]; const i = bs.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); } e.stopPropagation(); });
  };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); function mod(k) { return isMac ? `⌘${k}` : `Ctrl ${k}`; }
  // keyboard: Shift+F10 or the context-menu key opens the menu for the selection
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && app.mode === 'design') { e.preventDefault(); const r = app.view.canvas.getBoundingClientRect(); app.showContextMenu(r.left + r.width / 2, r.top + r.height / 2, app.scene.selected()[0] || null); }
  });

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
    app.closeFillet?.();
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
  // The boolean runs in the background worker; the newest request wins, and Apply waits for it.
  let boolSeq = 0, pendingBool = null;
  function compute() {
    const bt = app.boolTool; if (!bt) return Promise.resolve();
    const list = members();
    const key = JSON.stringify([bt.op, bt.preview, list.map((m) => [m.o.id, m.role, m.o.pos, m.o.rot, m.o.scale, m.o.params, m.o.meshId, m.o.children?.length])]);
    if (key === lastKey) return pendingBool || Promise.resolve();
    releasePreview(); lastKey = key;
    const err = check(bt.op, list); if (err) { result = { error: err }; return Promise.resolve(); }
    const mine = ++boolSeq; result = { busy: true };
    const meshes = []; const roles = [];
    try { for (const m of list) { const w = worldManifold(m.o); meshes.push(fromMan(w)); free(w); roles.push(m.role); } }
    catch (e) { result = { error: `Boolean failed: ${e.message}. Check that the parts are closed solids.` }; return Promise.resolve(); }
    pendingBool = geo('boolean', { op: bt.op, meshes, roles }).then((res) => {
      if (mine !== boolSeq || !app.boolTool) return;
      const owners = bt.op === 'subtract' ? list.filter((m) => m.role === 'A').map((m) => m.o) : [list.find((m) => m.role === 'A')?.o || list[0].o];
      const empty = res.map((r) => r.empty);
      if (empty.every(Boolean)) { result = { error: bt.op === 'intersect' ? 'No overlapping region found. Move the parts so they overlap.' : bt.op === 'subtract' ? 'Nothing is left: the cutters remove the whole part.' : 'The result came out empty.' }; return; }
      const mans = res.map((r) => (r.empty ? K.Manifold.cube([0, 0, 0]) : toMan(K, r.mesh)));
      const vol = res.reduce((t, r) => t + r.vol, 0), tris = res.reduce((t, r) => t + r.tris, 0), parts = res.reduce((t, r) => t + r.parts, 0);
      const items = bt.preview ? mans.map((m, i) => {
        if (empty[i]) return null;
        const rd = renderData({ man: m, render: null }); const I4 = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        return { rd, model: I4, normalMat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), rgb: hex(owners[i]?.color || '#2F9C95'), hole: false, selected: true, centre: [0, 0, 0] };
      }).filter(Boolean) : [];
      result = { mans, owners, empty, items, stats: { vol, tris, parts } };
      app.view.preview = bt.preview ? { items, ghost: new Map(list.map((m) => [m.o.id, bt.op === 'subtract' ? m.role : 'A'])) } : null;
    }).catch((e) => { if (mine === boolSeq) result = { error: `Boolean failed: ${e.message}. Check that the parts are closed solids.` }; })
      .finally(() => { if (mine === boolSeq) { pendingBool = null; app.refresh(); app.view.redraw(); } });
    return pendingBool;
  }

  async function apply() {
    const bt = app.boolTool; const s = app.scene; await compute(); if (!app.boolTool) return;
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
      result?.busy ? h('p', { class: 'note result working' }, 'Working it out in the background…')
      : result?.error ? h('div', { class: 'error-box' }, result.error)
        : st ? h('p', { class: 'note result' }, `Result: ${st.parts} solid piece${st.parts === 1 ? '' : 's'}, ${fmt(st.vol / 1000, 2)} cm³, ${st.tris.toLocaleString()} triangles.`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary wide', disabled: !!result?.error || !!result?.busy || !list.length, onclick: apply }, `Apply ${OPS[bt.op].label.toLowerCase()}`),
        h('button', { class: 'btn wide', onclick: closeBoolean }, 'Cancel')),
      h('p', { class: 'note' }, 'The result is a single mesh. To keep shapes editable, mark cutters as holes and Group them (Ctrl G) instead.'),
    ];
  }

  // ------------------------------------------------------------ fillet / chamfer edges
  // State: { id, edges: Set(edge ids), r, type, chain, keep, preview }. The part's sharp edges are found once (in world
  // coordinates) and found again if the part changes. The view shows the result live; Apply turns it into a mesh.
  let fl = null; // { key, man, edges, result, error, timer }
  const ORANGE = [0.98, 0.5, 0.12, 1];
  const flKey = (o) => JSON.stringify([o.id, o.pos, o.rot, o.scale, o.params, o.meshId, o.children?.length]);
  function flTarget() { const t = app.filletTool; return t && app.scene.objects.find((o) => o.id === t.id); }
  function flPrepare() {
    const o = flTarget(); if (!o) return false; const k = flKey(o);
    if (fl && fl.key === k) return true;
    flRelease(true); try { const man = worldManifold(o); fl = { key: k, man, edges: findEdges(man), result: null, error: null }; app.filletTool.edges.clear(); return true; }
    catch (e) { fl = { key: k, man: null, edges: [], error: `Can’t read this part’s edges: ${e.message}` }; return false; }
  }
  function flRelease(all) {
    if (!fl) return; if (fl.result) { free(fl.result.man); app.view.r.release(fl.result.rd); fl.result = null; }
    app.view.preview = null; if (all) { free(fl.man); fl = null; }
  }
  const segDist2 = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0; return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)); };
  const ptSeg3 = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L)) : 0; return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1], p[2] - a[2] - t * ab[2]); };
  /** The edge under the pointer: close on screen, and (when the pointer is on the part) closest to that surface point. */
  function edgeAt(x, y) {
    if (!fl?.edges.length) return null; const o = flTarget(); const hit = o && app.view.pickObject(o, x, y);
    let best = null;
    for (const f of fl.edges) for (let k = 0; k + 1 < f.pts.length; k++) {
      const a = app.view.r.project(f.pts[k]), b = app.view.r.project(f.pts[k + 1]); if (!a || !b) continue;
      const d = segDist2(x, y, a, b); if (d > 12) continue;
      const score = hit ? ptSeg3(hit.point, f.pts[k], f.pts[k + 1]) : d; // hidden edges are far from the surface you're pointing at
      if (!best || score < best.score) best = { f, score };
    }
    return best?.f || null;
  }
  const withChain = (f) => (app.filletTool.chain ? fl.edges.filter((g) => g.chain === f.chain) : [f]);
  function flLines(hover) {
    const t = app.filletTool; if (!t || !fl) { app.view.extraLines = null; return; }
    const segs = (list) => { const d = []; for (const f of list) for (let k = 0; k + 1 < f.pts.length; k++) d.push(...f.pts[k], ...f.pts[k + 1]); return new Float32Array(d); };
    const sel = fl.edges.filter((f) => t.edges.has(f.id)); const lines = [];
    if (sel.length) lines.push({ data: segs(sel), color: ORANGE, noDepth: true });
    if (hover) lines.push({ data: segs(withChain(hover)), color: [...app.view.r.theme.accent, 1], noDepth: true });
    app.view.extraLines = lines;
  }
  // the rounding itself runs in the background worker; only the newest request's answer is shown
  let flSeq = 0;
  async function flCompute() {
    const t = app.filletTool; if (!t || !fl?.man) return; const mine = ++flSeq; const F = fl;
    const list = F.edges.filter((f) => t.edges.has(f.id));
    if (!list.length) { flRelease(false); F.error = null; F.busy = false; app.view.redraw(); app.refresh(); return; }
    if (!(t.r > 0)) { flRelease(false); F.error = 'Set a size bigger than 0.'; app.refresh(); return; }
    F.busy = true; app.refresh();
    try {
      F.mesh ||= fromMan(F.man);
      const out = await geo('fillet', { mesh: F.mesh, edges: list, r: t.r, type: t.type });
      if (mine !== flSeq || fl !== F || !app.filletTool) return; // a newer request (or Close) came first
      flRelease(false); F.error = null; F.busy = false;
      const man = toMan(K, out.mesh); const rd = renderData({ man, render: null }); const o = flTarget();
      F.result = { man, rd, parts: out.parts, dv: out.dv };
      if (t.preview) app.view.preview = { items: [{ rd, model: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), normalMat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), rgb: hex(o?.color || '#2F9C95'), hole: false, selected: false, centre: [0, 0, 0] }], ghost: new Map([[t.id, 'H']]) };
    } catch (e) { if (mine !== flSeq || fl !== F) return; flRelease(false); F.busy = false; F.error = `This rounding didn’t work: ${e.message}. Try a smaller size, or fewer edges at once.`; }
    app.view.redraw(); app.refresh();
  }
  const flSchedule = () => { clearTimeout(fl?.timer); if (fl) fl.timer = setTimeout(flCompute, 60); };
  function closeFillet() {
    if (!app.filletTool) return; clearTimeout(fl?.timer);
    app.filletTool = null; app.view.edgePick = null; app.view.extraLines = null; flRelease(true);
    if (app.toolPanel === filletPanel) app.toolPanel = null; app.view.canvas.style.cursor = '';
    bar.querySelector('[data-act="fillet"]')?.classList.remove('on'); app.refresh?.(); app.view.redraw();
  }
  app.closeFillet = closeFillet;
  app.openFillet = () => {
    if (app.mode !== 'design') app.setMode('design');
    const sel = app.scene.selected().filter((o) => !o.hole);
    if (sel.length !== 1) { app.toast('Select one part first, then choose Fillet (E).'); return; }
    if (app.filletTool?.id === sel[0].id) return;
    closeFillet(); app.closeBoolean?.(); if (app.view.measure) app.view.setMeasure(false); app._cut = null;
    const prev = app._filletPrefs || { r: 1, type: 'fillet', chain: true };
    app.filletTool = { id: sel[0].id, edges: new Set(), r: prev.r, type: prev.type, chain: prev.chain, keep: false, preview: true };
    flPrepare();
    app.view.edgePick = {
      hover: (x, y) => { const f = edgeAt(x, y); app.view.canvas.style.cursor = f ? 'pointer' : ''; flLines(f); app.view.redraw(); },
      click: (x, y) => {
        const t = app.filletTool; const f = edgeAt(x, y); if (!f) return;
        const group = withChain(f); const on = !t.edges.has(f.id);
        for (const g of group) { if (on) t.edges.add(g.id); else t.edges.delete(g.id); }
        flLines(f); flSchedule(); app.refresh();
      },
    };
    app.toolPanel = filletPanel; document.getElementById('app').classList.add('show-right');
    bar.querySelector('[data-act="fillet"]')?.classList.add('on');
    flLines(null); app.refresh(); app.view.redraw();
    app.toast(fl?.edges.length ? 'Click the edges to round. Click again to unselect; drag to turn the view.' : 'This part has no sharp edges to round.', 3500);
  };
  // follow the part if it's edited; switch to another part if a different single part is selected
  app.scene.on('change', () => { if (!app.filletTool) return; if (!flTarget()) { closeFillet(); return; } if (fl && fl.key !== flKey(flTarget())) { flPrepare(); flLines(null); flSchedule(); } });
  app.scene.on('select', () => { const t = app.filletTool; if (!t) return; const sel = app.scene.selected(); if (sel.length === 1 && sel[0].id !== t.id && !sel[0].hole) { closeFillet(); app.openFillet(); } });
  app.on('mode', () => { if (app.mode !== 'design') closeFillet(); });
  async function applyFillet() {
    const t = app.filletTool; const o = flTarget(); clearTimeout(fl?.timer); if (!fl?.result || fl.busy) await flCompute();
    if (!fl?.result) { app.toast(fl?.error || 'Select at least one edge first.'); return; }
    const s = app.scene; const mesh = fl.result.man.getMesh(); let made = null; const n = t.edges.size;
    s.edit('fillet edges', () => {
      made = app.addMesh(`${o.name} ${t.type === 'chamfer' ? 'chamfered' : 'filleted'}`, xyzOnly(mesh), mesh.triVerts, o.color);
      const idx = s.objects.indexOf(o); s.objects = s.objects.filter((x) => x !== made);
      if (t.keep) o.visible = false; else s.objects = s.objects.filter((x) => x !== o);
      s.objects.splice(Math.min(idx < 0 ? s.objects.length : idx, s.objects.length), 0, made);
      s.selection = new Set([made.id]);
    });
    app.toast(`${t.type === 'chamfer' ? 'Chamfered' : 'Rounded'} ${n} edge${n === 1 ? '' : 's'}.${t.keep ? ' The original is hidden in the Objects list.' : ''}`);
    closeFillet(); s.emit('select');
  }
  function filletPanel() {
    const t = app.filletTool; if (!t) return []; const o = flTarget(); if (!fl) flPrepare();
    const sel = (fl?.edges || []).filter((f) => t.edges.has(f.id));
    const set = (k, v) => { t[k] = v; app._filletPrefs = { r: t.r, type: t.type, chain: t.chain }; flSchedule(); app.refresh(); };
    const top = () => { if (!fl?.edges.length) return []; const zmax = Math.max(...fl.edges.flatMap((f) => f.pts.map((p) => p[2]))); return fl.edges.filter((f) => f.pts.every((p) => Math.abs(p[2] - zmax) < 0.01)); };
    const pickSet = (list) => { list.forEach((f) => t.edges.add(f.id)); flLines(null); flSchedule(); app.refresh(); };
    const res = fl?.result;
    return [
      h('div', { class: 'tool-head' }, h('h3', {}, t.type === 'chamfer' ? 'Chamfer edges' : 'Fillet edges'), h('button', { class: 'btn', onclick: closeFillet }, 'Close')),
      h('p', { class: 'note' }, h('b', {}, o?.name || ''), ` · ${fl?.edges.length || 0} sharp edges. Click edges in the view to select them, click again to unselect. Drag to turn the view.`),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Edge shape', style: { margin: '8px 0' } },
        h('button', { 'aria-pressed': String(t.type === 'fillet'), onclick: () => set('type', 'fillet') }, 'Fillet (round)'),
        h('button', { 'aria-pressed': String(t.type === 'chamfer'), onclick: () => set('type', 'chamfer') }, 'Chamfer (45°)')),
      h('fieldset', {}, row(t.type === 'chamfer' ? 'Chamfer size' : 'Radius', numField(t.r, (v) => set('r', Math.max(0.05, v)), { min: 0.05, max: 100, step: 0.1 }), 'mm')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.chain, onchange: (e) => set('chain', e.target.checked) }), 'Select connected smooth edges together (a whole rounded outline or circle)'),
      h('div', { class: 'actions', style: { margin: '6px 0' } },
        h('button', { class: 'btn', onclick: () => pickSet(top()) }, 'Top edges'),
        h('button', { class: 'btn', onclick: () => pickSet(fl?.edges || []) }, 'All edges'),
        h('button', { class: 'btn', disabled: !sel.length, onclick: () => { t.edges.clear(); flLines(null); flSchedule(); app.refresh(); } }, 'Clear')),
      h('p', { class: 'grp-label' }, `Selected (${sel.length})`),
      sel.length ? h('ul', { class: 'bool-list' }, ...sel.slice(0, 40).map((f) => h('li', { class: 'bool-row' }, h('span', { class: 'sw', style: { background: 'rgb(250,128,30)' } }), h('span', { class: 'nm' }, edgeLabel(f)),
        h('button', { class: 'x', 'aria-label': 'Unselect this edge', onclick: () => { t.edges.delete(f.id); flLines(null); flSchedule(); app.refresh(); } }, '×'))), sel.length > 40 ? h('li', { class: 'note' }, `and ${sel.length - 40} more`) : null)
        : h('p', { class: 'note' }, 'No edges selected yet. Hover over the part: the edge under the pointer lights up.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.preview, onchange: (e) => { t.preview = e.target.checked; flSchedule(); } }), 'Show the result in the view'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.keep, onchange: (e) => { t.keep = e.target.checked; } }), 'Keep the original part (hidden)'),
      fl?.busy ? h('p', { class: 'note result working' }, 'Rounding in the background…')
      : fl?.error ? h('div', { class: 'error-box' }, fl.error)
        : res ? h('p', { class: 'note result' }, `Result: ${res.dv < 0 ? 'removes' : 'adds'} ${fmt(Math.abs(res.dv), 1)} mm³${res.parts > 1 ? `, ${res.parts} separate pieces` : ''}. Outside edges are rounded off; inside corners are filled.`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary wide', disabled: !res || !!fl?.error || !!fl?.busy, onclick: applyFillet }, t.type === 'chamfer' ? 'Apply chamfer' : 'Apply fillet'),
        h('button', { class: 'btn wide', onclick: closeFillet }, 'Cancel')),
      h('p', { class: 'note' }, 'The result is a mesh, like a boolean. Where several rounded edges meet at a corner, the corner is rounded by each edge in turn (not a ball corner). Tip: round edges before scaling, and keep the size smaller than the faces next to the edge.'),
    ];
  }
  add0('Fillet edges', () => app.openFillet(), 'E');
  add0('Chamfer edges', () => { app._filletPrefs = { ...(app._filletPrefs || { r: 1, chain: true }), type: 'chamfer' }; app.openFillet(); });

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
