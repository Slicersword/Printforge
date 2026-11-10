// Shape library. Each shape: params schema + build(params, K) -> Manifold (any placement; the kernel centres it).
import { registerKind } from './kernel.js';

const n = (key, label, def, min, max, step = 1, unit = 'mm') => ({ key, label, type: 'num', def, min, max, step, unit });
const int = (key, label, def, min, max) => ({ key, label, type: 'int', def, min, max, step: 1, unit: '' });
const sel = (key, label, def, options) => ({ key, label, type: 'select', def, options });
const bool = (key, label, def) => ({ key, label, type: 'bool', def });

export const SHAPES = []; // ordered catalogue for the library UI
export function defineShape(kind, def) {
  registerKind(kind, def);
  if (def.category) SHAPES.push({ kind, ...def });
}
export function defaults(kind, list = SHAPES) {
  const d = list.find((s) => s.kind === kind); const p = {};
  for (const f of d.params) p[f.key] = f.def; return p;
}

// --------------------------------------------------------------- helpers
export function circlePts(r, seg, start = 0) {
  const pts = []; for (let i = 0; i < seg; i++) { const a = start + (i / seg) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}
export function segFor(r, max = 96) { return Math.max(12, Math.min(max, Math.round(r * 4))); }
export function roundedRect(K, w, d, r, seg = 12) {
  r = Math.min(r, w / 2 - 1e-3, d / 2 - 1e-3);
  if (r <= 0.01) return K.CrossSection.square([w, d], true);
  const pts = [];
  const cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) {
    const a = (a0 + (i / seg) * 90) * Math.PI / 180; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return K.CrossSection.ofPolygons([pts]);
}
export function roundedBox(K, w, d, h, r, seg = 24) {
  const { Manifold } = K;
  r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01, h / 2 - 0.01);
  if (r <= 0.01) return Manifold.cube([w, d, h], true);
  const balls = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    balls.push(Manifold.sphere(r, seg).translate([sx * (w / 2 - r), sy * (d / 2 - r), sz * (h / 2 - r)]));
  return Manifold.hull(balls);
}
export function ccw(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return a < 0 ? pts.slice().reverse() : pts; }
export function poly(K, pts) { return K.CrossSection.ofPolygons([ccw(pts)]); }

