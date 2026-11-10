// Text and image tracing: rasterise with the browser, trace contours (marching squares), extrude.
import { defineShape } from './shapes.js';
import { h, numField, row } from './ui.js';

/** Trace iso-contours of a scalar grid (values 0..1, row-major w*h). Returns loops in pixel coords. */
export function traceContours(f, w, hgt, th = 0.5) {
  const W = w + 2, H = hgt + 2; const g = new Float32Array(W * H); // pad with zeros so every loop closes
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = f[y * w + x];
  const adj = new Map(); const pt = new Map();
  const edgePoint = (key, ax, ay, bx, by) => {
    if (!pt.has(key)) { const a = g[ay * W + ax], b = g[by * W + bx]; const t = Math.abs(b - a) < 1e-9 ? 0.5 : (th - a) / (b - a); pt.set(key, [ax + (bx - ax) * t - 1, ay + (by - ay) * t - 1]); }
    return key;
  };
  const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const tl = g[y * W + x] >= th, tr = g[y * W + x + 1] >= th, br = g[(y + 1) * W + x + 1] >= th, bl = g[(y + 1) * W + x] >= th;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0); if (c === 0 || c === 15) continue;
    const T = () => edgePoint(`h${x},${y}`, x, y, x + 1, y), B = () => edgePoint(`h${x},${y + 1}`, x, y + 1, x + 1, y + 1);
    const L = () => edgePoint(`v${x},${y}`, x, y, x, y + 1), R = () => edgePoint(`v${x + 1},${y}`, x + 1, y, x + 1, y + 1);
    const centre = (g[y * W + x] + g[y * W + x + 1] + g[(y + 1) * W + x + 1] + g[(y + 1) * W + x]) / 4 >= th;
    switch (c) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: if (centre) { link(L(), T()); link(B(), R()); } else { link(T(), R()); link(L(), B()); } break;
      case 10: if (centre) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
    }
  }
  const loops = []; const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue; const loop = []; let prev = null, cur = start;
    while (cur && !seen.has(cur)) { seen.add(cur); loop.push(pt.get(cur)); const nb = adj.get(cur); const next = nb[0] !== prev ? nb[0] : nb[1]; prev = cur; cur = next; }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
