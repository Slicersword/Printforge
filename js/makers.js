// Image and text makers: stencil, cookie cutter, raised badge / keychain, lithophane and relief.
// Each result is a normal parametric object, so every number stays editable afterwards.
import { registerKind, kindDef, K } from './kernel.js';
import { h, row, numField } from './ui.js';
import { traceImageFile, textLoops } from './textshape.js';

const n = (key, label, def, min, max, step = 0.5, unit = 'mm') => ({ key, label, type: 'num', def, min, max, step, unit });
const sel = (key, label, def, options) => ({ key, label, type: 'select', def, options });
const bool = (key, label, def) => ({ key, label, type: 'bool', def });

/** Loops (any units, y up) → CrossSection scaled to `width` mm and centred. */
function region(p, Kk) {
  const cs = Kk.CrossSection.ofPolygons(p.loops, 'EvenOdd'); const b = cs.bounds(); const w = b.max[0] - b.min[0];
  if (!(w > 0)) throw new Error('The outline is empty. Choose an image with a clear shape.');
  const k = p.width / w; return cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale([k, k]);
}
const signedArea = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
const pt = (q) => (Array.isArray(q) ? q : [q.x ?? q[0], q.y ?? q[1]]);
/** Outer outline only: holes filled in. */
function filled(cs, Kk) {
  const outers = cs.toPolygons().map((poly) => poly.map(pt)).filter((poly) => signedArea(poly) > 0);
  return Kk.CrossSection.ofPolygons(outers, 'NonZero');
}
function roundedRect2(Kk, w, d, r) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
  const base = Kk.CrossSection.square([w - 2 * r, d - 2 * r], true);
  return r > 0 ? base.offset(r, 'Round', 2, 32) : base;
}

// ---------------------------------------------------------------- stencil
registerKind('stencil', {
  label: 'Stencil',
  params: [n('width', 'Design width', 100, 5, 600, 1), n('margin', 'Border', 12, 2, 100, 1), n('thickness', 'Thickness', 1.2, 0.4, 10, 0.2),
    sel('bridges', 'Bridges', 'auto', [['auto', 'Hold islands (auto)'], ['none', 'None']]), n('bridge', 'Bridge width', 1.6, 0.6, 6, 0.2), n('corner', 'Corner radius', 4, 0, 30, 1),
    bool('hang', 'Hanging hole', false)],
  build: (p, Kk) => {
    let cut = region(p, Kk);
    if (p.bridges === 'auto') {
      // Islands are holes inside a cut-out; a bar through each one ties it back to the plate.
      const bars = [];
      for (const comp of cut.decompose()) {
        const polys = comp.toPolygons().map((poly) => poly.map(pt)); const cb = comp.bounds();
        for (const poly of polys) {
          if (signedArea(poly) >= 0) continue;
          let y0 = Infinity, y1 = -Infinity; for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          const y = (y0 + y1) / 2; bars.push(Kk.CrossSection.square([cb.max[0] - cb.min[0] + 2, p.bridge], true).translate([(cb.min[0] + cb.max[0]) / 2, y]));
        }
      }
      if (bars.length) cut = cut.subtract(Kk.CrossSection.union(bars));
    }
    const b = cut.bounds(); const w = b.max[0] - b.min[0] + 2 * p.margin, d = b.max[1] - b.min[1] + 2 * p.margin;
    let plate = roundedRect2(Kk, w, d, p.corner).translate([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]);
    if (p.hang) plate = plate.subtract(Kk.CrossSection.circle(3, 32).translate([(b.min[0] + b.max[0]) / 2, b.max[1] + p.margin / 2]));
    return plate.subtract(cut).extrude(p.thickness);
  },
});

