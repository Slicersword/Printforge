// Layer Studio: build a flat part layer by layer, like usestl's Studio.
// Each layer has its own thickness and colour and holds elements: text, icons, your own image/SVG, QR codes,
// basic shapes, an outline that follows everything above it, a keyring loop or a hole through every layer.
// Where layers overlap they interlock: the upper layer sinks into a pocket in the one below, so colours
// sit flush and the parts lock together. Every layer becomes its own object, so a 3MF keeps the colours.
import { registerKind, K } from './kernel.js';
import { h, numField, row } from './ui.js';
import { textLoops, traceImageFile } from './textshape.js';
import { encodeQR, qrPayload } from './qr.js';
import { uid } from './scene.js';

const FONTS = [['Arial Black, Arial, sans-serif', 'Arial Black'], ['Pacifico, cursive', 'Pacifico (script)'], ['Great Vibes, cursive', 'Great Vibes (script)'], ['Lobster, cursive', 'Lobster'], ['Bebas Neue, sans-serif', 'Bebas Neue'], ['Anton, sans-serif', 'Anton'], ['Righteous, sans-serif', 'Righteous'], ['Arial, sans-serif', 'Arial'], ['Impact, sans-serif', 'Impact'], ['Georgia, serif', 'Georgia'], ['Courier New, monospace', 'Courier'], ['Comic Sans MS, cursive', 'Comic'], ['Trebuchet MS, sans-serif', 'Trebuchet'], ['Verdana, sans-serif', 'Verdana']];

// ---------------------------------------------------------------- icons (filled, built from shapes, 20 mm design size)
const C = () => K.CrossSection;
const circ = (r, x = 0, y = 0) => C().circle(r, 48).translate([x, y]);
const polyCS = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return C().ofPolygons([a < 0 ? pts.slice().reverse() : pts]); };
const ring = (ro, ri, x = 0, y = 0) => circ(ro, x, y).subtract(circ(ri, x, y));
const ICONS = {
  heart: () => { const pts = []; for (let i = 0; i < 96; i++) { const t = i / 96 * Math.PI * 2; pts.push([16 * Math.sin(t) ** 3 * 0.62, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.62 + 1]); } return polyCS(pts); },
  star: () => polyCS(Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.2 : 10; return [Math.cos(a) * r, Math.sin(a) * r]; })),
  house: () => polyCS([[-8, -9], [-8, 1], [-10.5, 1], [0, 10], [10.5, 1], [8, 1], [8, -9], [2.5, -9], [2.5, -3], [-2.5, -3], [-2.5, -9]]),
  bolt: () => polyCS([[2, 10], [-7, -1], [-1, -1], [-3, -10], [7, 2], [1, 2]]),
  check: () => polyCS([[-10, 0], [-6.5, 3.5], [-3, 0], [6.5, 9.5], [10, 6], [-3, -7]]),
  plus: () => C().union([C().square([6, 20], true), C().square([20, 6], true)]),
  drop: () => { const pts = []; for (let i = 0; i <= 64; i++) { const t = -Math.PI / 2 + (i / 64) * Math.PI * 2; const r = 7; const x = Math.cos(t) * r, y = Math.sin(t) * r - 3; pts.push([x, y]); } return C().hull([polyCS(pts), circ(0.4, 0, 10)]); },
  moon: () => circ(9.5).subtract(circ(8, 5, 3.5)),
  paw: () => C().union([C().hull([circ(4.2, -2.4, -3.5), circ(4.2, 2.4, -3.5), circ(3, 0, -7.5)]), circ(2.4, -7.6, 1.2), circ(2.4, 7.6, 1.2), circ(2.5, -3.3, 6.2), circ(2.5, 3.3, 6.2)]),
  wifi: () => { const wedge = polyCS([[0, -7], [-14, 7], [14, 7]]); return C().union([circ(1.9, 0, -6), ring(7.2, 4.8, 0, -6).intersect(wedge.translate([0, -0.1])), ring(12.4, 10, 0, -6).intersect(wedge.scale([1.8, 1.8]).translate([0, 5.5]))]); },
  pin: () => C().hull([circ(7, 0, 3), circ(0.4, 0, -10)]).subtract(circ(2.8, 0, 3)),
  sun: () => C().union([circ(5.2), ...Array.from({ length: 8 }, (_, i) => polyCS([[-1.6, 7], [1.6, 7], [0, 10.5]]).rotate(i * 45))]),
  music: () => C().union([circ(3.2, -5, -6.5), circ(3.2, 6, -4.5), C().square([1.6, 15]).translate([-3.4, -6.5]), C().square([1.6, 15]).translate([7.6, -4.5]), polyCS([[-3.4, 6.5], [9.2, 8.6], [9.2, 11.4], [-3.4, 9.3]])]),
  gear: () => C().union([circ(7), ...Array.from({ length: 8 }, (_, i) => C().square([3.6, 4], true).translate([0, 8]).rotate(i * 45))]).subtract(circ(2.8)),
  cat: () => C().union([circ(8, 0, -1.5), polyCS([[-7.6, 1], [-7, 10], [-1.8, 6]]), polyCS([[7.6, 1], [7, 10], [1.8, 6]])]).subtract(C().union([circ(1.3, -3, 0), circ(1.3, 3, 0), polyCS([[-1.2, -3], [1.2, -3], [0, -4.6]])])),
};
const ICON_LIST = Object.keys(ICONS);