// --------------------------------------------------------------- icons (24px line art)
const I = {
  box: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z M4 8l8 4 8-4 M12 12v9"/>',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>',
  cone: '<path d="M12 3L5 18c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5z"/>',
  tube: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><ellipse cx="12" cy="6" rx="3.5" ry="1.2"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>',
  torus: '<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="11.5" rx="4" ry="1.6"/>',
  wedge: '<path d="M4 18h16L4 6z M4 18l3 2h16l-3-2 M20 18l3 2 M4 6l3 2v12"/>',
  pyramid: '<path d="M12 3L3 17l9 4 9-4z M12 3v18"/>',
  prism: '<path d="M7 4h10l4 4v8l-4 4H7l-4-4V8z M3 8h18"/>',
  star: '<path d="M12 3l2.6 6 6.4.5-4.9 4.2 1.5 6.3L12 16.8 6.4 20l1.5-6.3L3 9.5 9.4 9z"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  slot: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
  dome: '<path d="M4 17a8 8 0 0 1 16 0z"/><path d="M4 17c0 1 3.6 2 8 2s8-1 8-2"/>',
  screw: '<path d="M7 4h10l-3 4h-4z M10 8v12 M14 8v12 M10 11l4 1.5 M10 14l4 1.5 M10 17l4 1.5"/>',
  nut: '<path d="M7 4h10l5 8-5 8H7l-5-8z"/><circle cx="12" cy="12" r="3.5"/>',
  insert: '<rect x="8" y="4" width="8" height="16" rx="1"/><path d="M8 8h8 M8 12h8 M8 16h8"/>',
  teardrop: '<path d="M12 3l6 7a7 7 0 1 1-12 0z"/>',
  vent: '<circle cx="7" cy="7" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="17" cy="12" r="2"/><circle cx="7" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  text: '<path d="M5 5h14 M12 5v14 M9 19h6"/>',
};
export const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${I[k] || I.box}</svg>`;
export const ICONS = I;

// --------------------------------------------------------------- basic shapes
defineShape('box', {
  label: 'Box', category: 'Basic', icon: 'box',
  params: [n('w', 'Width', 20, 0.1, 1000), n('d', 'Depth', 20, 0.1, 1000), n('h', 'Height', 20, 0.1, 1000), n('r', 'Edge radius', 0, 0, 100, 0.5), int('seg', 'Smoothness', 24, 8, 64)],
  build: (p, K) => roundedBox(K, p.w, p.d, p.h, p.r, p.seg),
});
defineShape('cylinder', {
  label: 'Cylinder', category: 'Basic', icon: 'cylinder',
  params: [n('dia', 'Diameter', 20, 0.1, 1000), n('h', 'Height', 20, 0.1, 1000), int('sides', 'Sides', 64, 3, 256), n('chamfer', 'Top chamfer', 0, 0, 50, 0.2)],
  build: (p, K) => {
    const r = p.dia / 2, c = Math.min(p.chamfer, r * 0.95, p.h * 0.95);
    if (c <= 0) return K.Manifold.cylinder(p.h, r, r, p.sides);
    const body = K.Manifold.cylinder(p.h - c, r, r, p.sides);
    return body.add(K.Manifold.cylinder(c, r, r - c, p.sides).translate([0, 0, p.h - c]));
  },
});
defineShape('sphere', {
  label: 'Sphere', category: 'Basic', icon: 'sphere',
  params: [n('dia', 'Diameter', 20, 0.1, 1000), int('seg', 'Smoothness', 48, 8, 160)],
  build: (p, K) => K.Manifold.sphere(p.dia / 2, p.seg),
});
defineShape('dome', {
  label: 'Half sphere', category: 'Basic', icon: 'dome',
  params: [n('dia', 'Diameter', 20, 0.1, 1000), int('seg', 'Smoothness', 48, 8, 160)],
  build: (p, K) => K.Manifold.sphere(p.dia / 2, p.seg).trimByPlane([0, 0, 1], 0),
});
defineShape('cone', {
  label: 'Cone', category: 'Basic', icon: 'cone',
  params: [n('d1', 'Bottom diameter', 20, 0, 1000), n('d2', 'Top diameter', 0, 0, 1000), n('h', 'Height', 20, 0.1, 1000), int('sides', 'Sides', 64, 3, 256)],
  build: (p, K) => K.Manifold.cylinder(p.h, Math.max(p.d1 / 2, 0.001), Math.max(p.d2 / 2, 0), p.sides),
});
defineShape('tube', {
  label: 'Tube', category: 'Basic', icon: 'tube',
  params: [n('dia', 'Outer diameter', 20, 0.2, 1000), n('wall', 'Wall', 2, 0.1, 500, 0.2), n('h', 'Height', 20, 0.1, 1000), int('sides', 'Sides', 64, 3, 256)],
  build: (p, K) => {
    const r = p.dia / 2, ri = Math.max(0.01, r - p.wall);
    return K.CrossSection.circle(r, p.sides).subtract(K.CrossSection.circle(ri, p.sides)).extrude(p.h);
  },
});
defineShape('torus', {
  label: 'Torus', category: 'Basic', icon: 'torus',
  params: [n('D', 'Centre diameter', 24, 1, 1000), n('d', 'Tube diameter', 6, 0.2, 500), int('seg', 'Smoothness', 48, 8, 160)],
  build: (p, K) => {
    const R = p.D / 2, r = Math.min(p.d / 2, R - 0.01);
    return K.CrossSection.circle(r, Math.round(p.seg / 2)).translate([R, 0]).revolve(p.seg);
  },
});
defineShape('wedge', {
  label: 'Wedge', category: 'Basic', icon: 'wedge',
  params: [n('w', 'Width', 20, 0.1, 1000), n('d', 'Depth', 20, 0.1, 1000), n('h', 'Height', 20, 0.1, 1000)],
  build: (p, K) => poly(K, [[0, 0], [p.d, 0], [0, p.h]]).extrude(p.w).rotate([90, 0, 90]),
});
defineShape('pyramid', {
  label: 'Pyramid', category: 'Basic', icon: 'pyramid',
  params: [n('w', 'Base width', 20, 0.1, 1000), n('h', 'Height', 20, 0.1, 1000), int('sides', 'Sides', 4, 3, 12)],
  build: (p, K) => {
    const r = p.sides === 4 ? p.w / Math.SQRT2 : p.w / 2;
    return poly(K, circlePts(r, p.sides, p.sides === 4 ? Math.PI / 4 : Math.PI / 2)).extrude(p.h, 0, 0, [0, 0]);
  },
});
defineShape('prism', {
  label: 'Polygon', category: 'Basic', icon: 'prism',
  params: [n('dia', 'Corner diameter', 20, 0.1, 1000), int('sides', 'Sides', 6, 3, 32), n('h', 'Height', 10, 0.1, 1000)],
  build: (p, K) => poly(K, circlePts(p.dia / 2, p.sides, Math.PI / 2)).extrude(p.h),
});
defineShape('star', {
  label: 'Star', category: 'Basic', icon: 'star',
  params: [int('points', 'Points', 5, 3, 24), n('dia', 'Diameter', 24, 1, 1000), n('inner', 'Inner size', 45, 5, 95, 1, '%'), n('h', 'Height', 5, 0.1, 1000)],
  build: (p, K) => {
    const pts = []; const R = p.dia / 2, r = R * p.inner / 100;
    for (let i = 0; i < p.points * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / p.points, rr = i % 2 ? r : R; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    return poly(K, pts).extrude(p.h);
  },
});
defineShape('heart', {
  label: 'Heart', category: 'Basic', icon: 'heart',
  params: [n('size', 'Width', 24, 1, 1000), n('h', 'Height', 5, 0.1, 1000)],
  build: (p, K) => {
    const pts = []; const N = 96;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
    }
    const s = p.size / 32; return poly(K, pts.map(([x, y]) => [x * s, y * s])).extrude(p.h);
  },
});
defineShape('slot', {
  label: 'Slot', category: 'Basic', icon: 'slot',
  params: [n('l', 'Length', 30, 0.2, 1000), n('w', 'Width', 10, 0.1, 1000), n('h', 'Height', 5, 0.1, 1000)],
  build: (p, K) => roundedRect(K, Math.max(p.l, p.w), p.w, p.w / 2, 16).extrude(p.h),
});

// --------------------------------------------------------------- hardware (default to holes)
export const METRIC = {
  M2: { clear: 2.4, head: 4.2, headH: 2.2, csk: 4.4, af: 4.0, nutH: 1.6, insert: 3.2, insertD: 4 },
  'M2.5': { clear: 2.9, head: 5.0, headH: 2.7, csk: 5.5, af: 5.0, nutH: 2.0, insert: 3.6, insertD: 5 },
  M3: { clear: 3.4, head: 6.0, headH: 3.2, csk: 6.7, af: 5.5, nutH: 2.4, insert: 4.0, insertD: 5.7 },
  M4: { clear: 4.5, head: 7.6, headH: 4.2, csk: 8.9, af: 7.0, nutH: 3.2, insert: 5.6, insertD: 8.1 },
  M5: { clear: 5.5, head: 9.0, headH: 5.2, csk: 11.0, af: 8.0, nutH: 4.0, insert: 6.4, insertD: 9.5 },
  M6: { clear: 6.6, head: 11.0, headH: 6.2, csk: 13.0, af: 10.0, nutH: 5.0, insert: 8.0, insertD: 12.7 },
  M8: { clear: 8.6, head: 14.0, headH: 8.2, csk: 17.0, af: 13.0, nutH: 6.5, insert: 9.6, insertD: 12.7 },
};
const SIZES = Object.keys(METRIC);

defineShape('screwhole', {
  label: 'Screw hole', category: 'Holes & hardware', icon: 'screw', hole: true,
  params: [sel('size', 'Screw', 'M3', SIZES), n('len', 'Length', 16, 1, 300), sel('head', 'Head', 'counterbore', ['none', 'counterbore', 'countersink']),
    n('headDepth', 'Head recess', 3.2, 0, 50, 0.2), n('fit', 'Extra clearance', 0, -1, 2, 0.05)],
  build: (p, K) => {
    const m = METRIC[p.size], r = m.clear / 2 + p.fit / 2, sides = 48;
    let s = K.Manifold.cylinder(p.len, r, r, sides);
    if (p.head === 'counterbore' && p.headDepth > 0) s = s.add(K.Manifold.cylinder(p.headDepth + 0.01, m.head / 2 + 0.3, m.head / 2 + 0.3, sides).translate([0, 0, p.len - p.headDepth]));
    if (p.head === 'countersink') { const cr = m.csk / 2 + 0.2, ch = cr - r; s = s.add(K.Manifold.cylinder(ch, r, cr, sides).translate([0, 0, p.len - ch])); }
    return s;
  },
});
defineShape('nuttrap', {
  label: 'Nut trap', category: 'Holes & hardware', icon: 'nut', hole: true,
  params: [sel('size', 'Nut', 'M3', SIZES), n('depth', 'Pocket depth', 2.6, 0.2, 50, 0.1), n('fit', 'Extra clearance', 0.25, 0, 2, 0.05), bool('bolt', 'Include bolt hole', true), n('boltLen', 'Bolt hole length', 12, 0, 200)],
  build: (p, K) => {
    const m = METRIC[p.size], af = m.af + p.fit, R = af / Math.sqrt(3);
    let s = poly(K, circlePts(R, 6)).extrude(p.depth);
    if (p.bolt && p.boltLen > 0) s = s.add(K.Manifold.cylinder(p.boltLen, m.clear / 2, m.clear / 2, 40).translate([0, 0, -p.boltLen + 0.01]));
    return s;
  },
});
defineShape('insert', {
  label: 'Heat-set insert', category: 'Holes & hardware', icon: 'insert', hole: true,
  params: [sel('size', 'Thread', 'M3', SIZES), n('depth', 'Depth', 5.7, 1, 50, 0.1), n('lead', 'Lead-in chamfer', 0.5, 0, 3, 0.1)],
  build: (p, K) => {
    const m = METRIC[p.size], r = m.insert / 2;
    let s = K.Manifold.cylinder(p.depth, r, r, 40);
    if (p.lead > 0) s = s.add(K.Manifold.cylinder(p.lead, r, r + p.lead, 40).translate([0, 0, p.depth - p.lead]));
    return s;
  },
});
defineShape('teardrop', {
  label: 'Teardrop hole', category: 'Holes & hardware', icon: 'teardrop', hole: true,
  note: 'A horizontal hole that prints without supports: the pointed top bridges at 45°.',
  params: [n('dia', 'Diameter', 6, 0.5, 200, 0.1), n('len', 'Length', 20, 0.5, 1000), bool('flat', 'Flatten the tip', true)],
  build: (p, K) => {
    const r = p.dia / 2, k = r * Math.SQRT1_2;
    let prof = K.CrossSection.circle(r, 48).add(poly(K, [[-k, k], [k, k], [0, r * Math.SQRT2]]));
    if (p.flat) prof = prof.intersect(K.CrossSection.square([p.dia * 2, r * 2], true));
    return prof.extrude(p.len).translate([0, 0, -p.len / 2]).rotate([90, 0, 0]);
  },
});
defineShape('vent', {
  label: 'Vent grid', category: 'Holes & hardware', icon: 'vent', hole: true,
  params: [sel('pattern', 'Hole shape', 'hexagon', ['circle', 'hexagon', 'square', 'slot']), int('cols', 'Columns', 6, 1, 60), int('rows', 'Rows', 4, 1, 60),
    n('size', 'Hole size', 4, 0.5, 100, 0.1), n('gap', 'Bar width', 1.6, 0.2, 50, 0.1), n('depth', 'Depth', 3, 0.2, 200), bool('stagger', 'Stagger rows', true)],
  build: (p, K) => {
    const pitchX = p.size + p.gap, pitchY = p.pattern === 'hexagon' && p.stagger ? pitchX * Math.sqrt(3) / 2 : pitchX;
    let cell;
    if (p.pattern === 'circle') cell = K.CrossSection.circle(p.size / 2, 28);
    else if (p.pattern === 'hexagon') cell = poly(K, circlePts(p.size / Math.sqrt(3), 6, Math.PI / 2));
    else if (p.pattern === 'square') cell = K.CrossSection.square([p.size, p.size], true);
    else cell = roundedRect(K, p.size * 3, p.size, p.size / 2, 8);
    const sx = p.pattern === 'slot' ? p.size * 3 + p.gap : pitchX;
    const parts = [];
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const off = p.stagger && r % 2 ? sx / 2 : 0;
      if (p.stagger && r % 2 && c === p.cols - 1) continue;
      parts.push(cell.translate([c * sx + off, r * pitchY]));
    }
    return K.CrossSection.union(parts).extrude(p.depth);
  },
});