// ---------------------------------------------------------------- cookie cutter
registerKind('cookie', {
  label: 'Cookie cutter',
  params: [n('width', 'Width', 70, 15, 300, 1), n('height', 'Cutter height', 15, 5, 40, 0.5), n('wall', 'Blade thickness', 1.0, 0.4, 3, 0.1),
    n('flange', 'Rim width', 4, 0, 15, 0.5), n('rim', 'Rim height', 2, 0.6, 6, 0.2), bool('details', 'Imprint inner lines', false)],
  build: (p, Kk) => {
    const cs = region(p, Kk); const shape = filled(cs, Kk);
    const blade = shape.offset(p.wall, 'Round', 2, 24).subtract(shape);
    let out = blade.extrude(p.height);
    if (p.flange > 0) out = out.add(shape.offset(p.wall + p.flange, 'Round', 2, 24).subtract(shape).extrude(p.rim));
    if (p.details) {
      // Thin ridges along the inner lines press details into the dough; the rim side stays flat.
      const inner = cs.toPolygons().map((poly) => poly.map(pt)).filter((poly) => signedArea(poly) < 0);
      if (inner.length) { const holes = Kk.CrossSection.ofPolygons(inner.map((q) => q.slice().reverse()), 'NonZero'); const ridge = holes.offset(p.wall / 2, 'Round', 2, 16).subtract(holes.offset(-p.wall / 2, 'Round', 2, 16)); out = out.add(ridge.intersect(shape).extrude(p.height - 3)); }
    }
    // Print rim-down: blade edge on top.
    return out;
  },
});

// ---------------------------------------------------------------- badge / keychain / sign
registerKind('badge', {
  label: 'Logo badge',
  params: [n('width', 'Design width', 50, 5, 400, 1), sel('base', 'Base shape', 'outline', [['outline', 'Follow the outline'], ['rect', 'Rounded rectangle'], ['circle', 'Circle'], ['none', 'No base (logo only)']]),
    n('margin', 'Base margin', 4, 0, 50, 0.5), n('baseH', 'Base thickness', 2, 0.4, 20, 0.2), n('relief', 'Logo height', 1.2, 0, 20, 0.2), bool('ring', 'Keyring loop', true)],
  build: (p, Kk) => {
    const logo = region(p, Kk); const b = logo.bounds();
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
    let base = null;
    if (p.base === 'outline') base = filled(logo, Kk).offset(p.margin, 'Round', 2, 32);
    else if (p.base === 'rect') base = roundedRect2(Kk, w + 2 * p.margin, d + 2 * p.margin, Math.min(8, p.margin + 2)).translate([cx, cy]);
    else if (p.base === 'circle') base = Kk.CrossSection.circle(Math.hypot(w, d) / 2 + p.margin, 96).translate([cx, cy]);
    let top = base ? base.bounds().max[1] : b.max[1];
    if (p.ring && base) {
      const ry = top + 2.5; const tab = Kk.CrossSection.circle(6, 48).translate([cx, ry]);
      base = base.add(tab).subtract(Kk.CrossSection.circle(2.6, 32).translate([cx, ry])); top = ry + 6;
    }
    const logoSolid = p.relief > 0 ? logo.extrude(p.relief).translate([0, 0, base ? p.baseH : 0]) : null;
    if (!base) return logo.extrude(Math.max(0.4, p.relief || p.baseH));
    const baseSolid = base.extrude(p.baseH);
    return logoSolid ? baseSolid.add(logoSolid) : baseSolid;
  },
});

// ---------------------------------------------------------------- lithophane / relief from a greyscale grid
export function encodeGray(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
const grayCache = new Map();
function decodeGray(b64) { let u = grayCache.get(b64); if (!u) { const s = atob(b64); u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); grayCache.set(b64, u); if (grayCache.size > 8) grayCache.delete(grayCache.keys().next().value); } return u; }

/** Closed height-field solid: vertex heights on an nx×ny grid, bottom at z = 0. */
export function heightField(Kk, H, nx, ny, sx, sy) {
  const nv = nx * ny; const v = new Float32Array(nv * 2 * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; const x = i * sx, y = j * sy;
    v.set([x, y, H[k]], k * 3); v.set([x, y, 0], (nv + k) * 3);
  }
  const T = (i, j) => j * nx + i, B = (i, j) => nv + j * nx + i; const t = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    t.push(T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j), T(i + 1, j + 1), T(i, j + 1));
    t.push(B(i, j), B(i + 1, j + 1), B(i + 1, j), B(i, j), B(i, j + 1), B(i + 1, j + 1));
  }
  for (let i = 0; i < nx - 1; i++) {
    t.push(B(i, 0), B(i + 1, 0), T(i + 1, 0), B(i, 0), T(i + 1, 0), T(i, 0));
    const j = ny - 1; t.push(B(i, j), T(i + 1, j), B(i + 1, j), B(i, j), T(i, j), T(i + 1, j));
  }
  for (let j = 0; j < ny - 1; j++) {
    t.push(B(0, j), T(0, j + 1), B(0, j + 1), B(0, j), T(0, j), T(0, j + 1));
    const i = nx - 1; t.push(B(i, j), B(i, j + 1), T(i, j + 1), B(i, j), T(i, j + 1), T(i, j));
  }
  const mesh = new Kk.Mesh({ numProp: 3, vertProperties: v, triVerts: new Uint32Array(t) });
  const man = new Kk.Manifold(mesh);
  if (man.isEmpty()) throw new Error('Could not build the height map.');
  return man;
}