// ---------------------------------------------------------------- elements → 2D regions
const QR_KINDS = [['url', 'Link'], ['text', 'Text'], ['wifi', 'Wi-Fi'], ['contact', 'Contact'], ['email', 'Email'], ['phone', 'Phone'], ['sms', 'Text message']];
export const ELEMENT_TYPES = {
  text: { label: 'Text', defaults: { text: 'Hello', font: FONTS[0][0], size: 10, bold: true, spacing: 0 } },
  icon: { label: 'Icon', defaults: { icon: 'heart', size: 20 } },
  qr: { label: 'QR code', defaults: { qrKind: 'url', url: 'https://example.com', text: '', ssid: '', password: '', security: 'WPA', first: '', last: '', phone: '', email: '', org: '', message: '', subject: '', ecc: 'M', size: 40 } },
  image: { label: 'Image / SVG', defaults: { width: 30, loops: null, file: '' } },
  rect: { label: 'Rectangle', defaults: { w: 60, h: 30, r: 4 } },
  circle: { label: 'Circle', defaults: { d: 30 } },
  polygon: { label: 'Polygon', defaults: { d: 30, n: 6 } },
  outline: { label: 'Outline of layers above', defaults: { margin: 3, round: true } },
  ring: { label: 'Keyring loop', defaults: { outer: 9, inner: 4.5, attach: 'top' } },
  hole: { label: 'Hole through all', defaults: { d: 5 } },
};

function centred(cs) { const b = cs.bounds(); return cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]); }
function place(cs, e) { let r = cs; if (e.rot) r = r.rotate(e.rot); return r.translate([e.x || 0, e.y || 0]); }

/** QR modules as one 2D region `size` mm wide (no quiet zone; give the base layer a margin). */
export function qrRegion(e) {
  const payload = qrPayload(e.qrKind || 'text', e);
  if (!payload) throw new Error('The QR code is empty. Type a link or some text.');
  const q = encodeQR(payload, e.ecc || 'M'); const n = q.size; const m = e.size / n; const polys = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!q.modules[y][x]) { x++; continue; }
      let x2 = x; while (x2 < n && q.modules[y][x2]) x2++;
      const X0 = (x - n / 2) * m, X1 = (x2 - n / 2) * m, Y1 = (n / 2 - y) * m, Y0 = Y1 - m;
      // tiny overlap between rows so stacked modules merge into one solid
      polys.push([[X0, Y0 - 1e-4], [X1, Y0 - 1e-4], [X1, Y1 + 1e-4], [X0, Y1 + 1e-4]]); x = x2;
    }
  }
  return { cs: K.CrossSection.ofPolygons(polys, 'NonZero'), version: q.version, modules: n, moduleMm: m };
}

function elementRegion(e) {
  switch (e.type) {
    case 'text': { const loops = textLoops({ text: e.text || ' ', font: e.font, size: e.size, bold: e.bold, italic: false, spacing: e.spacing || 0, lineGap: 1.15, align: 'center' }); if (!loops.length) return null; return place(centred(K.CrossSection.ofPolygons(loops, 'EvenOdd')), e); }
    case 'icon': { const cs = (ICONS[e.icon] || ICONS.heart)(); const b = cs.bounds(); const k = e.size / Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]); return place(centred(cs).scale([k, k]), e); }
    case 'qr': return place(qrRegion(e).cs, e);
    case 'image': { if (!e.loops?.length) return null; const cs = K.CrossSection.ofPolygons(e.loops, 'EvenOdd'); const b = cs.bounds(); const k = e.width / (b.max[0] - b.min[0]); return place(centred(cs).scale([k, k]), e); }
    case 'rect': { const r = Math.max(0, Math.min(e.r || 0, e.w / 2 - 0.01, e.h / 2 - 0.01)); let cs = K.CrossSection.square([e.w - 2 * r, e.h - 2 * r], true); if (r > 0) cs = cs.offset(r, 'Round', 2, 32); return place(cs, e); }
    case 'circle': return place(K.CrossSection.circle(e.d / 2, 72), e);
    case 'polygon': return place(K.CrossSection.circle(e.d / 2, Math.max(3, e.n | 0)), e);
    case 'ring': return place(K.CrossSection.circle(e.outer / 2, 48).subtract(K.CrossSection.circle(e.inner / 2, 48)), e);
    default: return null;
  }
}

