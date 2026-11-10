// 2D sketch editor -> extrude / revolve. Nested shapes become holes (even-odd), like PaliCAD's sketch regions.
import { registerKind, kindDef, K, free } from './kernel.js';
import { circlePts, roundedRect } from './shapes.js';
import { h, numField, row, paramForm } from './ui.js';
import { fmt } from './math.js';

const OP_PARAMS = [
  { key: 'op', label: 'Make solid by', type: 'select', def: 'extrude', options: [['extrude', 'Extruding'], ['revolve', 'Revolving around the Y axis']] },
  { key: 'height', label: 'Height', type: 'num', def: 10, min: 0.1, max: 2000, step: 0.5, unit: 'mm', when: (p) => p.op === 'extrude' },
  { key: 'taper', label: 'Top size', type: 'num', def: 100, min: 0, max: 400, step: 5, unit: '%', when: (p) => p.op === 'extrude' },
  { key: 'twist', label: 'Twist', type: 'num', def: 0, min: -3600, max: 3600, step: 15, unit: '°', when: (p) => p.op === 'extrude' },
  { key: 'angle', label: 'Revolve angle', type: 'num', def: 360, min: 1, max: 360, step: 15, unit: '°', when: (p) => p.op === 'revolve' },
  { key: 'combine', label: 'Overlaps', type: 'select', def: 'evenodd', options: [['evenodd', 'Inner shapes cut holes'], ['union', 'Merge everything']] },
  { key: 'plane', label: 'Lay the sketch', type: 'select', def: 'flat', options: [['flat', 'Flat on the plate'], ['upright', 'Standing up (front view)']] },
];

export function entityPolys(e) {
  switch (e.t) {
    case 'rect': { const r = Math.min(e.r || 0, e.w / 2 - 0.001, e.h / 2 - 0.001); if (r <= 0.01) return [[[e.x - e.w / 2, e.y - e.h / 2], [e.x + e.w / 2, e.y - e.h / 2], [e.x + e.w / 2, e.y + e.h / 2], [e.x - e.w / 2, e.y + e.h / 2]]];
      const pts = []; for (const [cx, cy, a0] of [[e.w / 2 - r, e.h / 2 - r, 0], [-e.w / 2 + r, e.h / 2 - r, 90], [-e.w / 2 + r, -e.h / 2 + r, 180], [e.w / 2 - r, -e.h / 2 + r, 270]]) for (let i = 0; i <= 8; i++) { const a = (a0 + i * 90 / 8) * Math.PI / 180; pts.push([e.x + cx + Math.cos(a) * r, e.y + cy + Math.sin(a) * r]); } return [pts]; }
    case 'circle': return [circlePts(e.d / 2, Math.max(24, Math.min(128, Math.round(e.d * 3)))).map(([x, y]) => [x + e.x, y + e.y])];
    case 'poly': return [circlePts(e.d / 2, e.n, Math.PI / 2 + (e.a || 0) * Math.PI / 180).map(([x, y]) => [x + e.x, y + e.y])];
    case 'slot': { const r = e.w / 2, L = Math.max(0, e.l - e.w) / 2, a = (e.a || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); const pts = [];
      for (let i = 0; i <= 16; i++) { const t = -Math.PI / 2 + (i / 16) * Math.PI; pts.push([L + Math.cos(t) * r, Math.sin(t) * r]); }
      for (let i = 0; i <= 16; i++) { const t = Math.PI / 2 + (i / 16) * Math.PI; pts.push([-L + Math.cos(t) * r, Math.sin(t) * r]); }
      return [pts.map(([x, y]) => [e.x + x * c - y * s, e.y + x * s + y * c])]; }
    case 'path': return e.pts.length >= 3 ? [e.pts.map(([x, y]) => [x, y])] : [];
  }
  return [];
}
function profile(K, p) {
  const polys = p.entities.flatMap(entityPolys).filter((q) => q.length >= 3);
  if (!polys.length) throw new Error('This sketch has no closed shapes yet. Edit the sketch to draw one.');
  if (p.combine === 'union') return K.CrossSection.union(polys.map((q) => K.CrossSection.ofPolygons([q], 'NonZero')));
  return K.CrossSection.ofPolygons(polys, 'EvenOdd');
}
registerKind('sketch', {
  label: 'Sketch', params: OP_PARAMS, editor: true, editorLabel: 'Edit sketch',
  build: (p, K) => {
    let cs = profile(K, p); let m;
    if (p.op === 'revolve') {
      cs = cs.intersect(K.CrossSection.square([1e4, 1e4]).translate([0, -5e3]));
      if (cs.isEmpty()) throw new Error('To revolve, draw on the right of the Y axis (x > 0).');
      m = cs.revolve(96, p.angle);
    } else {
      const s = p.taper / 100; m = cs.extrude(p.height, p.twist ? Math.max(8, Math.round(Math.abs(p.twist) / 5)) : 0, p.twist || 0, [s, s]);
    }
    if (p.plane === 'upright' && p.op === 'extrude') m = m.rotate([90, 0, 0]);
    return m;
  },
});