registerKind('litho', {
  label: 'Lithophane',
  params: [sel('mode', 'Type', 'litho', [['litho', 'Lithophane (shine light through)'], ['relief', 'Relief (raised picture)']]),
    n('width', 'Width', 100, 20, 300, 1), n('minT', 'Thinnest', 0.8, 0.4, 5, 0.1), n('maxT', 'Thickest', 3.2, 1, 20, 0.1),
    n('border', 'Frame', 3, 0, 20, 0.5), n('curve', 'Curve', 0, 0, 360, 5, '°'), bool('invert', 'Invert', false)],
  build: (p, Kk) => {
    const g = decodeGray(p.gray); const gw = p.gw, gh = p.gh;
    const s = p.width / (gw - 1); const bc = Math.round(p.border / s);
    const nx = gw + 2 * bc, ny = gh + 2 * bc; const H = new Float32Array(nx * ny);
    const lo = p.minT, hi = Math.max(p.maxT, p.minT + 0.2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const gi = i - bc, gj = j - bc; let z;
      if (gi < 0 || gj < 0 || gi >= gw || gj >= gh) z = hi;
      else {
        let lum = g[(gh - 1 - gj) * gw + gi] / 255; if (p.invert) lum = 1 - lum;
        z = p.mode === 'litho' ? lo + (1 - lum) * (hi - lo) : lo + lum * (hi - lo);
      }
      H[j * nx + i] = z;
    }
    let man = heightField(Kk, H, nx, ny, s, s);
    const W = (nx - 1) * s;
    if (p.curve > 0 && p.mode === 'litho') {
      // Wrap around a cylinder; the picture faces outwards.
      const ang = p.curve * Math.PI / 180; const R = W / ang;
      man = man.warp((q) => { const a = (q[0] - W / 2) / R; const r = R + q[2]; q[0] = Math.sin(a) * r; q[2] = Math.cos(a) * r - R; });
    }
    // Lithophanes print standing up for the cleanest detail; reliefs print flat.
    if (p.mode === 'litho') man = man.rotate([90, 0, 0]);
    return man;
  },
});

// ---------------------------------------------------------------- dialog
export const MAKERS = [
  { kind: 'stencil', label: 'Stencil', blurb: 'Plate with your image or text cut out. Islands inside letters like O and A are held by bridges.', src: ['image', 'text'], icon: '<svg viewBox="0 0 32 32"><rect x="3" y="7" width="26" height="18" rx="2.5"/><path d="M9 21l3.5-10L16 21M10.3 17.5h4.4M19 11h4.5a2.5 2.5 0 0 1 0 5H19v5h5"/></svg>' },
  { kind: 'cookie', label: 'Cookie cutter', blurb: 'Thin blade that follows the outline, with a rim to press on. Optional ridges for inner details.', src: ['image', 'text'], icon: '<svg viewBox="0 0 32 32"><path d="M16 5c3 4 8 3 9 7s-3 6-2 10-4 6-7 4-8 0-9-4 3-6 1-10 5-3 8-7z"/><path d="M16 9c2 3 5 2 6 5s-2 4-1 7-3 4-5 3-6 0-6-3 2-4 1-7 3-2 5-5z" stroke-dasharray="2 2"/></svg>' },
  { kind: 'badge', label: 'Logo badge / keychain', blurb: 'Raised logo or text on a base that follows the outline, with an optional keyring loop.', src: ['image', 'text'], icon: '<svg viewBox="0 0 32 32"><path d="M6 12a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z"/><circle cx="16" cy="9.5" r="1.5"/><path d="M11 21l5-8 5 8z"/></svg>' },
  { kind: 'litho', label: 'Lithophane', blurb: 'A photo that appears when light shines through it. Flat or curved, with a frame.', src: ['photo'], mode: 'litho', icon: '<svg viewBox="0 0 32 32"><rect x="5" y="6" width="22" height="20" rx="1.5"/><path d="M5 22l7-7 5 5 3-3 7 6"/><circle cx="21" cy="12" r="2"/></svg>' },
  { kind: 'litho', label: 'Relief picture', blurb: 'A photo or drawing raised from a flat plate, for embossed signs and textures.', src: ['photo'], mode: 'relief', icon: '<svg viewBox="0 0 32 32"><path d="M4 23l12 5 12-5-12-5z"/><path d="M8 21.4l4-6 3 3 3-5 6 8" /></svg>' },
];

