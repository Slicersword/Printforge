// Code models: JavaScript that returns a solid, with parameters that become controls in the panel.
import { registerKind, kindDef, K, free } from './kernel.js';
import { roundedRect } from './shapes.js';
import { gearProfile, threadSection } from './generators.js';
import { h } from './ui.js';

/** Run user code. Returns { man, schema }. */
export function runScript(code, values = {}, kernel = K) {
  const { Manifold, CrossSection } = kernel; const schema = [];
  const toCS = (x) => (x instanceof CrossSection ? x : CrossSection.ofPolygons(Array.isArray(x[0][0]) ? x : [x], 'EvenOdd'));
  const api = {
    Manifold, CrossSection,
    params(spec) {
      const out = {};
      for (const [key, v] of Object.entries(spec)) {
        let f;
        if (Array.isArray(v)) f = { key, label: label(key), type: Number.isInteger(v[0]) && Number.isInteger(v[3] ?? 1) && (v[3] ?? 1) >= 1 ? 'int' : 'num', def: v[0], min: v[1] ?? -1e6, max: v[2] ?? 1e6, step: v[3] ?? 1, unit: '' };
        else if (typeof v === 'boolean') f = { key, label: label(key), type: 'bool', def: v };
        else if (typeof v === 'string') f = { key, label: label(key), type: 'text', def: v };
        else if (v && typeof v === 'object') f = { key, label: v.label || label(key), type: v.options ? 'select' : (v.type || 'num'), def: v.value ?? v.def, min: v.min ?? -1e6, max: v.max ?? 1e6, step: v.step ?? 1, options: v.options, unit: v.unit || '' };
        else continue;
        if (f.type === 'int' && Array.isArray(v) && v.length > 3 && !Number.isInteger(v[3])) f.type = 'num';
        schema.push(f); out[key] = values[key] !== undefined ? values[key] : f.def;
      }
      return out;
    },
    box: (w, d = w, hh = w, r = 0) => (r > 0 ? roundedRect(kernel, w, d, r).extrude(hh) : Manifold.cube([w, d, hh]).translate([-w / 2, -d / 2, 0])),
    cyl: (d, hh, sides = 64) => Manifold.cylinder(hh, d / 2, d / 2, sides),
    cone: (d1, d2, hh, sides = 64) => Manifold.cylinder(hh, Math.max(d1 / 2, 1e-3), d2 / 2, sides),
    ball: (d, seg = 48) => Manifold.sphere(d / 2, seg),
    rect: (w, d = w, r = 0) => roundedRect(kernel, w, d, r),
    circle: (d, seg = 64) => CrossSection.circle(d / 2, seg),
    poly: (pts) => toCS(pts),
    extrude: (cs, hh, o = {}) => toCS(cs).extrude(hh, o.twist ? Math.max(8, Math.round(Math.abs(o.twist) / 5)) : 0, o.twist || 0, o.scale != null ? [o.scale, o.scale] : [1, 1]),
    revolve: (cs, angle = 360, seg = 96) => toCS(cs).revolve(seg, angle),
    union: (...a) => { const l = a.flat().filter(Boolean); return l.length === 1 ? l[0] : (l[0] instanceof CrossSection ? CrossSection.union(l) : Manifold.union(l)); },
    subtract: (a, ...b) => { const l = b.flat().filter(Boolean); return l.length ? a.subtract(l.length === 1 ? l[0] : (a instanceof CrossSection ? CrossSection.union(l) : Manifold.union(l))) : a; },
    intersect: (...a) => { const l = a.flat().filter(Boolean); return l.reduce((x, y) => x.intersect(y)); },
    hull: (...a) => Manifold.hull(a.flat().filter(Boolean)),
    repeat: (n, fn) => { const l = []; for (let i = 0; i < n; i++) { const m = fn(i); if (m) l.push(m); } return l.length ? (l[0] instanceof CrossSection ? CrossSection.union(l) : Manifold.union(l)) : null; },
    gear: (module, teeth, hh, bore = 0) => { let g = gearProfile(kernel, module, teeth); if (bore) g = g.subtract(CrossSection.circle(bore / 2, 40)); return g.extrude(hh); },
    thread: (d, pitch, len) => threadSection(kernel, d / 2, 0.6 * pitch).extrude(len, Math.ceil(len / pitch * 16), 360 * len / pitch),
    PI: Math.PI, sin: (a) => Math.sin(a * Math.PI / 180), cos: (a) => Math.cos(a * Math.PI / 180), tan: (a) => Math.tan(a * Math.PI / 180), sqrt: Math.sqrt, min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  };
  const names = Object.keys(api);
  let result;
  try { result = new Function(...names, `"use strict";\n${code}`)(...names.map((n) => api[n])); }
  catch (e) { throw new Error(friendly(e)); }
  if (Array.isArray(result)) result = api.union(result);
  if (result instanceof CrossSection) result = result.extrude(1);
  if (!(result instanceof Manifold)) throw new Error('The code must end with “return” and a solid, for example: return box(20, 20, 10);');
  return { man: result, schema };
}
function label(k) { return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
function friendly(e) {
  const m = String(e.message || e);
  const line = (e.stack || '').match(/<anonymous>:(\d+):(\d+)/); const where = line ? ` (line ${Math.max(1, line[1] - 3)})` : '';
  if (e instanceof ReferenceError) return `${m}${where}. Check the spelling; the helpers are listed under “What you can use”.`;
  return `${m}${where}`;
}

registerKind('script', {
  label: 'Code model', editor: true, editorLabel: 'Edit code',
  schema: (p) => p._schema || [],
  get params() { return []; },
  build: (p, Kk) => runScript(p._code, p, Kk).man,
});

// ------------------------------------------------------------------ examples
export const EXAMPLES = {
  'Wall hook': `// A screw-on wall hook. Change the numbers in the panel.
const p = params({
  width: [20, 8, 60],
  height: [60, 30, 150],
  reach: [25, 10, 80],
  thickness: [5, 2, 12],
  screw: [4, 2, 6, 0.5],
});
const plate = box(p.width, p.thickness, p.height, 2).rotate([0, 0, 0]);
const arm = hull(
  box(p.width, p.thickness, 1).translate([0, 0, 0]),
  box(p.width, 1, p.thickness).translate([0, p.reach, 0]),
);
const tip = box(p.width, p.thickness, p.reach * 0.6).translate([0, p.reach, 0]);
const holes = [p.height * 0.55, p.height * 0.85].map((z) =>
  cyl(p.screw, 40).rotate([90, 0, 0]).translate([0, 20, z]));
return subtract(union(plate, arm, tip), holes);`,
  'Phone stand': `const p = params({
  width: [70, 40, 120],
  angle: [65, 45, 80],
  phoneThickness: [12, 6, 20, 0.5],
  thickness: [5, 3, 10],
  cableSlot: true,
});
const L = 90, a = p.angle;
const side = poly([
  [0, 0], [L, 0], [L, p.thickness],
  [p.thickness * 2 + p.phoneThickness, p.thickness],
  [p.thickness * 2 + p.phoneThickness, p.thickness + 10],
  [p.thickness + p.phoneThickness, p.thickness + 10],
  [p.thickness + p.phoneThickness + 70 * cos(a), p.thickness + 70 * sin(a)],
  [p.phoneThickness + 70 * cos(a), p.thickness + 70 * sin(a) + p.thickness * 0.6],
  [p.thickness, p.thickness],
]);
let s = extrude(side, p.width).rotate([90, 0, 0]).translate([-L / 2, p.width / 2, 0]);
if (p.cableSlot) s = subtract(s, box(14, 14, 40).translate([-L / 2 + p.thickness + p.phoneThickness / 2 + 10, 0, -1]));
return s;`,
  'Honeycomb coaster': `const p = params({
  diameter: [95, 50, 160],
  height: [5, 2, 12, 0.5],
  cell: [9, 4, 20, 0.5],
  wall: [1.6, 0.8, 4, 0.1],
  rim: [4, 2, 10, 0.5],
});
const R = p.diameter / 2;
const pitch = p.cell + p.wall;
const hexes = [];
for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
  const x = i * pitch + (j % 2 ? pitch / 2 : 0), y = j * pitch * 0.866;
  if (Math.hypot(x, y) < R - p.rim - p.cell / 2) hexes.push(
    poly([0, 1, 2, 3, 4, 5].map((k) => [x + cos(60 * k + 30) * p.cell / 1.732, y + sin(60 * k + 30) * p.cell / 1.732])));
}
const base = cyl(p.diameter, p.height, 128);
const cells = extrude(union(hexes), p.height).translate([0, 0, 1.2]);
return subtract(base, cells);`,
  'Planter with drainage': `const p = params({
  topDiameter: [90, 40, 200],
  bottomDiameter: [65, 30, 200],
  height: [80, 30, 200],
  wall: [2.4, 1.2, 5, 0.2],
  sides: [8, 3, 64],
  drainHoles: [5, 0, 12],
});
const outer = cone(p.bottomDiameter, p.topDiameter, p.height, p.sides);
const inner = cone(p.bottomDiameter - 2 * p.wall, p.topDiameter - 2 * p.wall, p.height, p.sides).translate([0, 0, p.wall]);
const drains = repeat(p.drainHoles, (i) => cyl(5, 10).translate([p.bottomDiameter * 0.25 * cos(i * 360 / Math.max(1, p.drainHoles)), p.bottomDiameter * 0.25 * sin(i * 360 / Math.max(1, p.drainHoles)), -1]));
return subtract(outer, inner, drains);`,
  'Gear pair': `const p = params({ module: [1.5, 0.5, 4, 0.1], teethA: [14, 8, 60], teethB: [28, 8, 80], thickness: [6, 2, 20] });
const a = gear(p.module, p.teethA, p.thickness, 5);
const b = gear(p.module, p.teethB, p.thickness, 5);
const centre = p.module * (p.teethA + p.teethB) / 2;
return union(a, b.rotate([0, 0, 180 / p.teethB]).translate([centre, 0, 0]));`,
};

// ------------------------------------------------------------------ editor
export function openCode(app, obj) {
  const isNew = !obj; let code = isNew ? EXAMPLES['Wall hook'] : obj.params._code; let lastOK = null;
  const ta = h('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Model code' }); ta.value = code;
  const status = h('div', { class: 'code-status' });
  const run = () => {
    code = ta.value;
    try {
      const values = isNew ? {} : { ...obj.params };
      const { man, schema } = runScript(code, values);
      const b = man.boundingBox(); status.className = 'code-status ok';
      status.textContent = `Builds: ${(b.max[0] - b.min[0]).toFixed(1)} × ${(b.max[1] - b.min[1]).toFixed(1)} × ${(b.max[2] - b.min[2]).toFixed(1)} mm, ${man.numTri()} triangles, ${schema.length} parameter${schema.length === 1 ? '' : 's'}.`;
      free(man); lastOK = { schema }; return true;
    } catch (e) { status.className = 'code-status bad'; status.textContent = e.message; lastOK = null; return false; }
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });
  const examples = h('select', { style: { width: 'auto' }, onchange: (e) => { if (!e.target.value) return; ta.value = EXAMPLES[e.target.value]; e.target.value = ''; run(); } }, h('option', { value: '' }, 'Load an example…'), ...Object.keys(EXAMPLES).map((k) => h('option', { value: k }, k)));
  const apply = () => {
    if (!run()) return; d.close();
    const vals = {}; for (const f of lastOK.schema) vals[f.key] = (!isNew && obj.params[f.key] !== undefined) ? obj.params[f.key] : f.def;
    const params = { _code: code, _schema: lastOK.schema, ...vals };
    if (isNew) app.addShape('script', params, { name: 'Code model' }); else app.setParams(obj, params, 'edit code');
  };
  const help = h('details', { class: 'code-help' }, h('summary', {}, 'What you can use'), h('div', { html: `
<p><b>Parameters:</b> <code>params({ width: [40, 10, 200], round: true, style: { options: ['a','b'], value: 'a' } })</code> gives you the values and adds controls to the panel. Arrays are <code>[default, min, max, step]</code>.</p>
<p><b>Solids</b> (sit on the plate, centred): <code>box(w, d, h, r)</code>, <code>cyl(d, h, sides)</code>, <code>cone(d1, d2, h)</code>, <code>ball(d)</code>, <code>gear(module, teeth, h, bore)</code>, <code>thread(d, pitch, length)</code></p>
<p><b>2D:</b> <code>rect(w, d, r)</code>, <code>circle(d)</code>, <code>poly([[x,y], …])</code>, then <code>extrude(shape, h, { twist, scale })</code> or <code>revolve(shape, angle)</code></p>
<p><b>Combine:</b> <code>union(a, b)</code>, <code>subtract(a, b, c)</code>, <code>intersect(a, b)</code>, <code>hull(a, b)</code>, <code>repeat(n, i =&gt; …)</code></p>
<p><b>Move:</b> <code>.translate([x, y, z])</code>, <code>.rotate([x, y, z])</code> in degrees, <code>.scale([x, y, z])</code>, <code>.mirror([1, 0, 0])</code></p>
<p><b>Maths:</b> <code>sin</code>, <code>cos</code>, <code>tan</code> take degrees. The full Manifold library is available as <code>Manifold</code> and <code>CrossSection</code>.</p>` }));
  const d = app.modal(isNew ? 'New code model' : `Edit code: ${obj.name}`,
    h('div', { class: 'code-wrap' }, h('div', { class: 'code-bar' }, examples, h('button', { class: 'btn', onclick: run }, 'Check (Ctrl+Enter)')), ta, status, help),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: apply }, isNew ? 'Add to plate' : 'Update model')));
  d.classList.add('wide'); run(); setTimeout(() => ta.focus(), 50);
}

export function install(app) {
  app.editors = app.editors || {}; app.editors.script = (o) => openCode(app, o);
  app.library.addTab('code', 'Code', (el) => {
    el.append(h('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => openCode(app, null) }, 'New code model'));
    el.append(h('p', { class: 'note', style: { margin: '8px 0' } }, 'Write a model in JavaScript. Every value in params() becomes a control in the panel, so you can tune the part without touching code again. Good for asking an AI assistant to write parts for you, too.'));
    el.append(h('div', { class: 'group-label' }, 'Examples'));
    el.append(h('div', { class: 'gen-list' }, ...Object.keys(EXAMPLES).map((k) => h('button', { class: 'gen-btn', style: { gridTemplateColumns: '1fr' }, onclick: () => {
      try { const { man, schema } = runScript(EXAMPLES[k]); free(man); const vals = {}; schema.forEach((f) => { vals[f.key] = f.def; }); app.addShape('script', { _code: EXAMPLES[k], _schema: schema, ...vals }, { name: k }); }
      catch (e) { app.toast(e.message, 4000); }
    } }, h('b', {}, k), h('span', {}, 'Parametric code model')))));
  });
}
void kindDef;