// ------------------------------------------------------------------ editor
const TOOLS = [
  ['select', 'Select', '<path d="M5 3l14 8-6 2-3 6z"/>', 'V'], ['rect', 'Rectangle', '<rect x="4" y="6" width="16" height="12" rx="1"/>', 'R'],
  ['circle', 'Circle', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1"/>', 'C'], ['poly', 'Polygon', '<path d="M12 3l8 5v8l-8 5-8-5V8z"/>', 'P'],
  ['slot', 'Slot', '<rect x="3" y="8" width="18" height="8" rx="4"/>', 'S'], ['path', 'Outline (click points)', '<path d="M4 18L9 6l5 8 6-9"/><circle cx="4" cy="18" r="1.4"/><circle cx="20" cy="5" r="1.4"/>', 'L'],
];

export function openSketch(app, obj) {
  const isNew = !obj;
  const p = isNew ? { op: 'extrude', height: 10, taper: 100, twist: 0, angle: 360, combine: 'evenodd', plane: 'flat', entities: [] } : JSON.parse(JSON.stringify(obj.params));
  const st = { tool: p.entities.length ? 'select' : 'rect', sel: -1, scale: 4, ox: 0, oy: 0, snap: 1, drag: null, path: null, hover: null };
  const hist = [];
  const push = () => { hist.push(JSON.stringify(p.entities)); if (hist.length > 80) hist.shift(); };

  const cv = h('canvas', { class: 'sk-canvas', tabindex: '0', 'aria-label': 'Sketch canvas' });
  const side = h('div', { class: 'sk-side' });
  const tb = h('div', { class: 'sk-tools', role: 'toolbar' });
  const hint = h('div', { class: 'sk-hint' });
  const dims = h('div', { class: 'sk-dims' });
  const wrap = h('div', { class: 'sk-wrap' }, tb, h('div', { class: 'sk-stage' }, cv, hint, dims), side);

  const d = app.modal(isNew ? 'New sketch' : `Edit sketch: ${obj.name}`, wrap,
    h('div', { class: 'modal-foot' },
      h('span', { class: 'note', style: { marginRight: 'auto' } }, 'Grid snap ', snapSel()),
      h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: apply }, isNew ? 'Create solid' : 'Update solid')));
  d.classList.add('wide');

  function snapSel() { return h('select', { onchange: (e) => { st.snap = +e.target.value; }, style: { width: 'auto' } }, ...[0, 0.1, 0.5, 1, 2, 5].map((v) => h('option', { value: v, selected: v === st.snap }, v ? `${v} mm` : 'off'))); }
  function apply() {
    if (!p.entities.length) { hint.textContent = 'Draw at least one closed shape first.'; return; }
    try { free(kindDef('sketch').build(p, K)); } catch (e) { hint.textContent = e.message; return; }
    d.close();
    if (isNew) app.addShape('sketch', p, { name: 'Sketch ' + (app.scene.objects.filter((o) => o.kind === 'sketch').length + 1) });
    else app.setParams(obj, p, 'edit sketch');
  }

  const S = (v) => (st.snap ? Math.round(v / st.snap) * st.snap : Math.round(v * 100) / 100);
  const toMM = (px, py) => [(px - cv.clientWidth / 2) / st.scale + st.ox, -(py - cv.clientHeight / 2) / st.scale + st.oy];
  const toPX = (x, y) => [(x - st.ox) * st.scale + cv.clientWidth / 2, -(y - st.oy) * st.scale + cv.clientHeight / 2];

  function renderTools() {
    tb.replaceChildren(...TOOLS.map(([id, label, svg, key]) => h('button', { 'aria-pressed': String(st.tool === id), title: `${label} (${key})`, onclick: () => { st.tool = id; st.path = null; renderTools(); draw(); }, html: `<svg viewBox="0 0 24 24">${svg}</svg>` })),
      h('span', { class: 'sk-sep' }),
      h('button', { title: 'Undo (Ctrl+Z)', onclick: undo, html: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>' }),
      h('button', { title: 'Fit view', onclick: () => { fit(); draw(); }, html: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>' }));
    hint.textContent = { select: 'Click a shape to select and drag it. Delete removes it.', rect: 'Drag from one corner to the other, then type exact sizes on the right.', circle: 'Drag from the centre outwards.', poly: 'Drag from the centre outwards.', slot: 'Drag from one end to the other.', path: 'Click to add points. Click the first point, double-click or press Enter to close. Esc cancels.' }[st.tool];
  }
  function undo() { if (!hist.length) return; p.entities = JSON.parse(hist.pop()); st.sel = -1; renderSide(); draw(); }
  function fit() {
    const pts = p.entities.flatMap(entityPolys).flat(); const W = cv.clientWidth || 600, H = cv.clientHeight || 400;
    if (!pts.length) { st.ox = 0; st.oy = 0; st.scale = Math.min(W, H) / 120; return; }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    st.ox = (x0 + x1) / 2; st.oy = (y0 + y1) / 2; st.scale = Math.min((W - 80) / Math.max(10, x1 - x0), (H - 80) / Math.max(10, y1 - y0));
  }

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement); const ink = css.getPropertyValue('--ink').trim(), line = css.getPropertyValue('--line').trim(), acc = css.getPropertyValue('--accent').trim(), muted = css.getPropertyValue('--muted').trim();
    c.fillStyle = css.getPropertyValue('--bg').trim(); c.fillRect(0, 0, W, H);
    // grid
    let step = 1; while (step * st.scale < 8) step *= step === 1 ? 5 : 2;
    const [mx0, my1] = toMM(0, 0), [mx1, my0] = toMM(W, H);
    c.lineWidth = 1;
    for (const [s, a] of [[step, 0.35], [step * 10, 0.8]]) {
      c.strokeStyle = line; c.globalAlpha = a; c.beginPath();
      for (let x = Math.floor(mx0 / s) * s; x <= mx1; x += s) { const [px] = toPX(x, 0); c.moveTo(Math.round(px) + 0.5, 0); c.lineTo(Math.round(px) + 0.5, H); }
      for (let y = Math.floor(my0 / s) * s; y <= my1; y += s) { const [, py] = toPX(0, y); c.moveTo(0, Math.round(py) + 0.5); c.lineTo(W, Math.round(py) + 0.5); }
      c.stroke();
    }
    c.globalAlpha = 1; const [ax, ay] = toPX(0, 0);
    c.strokeStyle = '#D04A43'; c.beginPath(); c.moveTo(0, ay); c.lineTo(W, ay); c.stroke();
    c.strokeStyle = '#3E9A45'; c.beginPath(); c.moveTo(ax, 0); c.lineTo(ax, H); c.stroke();
    if (p.op === 'revolve') { c.fillStyle = 'rgba(128,128,128,.12)'; c.fillRect(0, 0, ax, H); }
    // filled region (even-odd preview)
    const polys = p.entities.flatMap(entityPolys);
    c.beginPath(); for (const q of polys) q.forEach(([x, y], i) => { const [px, py] = toPX(x, y); i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.fillStyle = acc; c.globalAlpha = 0.22; c.fill(p.combine === 'union' ? 'nonzero' : 'evenodd'); c.globalAlpha = 1;
    p.entities.forEach((e, i) => {
      c.strokeStyle = i === st.sel ? acc : ink; c.lineWidth = i === st.sel ? 2.4 : 1.4;
      for (const q of entityPolys(e)) { c.beginPath(); q.forEach(([x, y], k) => { const [px, py] = toPX(x, y); k ? c.lineTo(px, py) : c.moveTo(px, py); }); c.closePath(); c.stroke(); }
      if (e.t === 'path' && i === st.sel) e.pts.forEach(([x, y]) => { const [px, py] = toPX(x, y); c.fillStyle = acc; c.fillRect(px - 3, py - 3, 6, 6); });
    });
    if (st.path) {
      c.strokeStyle = acc; c.lineWidth = 1.6; c.setLineDash([5, 4]); c.beginPath();
      [...st.path, st.hover].filter(Boolean).forEach(([x, y], i) => { const [px, py] = toPX(x, y); i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); c.setLineDash([]);
      const [fx, fy] = toPX(...st.path[0]); c.strokeStyle = acc; c.strokeRect(fx - 5, fy - 5, 10, 10);
    }
    if (st.hover) { const [px, py] = toPX(...st.hover); c.strokeStyle = muted; c.beginPath(); c.arc(px, py, 3, 0, 7); c.stroke(); }
  }

  function hit(x, y) {
    for (let i = p.entities.length - 1; i >= 0; i--) for (const q of entityPolys(p.entities[i])) {
      let inside = false; for (let a = 0, b = q.length - 1; a < q.length; b = a++) { const [xa, ya] = q[a], [xb, yb] = q[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; }
      if (inside) return i;
      for (let a = 0; a < q.length; a++) { const [x1, y1] = q[a], [x2, y2] = q[(a + 1) % q.length]; const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1e-9; const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L2)); if (Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1)) * st.scale < 6) return i; }
    }
    return -1;
  }
  const showDims = (text, px, py) => { dims.textContent = text; dims.style.left = px + 'px'; dims.style.top = py + 'px'; dims.hidden = !text; };

  cv.addEventListener('pointerdown', (ev) => {
    cv.focus(); cv.setPointerCapture(ev.pointerId); const [mx, my] = toMM(ev.offsetX, ev.offsetY); const x = S(mx), y = S(my);
    if (ev.button === 1 || ev.button === 2) { st.drag = { pan: true, px: ev.offsetX, py: ev.offsetY }; return; }
    if (st.tool === 'select') {
      const i = hit(mx, my); st.sel = i; renderSide();
      if (i >= 0) { push(); const e = p.entities[i]; st.drag = { move: true, x0: x, y0: y, orig: JSON.parse(JSON.stringify(e)) }; }
      else st.drag = { pan: true, px: ev.offsetX, py: ev.offsetY };
      draw(); return;
    }
    if (st.tool === 'path') {
      if (!st.path) st.path = [[x, y]];
      else { const [fx, fy] = toPX(...st.path[0]); if (Math.hypot(fx - ev.offsetX, fy - ev.offsetY) < 9 && st.path.length >= 3) { closePath(); return; } st.path.push([x, y]); }
      draw(); return;
    }
    push();
    const e = st.tool === 'rect' ? { t: 'rect', x, y, w: 0, h: 0, r: 0 } : st.tool === 'circle' ? { t: 'circle', x, y, d: 0 } : st.tool === 'poly' ? { t: 'poly', x, y, d: 0, n: 6, a: 0 } : { t: 'slot', x, y, l: 0, w: 6, a: 0 };
    p.entities.push(e); st.sel = p.entities.length - 1; st.drag = { create: true, x0: x, y0: y };
  });
  cv.addEventListener('pointermove', (ev) => {
    const [mx, my] = toMM(ev.offsetX, ev.offsetY); const x = S(mx), y = S(my); st.hover = [x, y];
    const dg = st.drag;
    if (dg?.pan) { st.ox -= (ev.offsetX - dg.px) / st.scale; st.oy += (ev.offsetY - dg.py) / st.scale; dg.px = ev.offsetX; dg.py = ev.offsetY; }
    else if (dg?.move) {
      const e = p.entities[st.sel]; const dx = x - dg.x0, dy = y - dg.y0;
      if (e.t === 'path') e.pts = dg.orig.pts.map(([px, py]) => [px + dx, py + dy]); else { e.x = dg.orig.x + dx; e.y = dg.orig.y + dy; }
      showDims(`Δ ${fmt(dx)}, ${fmt(dy)}`, ev.offsetX + 14, ev.offsetY - 10);
    } else if (dg?.create) {
      const e = p.entities[st.sel]; const dx = x - dg.x0, dy = y - dg.y0;
      if (e.t === 'rect') { e.w = Math.abs(dx); e.h = Math.abs(dy); e.x = dg.x0 + dx / 2; e.y = dg.y0 + dy / 2; showDims(`${fmt(e.w)} × ${fmt(e.h)} mm`, ev.offsetX + 14, ev.offsetY - 10); }
      else if (e.t === 'circle' || e.t === 'poly') { e.d = 2 * Math.hypot(dx, dy); if (st.snap) e.d = Math.round(e.d / st.snap) * st.snap; showDims(`⌀ ${fmt(e.d)} mm`, ev.offsetX + 14, ev.offsetY - 10); }
      else { e.l = Math.hypot(dx, dy) + e.w; e.x = dg.x0 + dx / 2; e.y = dg.y0 + dy / 2; e.a = Math.round(Math.atan2(dy, dx) * 180 / Math.PI * 10) / 10; showDims(`${fmt(e.l)} mm`, ev.offsetX + 14, ev.offsetY - 10); }
    } else if (st.path) showDims(`${fmt(x)}, ${fmt(y)}`, ev.offsetX + 14, ev.offsetY - 10);
    else showDims('', 0, 0);
    draw();
  });
  cv.addEventListener('pointerup', () => {
    const dg = st.drag; st.drag = null; showDims('', 0, 0);
    if (dg?.create) {
      const e = p.entities[st.sel]; const tiny = (e.t === 'rect' && (e.w < 0.05 || e.h < 0.05)) || ((e.t === 'circle' || e.t === 'poly') && e.d < 0.05) || (e.t === 'slot' && e.l <= e.w + 0.01);
      if (tiny) { // a click without drag: place a default-size shape
        if (e.t === 'rect') { e.w = 20; e.h = 10; } else if (e.t === 'circle' || e.t === 'poly') e.d = 10; else e.l = 20;
      }
      renderSide(); setTimeout(() => side.querySelector('input.num')?.focus(), 0);
    }
    draw();
  });
  cv.addEventListener('dblclick', () => { if (st.path && st.path.length >= 3) closePath(); });
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); const [mx, my] = toMM(ev.offsetX, ev.offsetY); const k = Math.exp(-ev.deltaY * 0.0015); st.scale = Math.min(200, Math.max(0.2, st.scale * k)); const [nx, ny] = toMM(ev.offsetX, ev.offsetY); st.ox += mx - nx; st.oy += my - ny; draw(); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); const k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); undo(); return; }
    if (k === 'enter' && st.path) { if (st.path.length >= 3) closePath(); return; }
    if (k === 'escape') { ev.preventDefault(); if (st.path) { st.path = null; draw(); } else if (st.sel >= 0) { st.sel = -1; renderSide(); draw(); } return; }
    if ((k === 'delete' || k === 'backspace') && st.sel >= 0) { push(); p.entities.splice(st.sel, 1); st.sel = -1; renderSide(); draw(); return; }
    const t = TOOLS.find((x) => x[3].toLowerCase() === k); if (t && !ev.ctrlKey && !ev.metaKey) { st.tool = t[0]; st.path = null; renderTools(); draw(); }
  });
  function closePath() { push(); p.entities.push({ t: 'path', pts: st.path }); st.path = null; st.sel = p.entities.length - 1; renderSide(); draw(); }

  function renderSide() {
    const parts = [];
    const e = p.entities[st.sel];
    if (e) {
      const set = (k) => (v) => { push(); e[k] = v; draw(); };
      const f = (label, k, o = {}) => row(label, numField(e[k] ?? 0, set(k), { step: 1, ...o }));
      const title = { rect: 'Rectangle', circle: 'Circle', poly: 'Polygon', slot: 'Slot', path: 'Outline' }[e.t];
      parts.push(h('h3', {}, title));
      if (e.t === 'rect') parts.push(f('Width', 'w', { min: 0.01 }), f('Height', 'h', { min: 0.01 }), f('Centre X', 'x'), f('Centre Y', 'y'), f('Corner radius', 'r', { min: 0, step: 0.5 }));
      if (e.t === 'circle') parts.push(f('Diameter', 'd', { min: 0.01 }), f('Centre X', 'x'), f('Centre Y', 'y'));
      if (e.t === 'poly') parts.push(f('Corner diameter', 'd', { min: 0.01 }), f('Sides', 'n', { min: 3, max: 64, int: true }), f('Centre X', 'x'), f('Centre Y', 'y'), f('Rotation °', 'a', { step: 15 }));
      if (e.t === 'slot') parts.push(f('Length', 'l', { min: 0.01 }), f('Width', 'w', { min: 0.01 }), f('Centre X', 'x'), f('Centre Y', 'y'), f('Angle °', 'a', { step: 15 }));
      if (e.t === 'path') parts.push(h('p', { class: 'note' }, `${e.pts.length} points. Drag to move the whole outline.`));
      parts.push(h('fieldset', {}, h('legend', {}, 'Repeat this shape'), patternUI(e)));
      parts.push(h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { push(); const c = JSON.parse(JSON.stringify(e)); if (c.t === 'path') c.pts = c.pts.map(([x, y]) => [-x, y]); else c.x = -c.x; if (c.a) c.a = 180 - c.a; p.entities.push(c); st.sel = p.entities.length - 1; renderSide(); draw(); } }, 'Mirror copy'),
        h('button', { class: 'btn danger', onclick: () => { push(); p.entities.splice(st.sel, 1); st.sel = -1; renderSide(); draw(); } }, 'Delete')));
    } else {
      parts.push(h('h3', {}, 'Sketch'), h('p', { class: 'note' }, `${p.entities.length} shape${p.entities.length === 1 ? '' : 's'}. Shapes inside other shapes become holes, so a circle inside a rectangle makes a plate with a hole.`));
    }
    parts.push(h('fieldset', {}, h('legend', {}, 'Turn into a solid'), ...paramForm(OP_PARAMS, p, (np) => { Object.assign(p, np); renderSide(); draw(); }).childNodes));
    side.replaceChildren(...parts);
  }
  function patternUI(e) {
    const st2 = { nx: 3, dx: 15, ny: 1, dy: 15, nc: 6, cr: 0 };
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      row('Columns × spacing', h('div', { style: { display: 'flex', gap: '4px' } }, numField(st2.nx, (v) => { st2.nx = v; }, { int: true, min: 1, max: 100 }), numField(st2.dx, (v) => { st2.dx = v; }))),
      row('Rows × spacing', h('div', { style: { display: 'flex', gap: '4px' } }, numField(st2.ny, (v) => { st2.ny = v; }, { int: true, min: 1, max: 100 }), numField(st2.dy, (v) => { st2.dy = v; }))),
      h('button', { class: 'btn', onclick: () => { push(); for (let i = 0; i < st2.nx; i++) for (let j = 0; j < st2.ny; j++) { if (!i && !j) continue; const c = JSON.parse(JSON.stringify(e)); if (c.t === 'path') c.pts = c.pts.map(([x, y]) => [x + i * st2.dx, y + j * st2.dy]); else { c.x += i * st2.dx; c.y += j * st2.dy; } p.entities.push(c); } draw(); } }, 'Make grid'),
      row('Copies around 0,0', numField(st2.nc, (v) => { st2.nc = v; }, { int: true, min: 2, max: 360 })),
      h('button', { class: 'btn', onclick: () => { push(); for (let i = 1; i < st2.nc; i++) { const a = (i / st2.nc) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); const k = JSON.parse(JSON.stringify(e)); if (k.t === 'path') k.pts = k.pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); else { const x = k.x, y = k.y; k.x = x * c - y * s; k.y = x * s + y * c; if ('a' in k) k.a = (k.a || 0) + (i * 360) / st2.nc; } p.entities.push(k); } draw(); } }, 'Make circle'));
  }

  renderTools(); renderSide();
  requestAnimationFrame(() => { fit(); draw(); });
  new ResizeObserver(() => draw()).observe(cv);
  cv.focus();
  return d;
}