export function simplify(pts, tol) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export function simplifyClosed(l, tol) {
  if (l.length < 8) return l;
  let k = 0, md = -1; for (let i = 1; i < l.length; i++) { const d = (l[i][0] - l[0][0]) ** 2 + (l[i][1] - l[0][1]) ** 2; if (d > md) { md = d; k = i; } }
  const a = simplify(l.slice(0, k + 1), tol), b = simplify([...l.slice(k), l[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

/** Canvas alpha/luminance -> loops in mm (y up), centred. */
function canvasToLoops(ctx, w, hh, ppm, mode = 'alpha', threshold = 0.5, invert = false) {
  const d = ctx.getImageData(0, 0, w, hh).data; const f = new Float32Array(w * hh);
  for (let i = 0; i < w * hh; i++) {
    let v = mode === 'alpha' ? d[i * 4 + 3] / 255 : (1 - (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255) * (d[i * 4 + 3] / 255);
    if (invert) v = 1 - v; f[i] = v;
  }
  const loops = traceContours(f, w, hh, threshold).map((l) => simplifyClosed(l, 0.3)).filter((l) => l.length >= 3 && Math.abs(area(l)) > 2);
  return loops.map((l) => l.map(([x, y]) => [Math.round((x / ppm) * 1000) / 1000, Math.round((-y / ppm) * 1000) / 1000]));
}

// ------------------------------------------------------------------ text
const FONTS = [['Barlow', 'Barlow (app font)'], ['Arial, Helvetica, sans-serif', 'Sans-serif'], ['Arial Black, Arial, sans-serif', 'Heavy sans'], ['Georgia, Times New Roman, serif', 'Serif'], ['Courier New, monospace', 'Monospace'], ['Impact, sans-serif', 'Condensed'], ['Comic Sans MS, cursive', 'Rounded casual'], ['Brush Script MT, cursive', 'Script']];
let textCanvas = null;
function textLoops(p) {
  if (typeof document === 'undefined') throw new Error('Text needs a browser.');
  textCanvas ||= document.createElement('canvas');
  const lines = String(p.text || ' ').split('\n'); let ppm = 12; const font = (px) => `${p.italic ? 'italic ' : ''}${p.bold ? 700 : 400} ${px}px ${p.font}`;
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
  let px = p.size * ppm * 1.32; ctx.font = font(px);
  let maxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.2 * Math.max(0, p.spacing);
  if (maxW > 3800) { ppm *= 3800 / maxW; px = p.size * ppm * 1.32; ctx.font = font(px); maxW = Math.max(...lines.map((l) => ctx.measureText(l).width)); }
  const lineH = px * p.lineGap; const W = Math.ceil(maxW + px * 0.6 + lines.reduce((m, l) => Math.max(m, l.length), 0) * p.spacing * ppm), H = Math.ceil(lineH * lines.length + px * 0.6);
  textCanvas.width = W; textCanvas.height = H; ctx.clearRect(0, 0, W, H); ctx.font = font(px); ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
  try { ctx.letterSpacing = `${p.spacing * ppm}px`; } catch { /* older browsers */ }
  lines.forEach((l, i) => { const tw = ctx.measureText(l).width; const x = p.align === 'left' ? px * 0.3 : p.align === 'right' ? W - px * 0.3 - tw : (W - tw) / 2; ctx.fillText(l, x, px * 0.3 + px * 0.8 + i * lineH); });
  return canvasToLoops(ctx, W, H, ppm);
}
defineShape('text', {
  label: 'Text', category: 'Basic', icon: 'text',
  note: 'Uses fonts installed on this device. To make sure the text looks the same on another computer, use “Freeze as mesh”.',
  params: [{ key: 'text', label: 'Text', type: 'text', def: 'PrintForge' }, { key: 'font', label: 'Font', type: 'select', def: 'Arial Black, Arial, sans-serif', options: FONTS },
    { key: 'size', label: 'Letter height', type: 'num', def: 10, min: 1, max: 300, step: 0.5, unit: 'mm' }, { key: 'depth', label: 'Depth', type: 'num', def: 3, min: 0.2, max: 200, step: 0.2, unit: 'mm' },
    { key: 'bold', label: 'Bold', type: 'bool', def: true }, { key: 'italic', label: 'Italic', type: 'bool', def: false },
    { key: 'spacing', label: 'Letter spacing', type: 'num', def: 0, min: -2, max: 20, step: 0.1, unit: 'mm' }, { key: 'lineGap', label: 'Line spacing', type: 'num', def: 1.15, min: 0.6, max: 3, step: 0.05, unit: '×' },
    { key: 'align', label: 'Align', type: 'select', def: 'center', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }],
  build: (p, K) => { const loops = textLoops(p); if (!loops.length) throw new Error('Type some text to see letters.'); return K.CrossSection.ofPolygons(loops, 'EvenOdd').extrude(p.depth); },
});

// ------------------------------------------------------------------ traced images
defineShape('trace', {
  label: 'Traced image', icon: 'heart',
  params: [{ key: 'width', label: 'Width', type: 'num', def: 50, min: 1, max: 1000, step: 1, unit: 'mm' }, { key: 'depth', label: 'Depth', type: 'num', def: 2, min: 0.2, max: 200, step: 0.2, unit: 'mm' }],
  build: (p, K) => {
    const cs = K.CrossSection.ofPolygons(p.loops, 'EvenOdd'); const b = cs.bounds(); const w = b.max[0] - b.min[0];
    return cs.scale([p.width / w, p.width / w]).extrude(p.depth);
  },
});

export async function traceImageFile(file, { threshold = 0.5, invert = false, maxPx = 700 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image could not be read. Use PNG, JPG or SVG.')); i.src = url; });
    let w = img.naturalWidth || 512, hh = img.naturalHeight || 512; const k = Math.min(1, maxPx / Math.max(w, hh)) * (file.type.includes('svg') ? Math.max(1, maxPx / Math.max(w, hh)) : 1);
    w = Math.round(w * k); hh = Math.round(hh * k);
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, hh);
    const d = ctx.getImageData(0, 0, w, hh).data; let transparent = 0; for (let i = 3; i < d.length; i += 4 * 17) if (d[i] < 250) transparent++;
    const mode = transparent > (d.length / (4 * 17)) * 0.05 ? 'alpha' : 'luma';
    return { loops: canvasToLoops(ctx, w, hh, 1, mode, threshold, invert), preview: c };
  } finally { URL.revokeObjectURL(url); }
}

export function openTraceDialog(app) {
  let file = null, res = null; const state = { threshold: 0.5, invert: false, width: 50, depth: 2 };
  const prev = h('canvas', { width: 420, height: 300, style: { width: '100%', maxWidth: '420px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' } });
  const info = h('p', { class: 'note' }, 'Choose a PNG, JPG or SVG. Dark or opaque areas become solid.');
  const draw = () => {
    const ctx = prev.getContext('2d'); ctx.clearRect(0, 0, prev.width, prev.height); if (!res?.loops.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const l of res.loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.min((prev.width - 20) / (x1 - x0), (prev.height - 20) / (y1 - y0));
    ctx.beginPath(); for (const l of res.loops) { l.forEach(([x, y], i) => { const px = 10 + (x - x0) * k, py = prev.height - 10 - (y - y0) * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent'); ctx.fill('evenodd');
    info.textContent = `${res.loops.length} outline${res.loops.length === 1 ? '' : 's'} found.`;
  };
  const run = async () => { if (!file) return; try { res = await traceImageFile(file, state); draw(); } catch (e) { info.textContent = e.message; } };
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp', onchange: (e) => { file = e.target.files[0]; run(); } });
  const thr = h('input', { type: 'range', min: '0.05', max: '0.95', step: '0.05', value: '0.5', oninput: (e) => { state.threshold = +e.target.value; clearTimeout(thr._t); thr._t = setTimeout(run, 120); } });
  const foot = h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
    if (!res?.loops.length) { info.textContent = 'Choose an image with a clear shape first.'; return; }
    d.close(); app.addShape('trace', { loops: res.loops, width: state.width, depth: state.depth }, { name: file.name.replace(/\.[^.]+$/, '') });
  } }, 'Add to plate'));
  const d = app.modal('Trace an image or logo',
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,260px)', gap: '16px' } },
      h('div', {}, prev, info),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, fileIn,
        row('Threshold', thr), row('Invert', h('input', { type: 'checkbox', onchange: (e) => { state.invert = e.target.checked; run(); }, style: { justifySelf: 'end' } })),
        row('Width (mm)', numField(state.width, (v) => { state.width = v; }, { min: 1, max: 1000 })), row('Depth (mm)', numField(state.depth, (v) => { state.depth = v; }, { min: 0.2, max: 200, step: 0.2 })))),
    foot);
}
export function install(app) { app.openTraceDialog = () => openTraceDialog(app); }