function loopsBounds(loops) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const l of loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; }

async function grayFromFile(file, cols) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image could not be read. Use PNG, JPG or WebP.')); i.src = url; });
    const w0 = img.naturalWidth || 400, h0 = img.naturalHeight || 300; const gw = Math.max(16, Math.min(cols, w0)); const gh = Math.max(16, Math.round(gw * h0 / w0));
    const c = document.createElement('canvas'); c.width = gw; c.height = gh; const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, gw, gh); ctx.drawImage(img, 0, 0, gw, gh);
    const d = ctx.getImageData(0, 0, gw, gh).data; const g = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) g[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    return { g, gw, gh, preview: c };
  } finally { URL.revokeObjectURL(url); }
}

export function openMaker(app, tool) {
  const photo = tool.src.includes('photo');
  const st = { src: photo ? 'photo' : 'image', file: null, text: 'HELLO', threshold: 0.5, invert: false, loops: null, gray: null, width: photo ? 100 : (tool.kind === 'cookie' ? 70 : tool.kind === 'badge' ? 50 : 100), res: 0.35 };
  const prev = h('canvas', { width: 460, height: 320, class: 'maker-prev' });
  const info = h('p', { class: 'note' }, photo ? 'Choose a photo. Bright areas come out thin, dark areas thick.' : 'Choose an image (dark or opaque areas count), or type text.');
  const draw = () => {
    const ctx = prev.getContext('2d'); ctx.clearRect(0, 0, prev.width, prev.height);
    if (photo && st.gray) { const k = Math.min(prev.width / st.gray.gw, prev.height / st.gray.gh); ctx.imageSmoothingEnabled = true; ctx.drawImage(st.gray.preview, (prev.width - st.gray.gw * k) / 2, (prev.height - st.gray.gh * k) / 2, st.gray.gw * k, st.gray.gh * k); return; }
    if (!st.loops?.length) return; const b = loopsBounds(st.loops); const k = Math.min((prev.width - 24) / (b.x1 - b.x0), (prev.height - 24) / (b.y1 - b.y0));
    const ox = (prev.width - (b.x1 - b.x0) * k) / 2, oy = (prev.height - (b.y1 - b.y0) * k) / 2;
    ctx.beginPath(); for (const l of st.loops) { l.forEach(([x, y], i) => { const px = ox + (x - b.x0) * k, py = prev.height - oy - (y - b.y0) * k; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.closePath(); }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent'); ctx.fill('evenodd');
  };
  const update = async () => {
    try {
      if (photo) {
        if (!st.file) return; st.gray = await grayFromFile(st.file, Math.round(st.width / st.res) + 1);
        info.textContent = `${st.gray.gw} × ${st.gray.gh} points, ${(st.width).toFixed(0)} × ${(st.width * (st.gray.gh - 1) / (st.gray.gw - 1)).toFixed(0)} mm.`;
      } else if (st.src === 'text') {
        st.loops = textLoops({ text: st.text || ' ', font: 'Arial Black, Arial, sans-serif', size: 20, bold: true, italic: false, spacing: 0.5, lineGap: 1.15, align: 'center' });
        info.textContent = st.loops.length ? `${st.loops.length} outlines from your text.` : 'Type some text.';
      } else {
        if (!st.file) return; const r = await traceImageFile(st.file, st); st.loops = r.loops;
        info.textContent = r.loops.length ? `${r.loops.length} outline${r.loops.length === 1 ? '' : 's'} found.` : 'No shape found. Try moving the threshold or Invert.';
      }
      draw();
    } catch (e) { info.textContent = e.message; }
  };
  const fileIn = h('input', { type: 'file', accept: photo ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/svg+xml,image/webp', onchange: (e) => { st.file = e.target.files[0]; update(); } });
  const textIn = h('textarea', { rows: 2, onkeydown: (e) => e.stopPropagation(), oninput: (e) => { st.text = e.target.value; clearTimeout(textIn._t); textIn._t = setTimeout(update, 200); } }); textIn.value = st.text;
  const thr = h('input', { type: 'range', min: '0.05', max: '0.95', step: '0.05', value: '0.5', oninput: (e) => { st.threshold = +e.target.value; clearTimeout(thr._t); thr._t = setTimeout(update, 150); } });
  const srcSeg = h('div', { class: 'seg' }, ...[['image', 'Image'], ['text', 'Text']].map(([v, l]) => h('button', { 'aria-pressed': String(st.src === v), onclick: (e) => { st.src = v; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); imgBox.hidden = v !== 'image'; txtBox.hidden = v !== 'text'; st.loops = null; update(); draw(); } }, l)));
  const imgBox = h('div', { class: 'maker-fields' }, fileIn, row('Threshold', thr), row('Invert', h('input', { type: 'checkbox', style: { justifySelf: 'end' }, onchange: (e) => { st.invert = e.target.checked; update(); } })));
  const txtBox = h('div', { class: 'maker-fields' }, h('label', { class: 'note' }, 'Text (Enter for a new line)'), textIn); txtBox.hidden = true;
  const sizeRow = row(photo ? 'Width (mm)' : 'Design width (mm)', numField(st.width, (v) => { st.width = v; if (photo) update(); }, { min: 5, max: 400 }));
  const resRow = photo ? row('Detail (mm per point)', numField(st.res, (v) => { st.res = v; update(); }, { min: 0.15, max: 2, step: 0.05 })) : null;
  const add = () => {
    let params;
    if (photo) {
      if (!st.gray) { info.textContent = 'Choose a photo first.'; return; }
      params = { mode: tool.mode, width: st.width, minT: tool.mode === 'litho' ? 0.8 : 1.6, maxT: tool.mode === 'litho' ? 3.2 : 4, border: tool.mode === 'litho' ? 3 : 0, curve: 0, invert: false, gray: encodeGray(st.gray.g), gw: st.gray.gw, gh: st.gray.gh };
    } else {
      if (!st.loops?.length) { info.textContent = st.src === 'text' ? 'Type some text first.' : 'Choose an image with a clear shape first.'; return; }
      params = {}; for (const f of kindDef(tool.kind).params) params[f.key] = f.def; params.width = st.width; params.loops = st.loops;
    }
    d.close();
    const name = st.src === 'text' ? `${tool.label}: ${st.text.split('\n')[0].slice(0, 20)}` : st.file ? `${tool.label}: ${st.file.name.replace(/\.[^.]+$/, '')}` : tool.label;
    app.setMode('design'); app.addShape(tool.kind, params, { name });
  };
  const d = app.modal(tool.label,
    h('div', { class: 'maker' }, h('div', {}, prev, info),
      h('div', { class: 'maker-side' }, h('p', { class: 'note' }, tool.blurb), photo ? null : srcSeg, photo ? h('div', { class: 'maker-fields' }, fileIn) : imgBox, photo ? null : txtBox, sizeRow, resRow,
        h('p', { class: 'note' }, 'Every setting stays editable in the panel after you add it.'))),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: add }, 'Add to plate')));
  d.classList.add('wide');
}

export function install(app) {
  app.openMaker = (i) => openMaker(app, MAKERS[i]);
  MAKERS.forEach((m, i) => app.addAction({ label: m.label, group: 'Image & text', iconHtml: m.icon, run: () => openMaker(app, m) }));
  app.library.addTab('makers', 'Image', (el) => {
    el.append(h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Turn a picture, logo or text into something printable. Images stay on your computer.'));
    el.append(h('div', { class: 'gen-list' }, ...MAKERS.map((m) => h('button', { class: 'gen-btn', onclick: () => openMaker(app, m) }, h('span', { html: m.icon }), h('b', {}, m.label), h('span', {}, m.blurb)))));
    el.append(h('button', { class: 'btn', style: { width: '100%', marginTop: '8px' }, onclick: () => app.openTraceDialog?.() }, 'Plain traced shape…'));
  });
}
void K;