// ------------------------------------------------------------------ templates
const TEMPLATES = [
  { name: 'Mounting plate', blurb: '90 × 50 × 8 mm plate with a 24 mm hole (the PaliCAD tutorial).', p: { op: 'extrude', height: 8, taper: 100, twist: 0, angle: 360, combine: 'evenodd', plane: 'flat', entities: [{ t: 'rect', x: 0, y: 0, w: 90, h: 50, r: 0 }, { t: 'circle', x: 0, y: 0, d: 24 }] } },
  { name: 'Bracket with slots', blurb: 'L-shaped outline with two adjustment slots.', p: { op: 'extrude', height: 5, taper: 100, twist: 0, angle: 360, combine: 'evenodd', plane: 'flat', entities: [{ t: 'path', pts: [[-30, -15], [30, -15], [30, -3], [-18, -3], [-18, 25], [-30, 25]] }, { t: 'slot', x: 12, y: -9, l: 16, w: 4.4, a: 0 }, { t: 'slot', x: -24, y: 13, l: 14, w: 4.4, a: 90 }] } },
  { name: 'Pulley', blurb: 'Grooved wheel made by revolving a profile.', p: { op: 'revolve', height: 10, taper: 100, twist: 0, angle: 360, combine: 'evenodd', plane: 'flat', entities: [{ t: 'path', pts: [[2.6, -6], [20, -6], [20, -4], [16, -1.5], [16, 1.5], [20, 4], [20, 6], [2.6, 6]] }] } },
  { name: 'Twisted vase blank', blurb: 'Star outline extruded with a twist and narrower top.', p: { op: 'extrude', height: 60, taper: 70, twist: 120, angle: 360, combine: 'evenodd', plane: 'flat', entities: [{ t: 'poly', x: 0, y: 0, d: 50, n: 8, a: 0 }] } },
];
export function install(app) {
  app.editors = app.editors || {}; app.editors.sketch = (o) => openSketch(app, o);
  app.addAction({ label: 'New sketch', group: 'Sketch', run: () => { app.setMode('design'); openSketch(app, null); } });
  app.addAction({ label: 'Trace an image or logo', group: 'Sketch', run: () => { app.setMode('design'); app.openTraceDialog?.(); } });
  for (const t of TEMPLATES) app.addAction({ label: t.name, group: 'Sketch example', run: () => { app.setMode('design'); app.addShape('sketch', JSON.parse(JSON.stringify(t.p)), { name: t.name }); } });
  app.library.addTab('sketch', 'Sketch', (el) => {
    el.append(h('button', { class: 'btn primary', style: { width: '100%', marginBottom: '6px' }, onclick: () => openSketch(app, null) }, 'New sketch'));
    el.append(h('button', { class: 'btn', style: { width: '100%' }, onclick: () => app.openTraceDialog?.() }, 'Trace an image or logo…'));
    el.append(h('p', { class: 'note', style: { margin: '8px 0' } }, 'Draw a 2D profile with exact sizes, then extrude or revolve it. Double-click a sketch on the plate to edit it again.'));
    el.append(h('div', { class: 'group-label' }, 'Start from an example'));
    el.append(h('div', { class: 'gen-list' }, ...TEMPLATES.map((t) => h('button', { class: 'gen-btn', style: { gridTemplateColumns: '1fr' }, onclick: () => app.addShape('sketch', JSON.parse(JSON.stringify(t.p)), { name: t.name }) }, h('b', {}, t.name), h('span', {}, t.blurb)))));
  });
}
void roundedRect;