// ---------------------------------------------------------------- doc → solids (cached; every layer object asks for the same doc)
const cache = new Map();
export function clearDocCache() { cache.clear(); }
/** Returns { solids: Manifold[], regions: CrossSection[], z: number[], warnings } for a Layer Studio doc. */
export function buildDoc(doc) {
  const key = JSON.stringify(doc); const hit = cache.get(key); if (hit) return hit;
  const L = doc.layers; const warnings = [];
  const own = L.map((layer) => {
    const parts = []; for (const e of layer.elements) { if (['outline', 'hole', 'ring'].includes(e.type)) continue; try { const r = elementRegion(e); if (r && !r.isEmpty()) parts.push(r); } catch (err) { warnings.push(`${ELEMENT_TYPES[e.type]?.label || e.type}: ${err.message}`); } }
    return parts.length ? K.CrossSection.union(parts) : null;
  });
  // outlines follow everything in the layers above (and the rest of their own layer)
  const regions = L.map((layer, i) => {
    let r = own[i]; const outs = layer.elements.filter((e) => e.type === 'outline');
    for (const e of outs) {
      const above = own.slice(i + 1).filter(Boolean); const src = [...above, ...(own[i] ? [own[i]] : [])];
      if (!src.length) { warnings.push(`Layer “${layer.name}”: the outline has nothing above it to follow.`); continue; }
      let o = K.CrossSection.union(src).offset(e.margin, e.round === false ? 'Miter' : 'Round', 2, 32);
      // fill the inside so the outline is solid, not a ring around the letters
      o = K.CrossSection.ofPolygons(o.toPolygons().map((p) => p.map((q) => (Array.isArray(q) ? q : [q.x ?? q[0], q.y ?? q[1]]))).filter((p) => area(p) > 0), 'NonZero');
      r = r ? r.add(o) : o;
    }
    return r;
  });
  // keyring loops: attached to the outside edge of everything (auto), or placed by hand
  const all = regions.filter((r) => r && !r.isEmpty()); const bb = all.length ? K.CrossSection.union(all).bounds() : { min: [0, 0], max: [0, 0] };
  const holes = [];
  L.forEach((layer, i) => layer.elements.forEach((e) => {
    if (e.type === 'hole') holes.push(K.CrossSection.circle(e.d / 2, 40).translate([e.x || 0, e.y || 0]));
    if (e.type !== 'ring') return;
    const ro = e.outer / 2, ri = e.inner / 2, inset = Math.max(1, (ro - ri) * 0.9);
    let x = e.x || 0, y = e.y || 0;
    if (e.attach === 'left') { x = bb.min[0] - ro + inset; y = (bb.min[1] + bb.max[1]) / 2; }
    else if (e.attach === 'right') { x = bb.max[0] + ro - inset; y = (bb.min[1] + bb.max[1]) / 2; }
    else if (e.attach === 'top') { x = (bb.min[0] + bb.max[0]) / 2; y = bb.max[1] + ro - inset; }
    const loop = K.CrossSection.circle(ro, 48).translate([x, y]);
    regions[i] = regions[i] ? regions[i].add(loop) : loop;
    holes.push(K.CrossSection.circle(ri, 40).translate([x, y]));
  }));
  const holeCS = holes.length ? K.CrossSection.union(holes) : null;
  regions.forEach((r, i) => { if (r && holeCS) r = r.subtract(holeCS); regions[i] = r && !r.isEmpty() ? r : null; });
  const z = []; let acc = 0; for (const layer of L) { z.push(acc); acc += layer.thickness; }
  const lock = Math.max(0, doc.interlock ?? 0.6);
  const solids = L.map((layer, i) => { const r = regions[i]; return r ? r.extrude(layer.thickness).translate([0, 0, z[i]]) : null; });
  if (lock > 0) for (let i = 0; i + 1 < L.length; i++) {
    const a = regions[i], b = regions[i + 1]; if (!a || !b || !solids[i] || !solids[i + 1]) continue;
    const ov = a.intersect(b); if (ov.isEmpty()) continue;
    const d = Math.min(lock, L[i].thickness - 0.4); if (d < 0.2) continue;
    const key2 = ov.extrude(d + 0.01).translate([0, 0, z[i + 1] - d]);
    solids[i] = solids[i].subtract(key2); solids[i + 1] = solids[i + 1].add(key2);
  }
  const res = { solids, regions, z, warnings };
  cache.set(key, res); if (cache.size > 6) cache.delete(cache.keys().next().value);
  return res;
}
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

registerKind('layer', {
  label: 'Studio layer', editor: true, editorLabel: 'Edit in Layer Studio', keepOrigin: true,
  params: [{ key: 'interlock', label: 'Interlock depth', type: 'num', def: 0.6, min: 0, max: 3, step: 0.1, unit: 'mm' }],
  build: (p) => {
    const doc = { ...p.doc, interlock: p.interlock ?? p.doc.interlock };
    const { solids, warnings } = buildDoc(doc); const s = solids[p.index];
    if (!s) throw new Error(warnings[0] || 'This layer is empty.');
    return s;
  },
  note: 'Interlock depth applies to every layer of this design. Open Layer Studio to change the elements.',
});

// ---------------------------------------------------------------- presets
const L = (name, thickness, color, elements) => ({ id: uid(), name, thickness, color, elements: elements.map((e) => ({ id: uid(), x: 0, y: 0, rot: 0, ...ELEMENT_TYPES[e.type].defaults, ...e })) });
export const PRESETS = [
  { id: 'qr-sign', label: 'QR code sign', blurb: 'Square plate with a raised QR code and a label.', doc: () => ({ name: 'QR sign', interlock: 0.6, layers: [
    L('Base', 2.4, '#F5F5F2', [{ type: 'rect', w: 70, h: 84, r: 5, y: -6 }, { type: 'hole', d: 4.5, y: 31 }]),
    L('Code', 1, '#1D1F24', [{ type: 'qr', url: 'https://slicersword.github.io/Printforge1/', size: 52, y: -2 }, { type: 'text', text: 'Scan me', size: 7, y: -38 }])] }) },
  { id: 'wifi-sign', label: 'Wi-Fi QR sign', blurb: 'Guests scan it to join your Wi-Fi. Stands up or hangs.', doc: () => ({ name: 'Wi-Fi sign', interlock: 0.6, layers: [
    L('Base', 3, '#F5F5F2', [{ type: 'rect', w: 76, h: 100, r: 6, y: -8 }]),
    L('Code', 1, '#1D1F24', [{ type: 'icon', icon: 'wifi', size: 14, y: 32 }, { type: 'qr', qrKind: 'wifi', ssid: 'MyNetwork', password: 'password', security: 'WPA', size: 56, y: -4 }, { type: 'text', text: 'MyNetwork', size: 6, y: -42 }])] }) },
  { id: 'qr-keychain', label: 'QR keychain', blurb: 'Small tag with a QR code and a keyring loop.', doc: () => ({ name: 'QR keychain', interlock: 0.4, layers: [
    L('Base', 2, '#F5F5F2', [{ type: 'rect', w: 36, h: 36, r: 4 }, { type: 'ring', outer: 10, inner: 5, attach: 'top' }]),
    L('Code', 0.8, '#1D1F24', [{ type: 'qr', url: 'https://example.com', size: 28, ecc: 'L' }])] }) },
  { id: 'name-keychain', label: 'Name keychain', blurb: 'Your name in bold letters on a base that follows the outline.', doc: () => ({ name: 'Name keychain', interlock: 0.6, layers: [
    L('Base', 2.4, '#1D1F24', [{ type: 'outline', margin: 2.6 }, { type: 'ring', outer: 9, inner: 4.6, attach: 'left' }]),
    L('Letters', 1.6, '#16D8AA', [{ type: 'text', text: 'Alex', size: 14, font: FONTS[0][0] }])] }) },
  { id: 'letter-keychain', label: 'Letter keychain', blurb: 'One big initial with an outline and a loop.', doc: () => ({ name: 'Letter keychain', interlock: 0.6, layers: [
    L('Base', 2.4, '#1D1F24', [{ type: 'outline', margin: 2.4 }, { type: 'ring', outer: 9, inner: 4.6, attach: 'top' }]),
    L('Letter', 1.6, '#F2C14E', [{ type: 'text', text: 'A', size: 32 }])] }) },
  { id: 'icon-tag', label: 'Icon tag', blurb: 'Round tag with an icon and text, three colours.', doc: () => ({ name: 'Icon tag', interlock: 0.6, layers: [
    L('Base', 2, '#2F9C95', [{ type: 'circle', d: 44 }, { type: 'ring', outer: 9, inner: 4.6, attach: 'top' }]),
    L('Ring', 0.8, '#F5F5F2', [{ type: 'circle', d: 40 }]),
    L('Top', 0.8, '#1D1F24', [{ type: 'icon', icon: 'paw', size: 18, y: 4 }, { type: 'text', text: 'REX', size: 6, y: -11 }])] }) },
  { id: 'door-sign', label: 'Door sign', blurb: 'Long sign with a border, text and an icon.', doc: () => ({ name: 'Door sign', interlock: 0.6, layers: [
    L('Base', 3, '#1D1F24', [{ type: 'rect', w: 140, h: 40, r: 6 }, { type: 'hole', d: 4, x: -63 }, { type: 'hole', d: 4, x: 63 }]),
    L('Top', 1, '#F5F5F2', [{ type: 'text', text: 'Workshop', size: 14, x: 8 }, { type: 'icon', icon: 'gear', size: 18, x: -44 }])] }) },
  { id: 'blank', label: 'Blank', blurb: 'Start from one empty layer.', doc: () => ({ name: 'Layer design', interlock: 0.6, layers: [L('Layer 1', 2, '#F5F5F2', [{ type: 'rect', w: 60, h: 40, r: 4 }])] }) },
];

// ---------------------------------------------------------------- objects on the plate
function placeDoc(app, doc, replaceLink) {
  const s = app.scene; const link = replaceLink || uid();
  let pos;
  const old = replaceLink ? s.objects.filter((o) => o.link === replaceLink) : [];
  if (old.length) pos = [...old[0].pos];
  const objs = [];
  s.edit(replaceLink ? 'update layer design' : 'add layer design', () => {
    const { solids } = buildDoc(doc);
    doc.layers.forEach((layer, i) => {
      if (!solids[i]) return;
      objs.push({ id: uid(), type: 'shape', kind: 'layer', name: `${doc.name} · ${layer.name}`, params: { doc, index: i, interlock: doc.interlock }, local: ['index'], link, color: layer.color, hole: false, visible: true, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
    });
    if (!pos) { const b = solids.filter(Boolean).map((m) => m.boundingBox()); const w = Math.max(...b.map((x) => x.max[0])) - Math.min(...b.map((x) => x.min[0])), d = Math.max(...b.map((x) => x.max[1])) - Math.min(...b.map((x) => x.min[1])); pos = app.spawnPoint(w, d); }
    objs.forEach((o) => { o.pos = [...pos]; });
    if (old.length) { const idx = s.objects.indexOf(old[0]); s.objects = s.objects.filter((o) => o.link !== replaceLink); s.objects.splice(Math.max(0, idx), 0, ...objs); }
    else s.objects.push(...objs);
    s.selection = new Set(objs.map((o) => o.id));
  });
  s.emit('select');
  return objs;
}

// ---------------------------------------------------------------- the editor
export function openStudio(app, { doc: start, link } = {}) {
  let doc = JSON.parse(JSON.stringify(start || PRESETS[0].doc()));
  let li = Math.max(0, doc.layers.length - 1), ei = 0; // selected layer / element
  const canvas = h('canvas', { class: 'studio-canvas', width: 640, height: 480 });
  const status = h('p', { class: 'note studio-status' });
  const side = h('div', { class: 'studio-side' });
  let view = null; // { k, ox, oy } mm → px
  let regionsCache = null;

  const recompute = () => {
    clearTimeout(recompute.t);
    recompute.t = setTimeout(() => {
      try {
        const r = buildDoc(doc); regionsCache = r;
        const qrs = doc.layers.flatMap((l) => l.elements.filter((e) => e.type === 'qr'));
        const qrInfo = qrs.map((e) => { try { const q = qrRegion(e); return `QR ${q.modules}×${q.modules}, ${q.moduleMm.toFixed(2)} mm per square${q.moduleMm < 1 ? ' (small: print with a 0.2 mm nozzle or make it bigger)' : ''}`; } catch (err) { return err.message; } });
        const size = r.solids.filter(Boolean).map((m) => m.boundingBox());
        const dims = size.length ? [0, 1, 2].map((k) => Math.max(...size.map((b) => b.max[k])) - Math.min(...size.map((b) => b.min[k]))) : [0, 0, 0];
        status.textContent = [`${dims.map((v) => v.toFixed(1)).join(' × ')} mm, ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}.`, ...qrInfo, ...r.warnings].join(' ');
      } catch (err) { status.textContent = err.message; regionsCache = null; }
      draw();
    }, 60);
  };
  const draw = () => {
    const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--stage') || '#222'; ctx.fillRect(0, 0, W, H);
    const regs = regionsCache?.regions || [];
    let x0 = -40, x1 = 40, y0 = -30, y1 = 30;
    for (const r of regs) if (r) { const b = r.bounds(); x0 = Math.min(x0, b.min[0]); x1 = Math.max(x1, b.max[0]); y0 = Math.min(y0, b.min[1]); y1 = Math.max(y1, b.max[1]); }
    const k = Math.min((W - 60) / (x1 - x0), (H - 60) / (y1 - y0)); const ox = W / 2 - (x0 + x1) / 2 * k, oy = H / 2 + (y0 + y1) / 2 * k;
    view = { k, ox, oy };
    // 10 mm grid
    ctx.strokeStyle = css.getPropertyValue('--line'); ctx.lineWidth = 1; ctx.beginPath();
    const step = k * 10 < 12 ? 50 : 10;
    for (let gx = Math.floor((-ox / k) / step) * step; gx * k + ox < W; gx += step) { ctx.moveTo(gx * k + ox, 0); ctx.lineTo(gx * k + ox, H); }
    for (let gy = Math.floor(((oy - H) / k) / step) * step; oy - gy * k > 0; gy += step) { ctx.moveTo(0, oy - gy * k); ctx.lineTo(W, oy - gy * k); }
    ctx.stroke();
    regs.forEach((r, i) => {
      if (!r) return; ctx.beginPath();
      for (const p of r.toPolygons()) p.forEach((q, j) => { const x = (q[0] ?? q.x) * k + ox, y = oy - (q[1] ?? q.y) * k; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fillStyle = doc.layers[i].color; ctx.globalAlpha = i === li ? 1 : 0.92; ctx.fill('evenodd'); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    });
    // selected element marker
    const e = doc.layers[li]?.elements[ei];
    if (e && e.type !== 'outline' && !(e.type === 'ring' && e.attach && e.attach !== 'free')) { ctx.strokeStyle = css.getPropertyValue('--accent'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc((e.x || 0) * k + ox, oy - (e.y || 0) * k, 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo((e.x || 0) * k + ox - 11, oy - (e.y || 0) * k); ctx.lineTo((e.x || 0) * k + ox + 11, oy - (e.y || 0) * k); ctx.moveTo((e.x || 0) * k + ox, oy - (e.y || 0) * k - 11); ctx.lineTo((e.x || 0) * k + ox, oy - (e.y || 0) * k + 11); ctx.stroke(); }
    ctx.fillStyle = css.getPropertyValue('--muted'); ctx.font = '12px Barlow, sans-serif'; ctx.fillText(`grid ${step} mm · drag to move the selected element`, 10, H - 10);
  };
  // drag the selected element on the canvas
  let drag = null;
  canvas.addEventListener('pointerdown', (ev) => {
    const e = doc.layers[li]?.elements[ei]; if (!e || !view || e.type === 'outline') return;
    const r = canvas.getBoundingClientRect(); const sx = canvas.width / r.width;
    drag = { e, mx: (ev.clientX - r.left) * sx, my: (ev.clientY - r.top) * sx, x: e.x || 0, y: e.y || 0, sx }; canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return; const r = canvas.getBoundingClientRect();
    const dx = ((ev.clientX - r.left) * drag.sx - drag.mx) / view.k, dy = -((ev.clientY - r.top) * drag.sx - drag.my) / view.k;
    const snap = ev.shiftKey ? 0.1 : 0.5; drag.e.x = Math.round((drag.x + dx) / snap) * snap; drag.e.y = Math.round((drag.y + dy) / snap) * snap; recompute();
  });
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; renderSide(); } });

  const field = (label, value, set, opts = {}) => row(label, numField(value, (v) => { set(v); recompute(); }, opts));
  const sel = (label, value, options, set) => row(label, h('select', { onchange: (e) => { set(e.target.value); recompute(); renderSide(); } }, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))));
  const txt = (label, value, set, area) => row(label, h(area ? 'textarea' : 'input', { type: 'text', rows: 2, value: value ?? '', onkeydown: (e) => e.stopPropagation(), oninput: (e) => { set(e.target.value); recompute(); } }, area ? (value ?? '') : null));
  const chk = (label, value, set) => row(label, h('input', { type: 'checkbox', checked: !!value, style: { justifySelf: 'end' }, onchange: (e) => { set(e.target.checked); recompute(); } }));

  const elementForm = (e) => {
    const f = [];
    const pos = () => { if (!['outline'].includes(e.type)) f.push(h('div', { class: 'xy' }, field('X', e.x || 0, (v) => { e.x = v; }, { step: 0.5 }), field('Y', e.y || 0, (v) => { e.y = v; }, { step: 0.5 }))); if (!['outline', 'hole', 'circle'].includes(e.type)) f.push(field('Rotate (°)', e.rot || 0, (v) => { e.rot = v; }, { step: 5 })); };
    switch (e.type) {
      case 'text': f.push(txt('Text', e.text, (v) => { e.text = v; }, true), sel('Font', e.font, FONTS, (v) => { e.font = v; }), field('Letter height', e.size, (v) => { e.size = v; }, { min: 2, max: 200, step: 0.5 }), chk('Bold', e.bold, (v) => { e.bold = v; }), field('Letter spacing', e.spacing || 0, (v) => { e.spacing = v; }, { min: -2, max: 20, step: 0.1 })); break;
      case 'icon': f.push(h('div', { class: 'icon-pick' }, ...ICON_LIST.map((name) => h('button', { class: 'btn' + (e.icon === name ? ' on' : ''), title: name, onclick: () => { e.icon = name; recompute(); renderSide(); } }, name))), field('Size', e.size, (v) => { e.size = v; }, { min: 3, max: 300 })); break;
      case 'qr': {
        f.push(sel('Content', e.qrKind, QR_KINDS, (v) => { e.qrKind = v; }));
        const k = e.qrKind;
        if (k === 'url') f.push(txt('Link', e.url, (v) => { e.url = v; }));
        if (k === 'text') f.push(txt('Text', e.text, (v) => { e.text = v; }, true));
        if (k === 'wifi') f.push(txt('Network name', e.ssid, (v) => { e.ssid = v; }), txt('Password', e.password, (v) => { e.password = v; }), sel('Security', e.security, [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']], (v) => { e.security = v; }));
        if (k === 'contact') f.push(txt('First name', e.first, (v) => { e.first = v; }), txt('Last name', e.last, (v) => { e.last = v; }), txt('Phone', e.phone, (v) => { e.phone = v; }), txt('Email', e.email, (v) => { e.email = v; }), txt('Company', e.org, (v) => { e.org = v; }));
        if (k === 'email') f.push(txt('Email', e.email, (v) => { e.email = v; }), txt('Subject', e.subject, (v) => { e.subject = v; }));
        if (k === 'phone') f.push(txt('Phone', e.phone, (v) => { e.phone = v; }));
        if (k === 'sms') f.push(txt('Phone', e.phone, (v) => { e.phone = v; }), txt('Message', e.message, (v) => { e.message = v; }));
        f.push(sel('Error correction', e.ecc, [['L', 'Low (smallest code)'], ['M', 'Medium'], ['Q', 'Quartile'], ['H', 'High (survives damage)']], (v) => { e.ecc = v; }), field('Width', e.size, (v) => { e.size = v; }, { min: 10, max: 400 }));
        break;
      }
      case 'image': f.push(h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp', onchange: async (ev) => { const file = ev.target.files[0]; if (!file) return; try { const r = await traceImageFile(file, { threshold: 0.5 }); e.loops = r.loops; e.file = file.name; recompute(); renderSide(); } catch (err) { status.textContent = err.message; } } }),
        h('p', { class: 'note' }, e.file ? `Using ${e.file} (${e.loops?.length || 0} outlines).` : 'Choose an SVG, PNG or JPG. Dark or opaque areas become solid.'), field('Width', e.width, (v) => { e.width = v; }, { min: 2, max: 400 })); break;
      case 'rect': f.push(field('Width', e.w, (v) => { e.w = v; }, { min: 1 }), field('Height', e.h, (v) => { e.h = v; }, { min: 1 }), field('Corner radius', e.r, (v) => { e.r = v; }, { min: 0 })); break;
      case 'circle': f.push(field('Diameter', e.d, (v) => { e.d = v; }, { min: 1 })); break;
      case 'polygon': f.push(field('Diameter', e.d, (v) => { e.d = v; }, { min: 1 }), field('Sides', e.n, (v) => { e.n = v; }, { min: 3, max: 64, int: true })); break;
      case 'outline': f.push(field('Margin', e.margin, (v) => { e.margin = v; }, { min: 0.2, max: 40, step: 0.2 }), chk('Rounded corners', e.round !== false, (v) => { e.round = v; }), h('p', { class: 'note' }, 'A solid base that follows the shapes in the layers above, plus the rest of this layer.')); break;
      case 'ring': f.push(sel('Position', e.attach || 'free', [['top', 'Top edge (auto)'], ['left', 'Left edge (auto)'], ['right', 'Right edge (auto)'], ['free', 'Where I put it']], (v) => { e.attach = v; }), field('Outer diameter', e.outer, (v) => { e.outer = v; }, { min: 3 }), field('Hole diameter', e.inner, (v) => { e.inner = v; }, { min: 1 }), h('p', { class: 'note' }, 'The hole goes through every layer. On “auto” the loop sticks to the edge of your design.')); break;
      case 'hole': f.push(field('Diameter', e.d, (v) => { e.d = v; }, { min: 0.5 }), h('p', { class: 'note' }, 'Cuts through every layer: for screws, nails or a key ring.')); break;
    }
    if (e.type === 'ring' && e.attach && e.attach !== 'free') return f;
    pos(); return f;
  };

  const renderSide = () => {
    const layer = doc.layers[li]; ei = Math.min(ei, (layer?.elements.length || 1) - 1);
    const move = (from, to) => { if (to < 0 || to >= doc.layers.length) return; const [x] = doc.layers.splice(from, 1); doc.layers.splice(to, 0, x); li = to; recompute(); renderSide(); };
    side.replaceChildren(
      h('div', { class: 'studio-sec' }, h('div', { class: 'studio-head' }, h('b', {}, 'Layers'), h('span', { class: 'note' }, 'top of the list = top of the part')),
        h('ul', { class: 'studio-layers' }, ...doc.layers.map((l, i) => i).reverse().map((i) => { const l = doc.layers[i]; return h('li', { class: i === li ? 'on' : '', onclick: () => { li = i; ei = 0; renderSide(); draw(); } },
          h('input', { type: 'color', value: l.color, title: 'Layer colour', onclick: (e) => e.stopPropagation(), oninput: (e) => { l.color = e.target.value; draw(); } }),
          h('input', { class: 'nm', value: l.name, onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation(), onchange: (e) => { l.name = e.target.value; } }),
          numField(l.thickness, (v) => { l.thickness = Math.max(0.2, v); recompute(); }, { min: 0.2, max: 50, step: 0.2, label: 'Thickness' }), h('span', { class: 'unit' }, 'mm'),
          h('button', { class: 'x', title: 'Move up', onclick: (e) => { e.stopPropagation(); move(i, i + 1); } }, '↑'), h('button', { class: 'x', title: 'Move down', onclick: (e) => { e.stopPropagation(); move(i, i - 1); } }, '↓'),
          h('button', { class: 'x', title: 'Delete layer', disabled: doc.layers.length < 2, onclick: (e) => { e.stopPropagation(); doc.layers.splice(i, 1); li = Math.min(li, doc.layers.length - 1); recompute(); renderSide(); } }, '×')); })),
        h('button', { class: 'btn', style: { width: '100%' }, onclick: () => { doc.layers.splice(li + 1, 0, L(`Layer ${doc.layers.length + 1}`, 1, '#F2C14E', [{ type: 'text', text: 'Text', size: 8 }])); li += 1; ei = 0; recompute(); renderSide(); } }, '+ Add layer above')),
      layer ? h('div', { class: 'studio-sec' }, h('div', { class: 'studio-head' }, h('b', {}, `In “${layer.name}”`)),
        h('div', { class: 'el-chips' }, ...layer.elements.map((e, i) => h('button', { class: 'chip' + (i === ei ? ' on' : ''), onclick: () => { ei = i; renderSide(); draw(); } }, `${ELEMENT_TYPES[e.type].label}${e.type === 'text' ? `: ${String(e.text).slice(0, 10)}` : e.type === 'icon' ? `: ${e.icon}` : ''}`))),
        h('select', { class: 'add-el', onchange: (ev) => { const t = ev.target.value; if (!t) return; layer.elements.push({ id: uid(), type: t, x: 0, y: 0, rot: 0, ...JSON.parse(JSON.stringify(ELEMENT_TYPES[t].defaults)) }); ei = layer.elements.length - 1; recompute(); renderSide(); } },
          h('option', { value: '' }, '+ Add to this layer…'), ...Object.entries(ELEMENT_TYPES).map(([k, v]) => h('option', { value: k }, v.label)))) : null,
      layer?.elements[ei] ? h('div', { class: 'studio-sec form' }, h('div', { class: 'studio-head' }, h('b', {}, ELEMENT_TYPES[layer.elements[ei].type].label), h('button', { class: 'btn', onclick: () => { layer.elements.splice(ei, 1); ei = Math.max(0, ei - 1); recompute(); renderSide(); } }, 'Remove')), ...elementForm(layer.elements[ei])) : null,
      h('div', { class: 'studio-sec' }, field('Interlock depth', doc.interlock ?? 0.6, (v) => { doc.interlock = Math.max(0, v); }, { min: 0, max: 3, step: 0.1 }),
        h('p', { class: 'note' }, 'Where layers overlap, the upper one sinks this far into the one below, so colours sit flush and lock together. 0 = just stacked.')),
    );
  };

  const presetBar = h('div', { class: 'studio-presets' }, h('span', { class: 'note' }, 'Start from:'), ...PRESETS.map((p) => h('button', { class: 'chip', title: p.blurb, onclick: () => { doc = p.doc(); li = doc.layers.length - 1; ei = 0; recompute(); renderSide(); } }, p.label)));
  const add = () => { try { const objs = placeDoc(app, JSON.parse(JSON.stringify(doc)), link); d.close(); app.setMode('design'); app.toast(`${link ? 'Updated' : 'Added'} ${objs.length} layer${objs.length === 1 ? '' : 's'}. Export as 3MF to keep the colours.`); } catch (err) { status.textContent = err.message; } };
  const d = app.modal('Layer Studio', h('div', { class: 'studio' }, h('div', { class: 'studio-main' }, presetBar, canvas, status), side),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: add }, link ? 'Update on plate' : 'Add to plate')));
  d.classList.add('wide', 'studio-modal');
  renderSide(); recompute();
  return d;
}

export function install(app) {
  app.openStudio = (opts) => openStudio(app, opts);
  app.editors ||= {};
  app.editors.layer = (o) => openStudio(app, { doc: o.params.doc, link: o.link });
  app.addAction({ label: 'Layer Studio', group: 'Studio', keys: '', run: () => openStudio(app) });
  for (const p of PRESETS) if (p.id !== 'blank') app.addAction({ label: p.label, group: 'Studio', run: () => openStudio(app, { doc: p.doc() }) });
  app.library.addTab('studio', 'Studio', (el) => {
    el.append(h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Build signs, tags and keychains layer by layer. Each layer gets its own colour and thickness; text, icons, images and QR codes lock into the layer below.'));
    el.append(h('button', { class: 'btn primary', style: { width: '100%', marginBottom: '8px' }, onclick: () => openStudio(app, { doc: PRESETS.find((p) => p.id === 'blank').doc() }) }, 'Open Layer Studio'));
    el.append(h('div', { class: 'gen-list' }, ...PRESETS.filter((p) => p.id !== 'blank').map((p) => h('button', { class: 'gen-btn', onclick: () => openStudio(app, { doc: p.doc() }) }, h('span', { html: '<svg viewBox="0 0 32 32"><path d="M4 22l12 6 12-6-12-6z"/><path d="M4 16l12 6 12-6M4 10l12 6 12-6-12-6z"/></svg>' }), h('b', {}, p.label), h('span', {}, p.blurb)))));
    el.append(h('div', { class: 'group-label', style: { marginTop: '14px' } }, 'Tools'));
    el.append(h('div', { class: 'gen-list' },
      h('button', { class: 'gen-btn', onclick: () => app.openMold?.() }, h('span', { html: '<svg viewBox="0 0 32 32"><path d="M5 9h22v7H5zM5 18h22v7H5z"/><path d="M12 16a4 3 0 0 0 8 0M12 18a4 3 0 0 1 8 0"/></svg>' }), h('b', {}, 'Mold generator'), h('span', {}, 'Turn the selected part into a two-part mold, a silicone mold box or a multi-cavity tray.')),
      h('button', { class: 'gen-btn', onclick: () => app.openTexture?.() }, h('span', { html: '<svg viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="22" rx="2"/><path d="M5 11l6-6M5 17l12-12M5 23l18-18M9 27l18-18M15 27l12-12M21 27l6-6"/></svg>' }), h('b', {}, 'Texture an STL'), h('span', {}, 'Wrap honeycomb, knurl, wood, stone or your own image onto the selected part.')),
      h('button', { class: 'gen-btn', onclick: () => app.openCost?.(app.lastEstimate) }, h('span', { html: '<svg viewBox="0 0 32 32"><rect x="7" y="4" width="18" height="24" rx="2"/><path d="M11 9h10M11 15h2M15 15h2M19 15h2M11 19h2M15 19h2M19 19h2M11 23h2M15 23h6"/></svg>' }), h('b', {}, 'Cost calculator'), h('span', {}, 'Price a print: filament, electricity, printer wear, your time, failures and margin.'))));
  });
}
