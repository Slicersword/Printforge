// Parametric generators: complete printable parts from a few numbers.
import { registerKind, K as KERNEL } from './kernel.js';
import { roundedRect, roundedBox, circlePts, poly, METRIC, ICONS } from './shapes.js';
import { h } from './ui.js';

const n = (key, label, def, min, max, step = 1, unit = 'mm') => ({ key, label, type: 'num', def, min, max, step, unit });
const int = (key, label, def, min, max) => ({ key, label, type: 'int', def, min, max, step: 1, unit: '' });
const sel = (key, label, def, options) => ({ key, label, type: 'select', def, options });
const bool = (key, label, def) => ({ key, label, type: 'bool', def });

export const GENERATORS = [];
function gen(kind, def) { registerKind(kind, def); GENERATORS.push({ kind, ...def }); }
const gicon = (paths) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

// ------------------------------------------------------------------ enclosure
gen('enclosure', {
  label: 'Electronics enclosure', blurb: 'Box and lid with lip or screws, PCB standoffs, cable cut-out and vents.',
  icon: gicon('<path d="M4 12l12-6 12 6v10l-12 6-12-6z"/><path d="M4 12l12 6 12-6M16 18v10"/><path d="M4 9l12-6 12 6" stroke-dasharray="2 2"/>'),
  params: [
    n('L', 'Inner length', 80, 10, 400), n('W', 'Inner width', 50, 10, 400), n('H', 'Inner height', 25, 5, 300),
    n('wall', 'Wall', 2, 0.8, 10, 0.2), n('floor', 'Floor', 2, 0.6, 10, 0.2), n('r', 'Corner radius', 4, 0, 40, 0.5),
    sel('lid', 'Lid', 'lip', [['lip', 'Press-fit lip'], ['screws', 'Corner screws (M3)']]), n('lidT', 'Lid thickness', 2, 0.8, 10, 0.2),
    n('fit', 'Lid clearance', 0.25, 0, 1, 0.05),
    bool('standoffs', 'PCB standoffs', true), n('pcbX', 'Standoff spacing X', 58, 5, 400), n('pcbY', 'Standoff spacing Y', 23, 5, 400),
    n('soH', 'Standoff height', 5, 1, 50), n('soHole', 'Standoff hole', 2.5, 0.5, 8, 0.1),
    sel('port', 'Front cut-out', 'usbc', [['none', 'None'], ['usbc', 'USB-C'], ['usbb', 'Micro-USB'], ['round', 'Round 8 mm (DC jack)']]), n('portZ', 'Cut-out height from floor', 6, 0, 200, 0.5),
    bool('vents', 'Vent slots in lid', true),
    sel('layout', 'Show', 'both', [['both', 'Base and lid side by side'], ['base', 'Base only'], ['lid', 'Lid only'], ['assembled', 'Assembled preview']]),
  ],
  build: (p, K) => enclosure(p, K),
});
function enclosure(p, K) {
  const { Manifold, CrossSection } = K; const L = p.L, W = p.W, w = p.wall;
  const oL = L + 2 * w, oW = W + 2 * w, ri = Math.max(0.01, p.r - w), ro = Math.max(p.r, 0.01);
  const Hb = p.floor + p.H; // base height
  let base = roundedRect(K, oL, oW, ro).extrude(Hb).subtract(roundedRect(K, L, W, ri).extrude(p.H + 1).translate([0, 0, p.floor]));
  const boss = 3.6; const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [sx * (L / 2 - boss + 0.6), sy * (W / 2 - boss + 0.6)]);
  if (p.lid === 'screws') {
    for (const [x, y] of corners) {
      const b = Manifold.cylinder(p.H, boss, boss, 40).add(Manifold.cube([boss, boss, p.H]).translate([x > 0 ? 0 : -boss, y > 0 ? 0 : -boss, 0])).translate([x, y, p.floor]);
      base = base.add(b.intersect(roundedRect(K, L + 0.01, W + 0.01, ri).extrude(Hb).translate([0, 0, 0.01]))).subtract(Manifold.cylinder(p.H - 1, 1.25, 1.25, 24).translate([x, y, p.floor + 1.01]));
    }
  }
  if (p.standoffs) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = sx * p.pcbX / 2, y = sy * p.pcbY / 2;
      const so = Manifold.cylinder(p.soH, 3, 3, 32).add(Manifold.cylinder(1.2, 4.2, 3, 32)).subtract(Manifold.cylinder(p.soH, p.soHole / 2, p.soHole / 2, 20).translate([0, 0, 0.6]));
      base = base.add(so.translate([x, y, p.floor - 0.01]));
    }
  }
  if (p.port !== 'none') {
    let cut;
    if (p.port === 'usbc') cut = roundedRect(K, 9.6, 3.8, 1.6, 8);
    else if (p.port === 'usbb') cut = roundedRect(K, 8.4, 3.4, 1.0, 8);
    else cut = CrossSection.circle(4, 32);
    base = base.subtract(cut.extrude(w * 3).translate([0, 0, -w * 1.5]).rotate([90, 0, 0]).translate([0, -W / 2 - w / 2, p.floor + p.portZ]));
  }
  // lid (modelled upside down: outer face at z=0)
  let lid = roundedRect(K, oL, oW, ro).extrude(p.lidT);
  if (p.lid === 'lip') {
    const lipW = 1.6, lipH = 4; const lo = roundedRect(K, L - 2 * p.fit, W - 2 * p.fit, Math.max(0.01, ri - p.fit));
    const lipRing = lo.subtract(roundedRect(K, L - 2 * p.fit - 2 * lipW, W - 2 * p.fit - 2 * lipW, Math.max(0.01, ri - p.fit - lipW))).extrude(lipH);
    lid = lid.add(lipRing.translate([0, 0, p.lidT - 0.01]));
  } else {
    for (const [x, y] of corners) lid = lid.subtract(Manifold.cylinder(p.lidT + 1, 1.7, 1.7, 24).translate([x, y, -0.5])).subtract(Manifold.cylinder(1.6, 3.1, 3.1, 24).translate([x, y, -0.01]));
  }
  if (p.vents) {
    const slots = []; const n2 = Math.max(1, Math.floor((L * 0.6) / 4));
    for (let i = 0; i < n2; i++) slots.push(roundedRect(K, 2, W * 0.45, 1, 6).translate([-((n2 - 1) * 4) / 2 + i * 4, 0]));
    lid = lid.subtract(CrossSection.union(slots).extrude(p.lidT + 2).translate([0, 0, -1]));
  }
  if (p.layout === 'base') return base;
  if (p.layout === 'lid') return lid;
  if (p.layout === 'assembled') return base.add(lid.mirror([0, 0, 1]).translate([0, 0, Hb + p.lidT + 0.01]));
  return base.add(lid.translate([oL + 10, 0, 0]));
}

// ------------------------------------------------------------------ gear
gen('gear', {
  label: 'Spur gear', blurb: 'Involute teeth, straight, helical or herringbone, with a bore and optional D-flat.',
  icon: gicon('<circle cx="16" cy="16" r="4"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/><circle cx="16" cy="16" r="9"/>'),
  params: [n('module', 'Module (tooth size)', 2, 0.3, 10, 0.1, ''), int('teeth', 'Teeth', 20, 6, 200), n('h', 'Thickness', 8, 0.5, 200), n('pa', 'Pressure angle', 20, 14.5, 30, 0.5, '°'),
    sel('style', 'Teeth', 'straight', [['straight', 'Straight'], ['helical', 'Helical'], ['herringbone', 'Herringbone']]), n('helix', 'Helix angle', 20, 0, 45, 1, '°'),
    n('bore', 'Bore', 5, 0, 200, 0.1), bool('dflat', 'D-flat on bore', false), n('backlash', 'Backlash', 0.1, 0, 1, 0.02)],
  build: (p, K) => {
    let prof = gearProfile(K, p.module, p.teeth, p.pa, p.backlash);
    if (p.bore > 0) prof = prof.subtract(boreSection(K, p.bore, p.dflat));
    const rp = p.module * p.teeth / 2; const seg = Math.max(1, Math.round(p.h / 0.5));
    if (p.style === 'straight' || p.helix === 0) return prof.extrude(p.h);
    if (p.style === 'helical') { const tw = (p.h * Math.tan(p.helix * Math.PI / 180) / rp) * 180 / Math.PI; return prof.extrude(p.h, seg, tw); }
    const hh = p.h / 2; const tw = (hh * Math.tan(p.helix * Math.PI / 180) / rp) * 180 / Math.PI;
    const half = prof.extrude(hh, Math.ceil(seg / 2), tw);
    return half.add(half.mirror([0, 0, 1]).translate([0, 0, 2 * hh]));
  },
  note: 'Two gears mesh when they share the same module. Centre distance = module × (teeth A + teeth B) / 2.',
});
export function gearProfile(K, m, z, pa = 20, backlash = 0.1) {
  const a = pa * Math.PI / 180; const rp = m * z / 2, rb = rp * Math.cos(a), ra = rp + m, rf = Math.max(rp - 1.25 * m, 0.5);
  const inv = (t) => t - Math.atan(t); const phi0 = Math.PI / (2 * z) - backlash / (2 * rp) + (Math.tan(a) - a);
  const teeth = [];
  const steps = 8; const r0 = Math.max(rb, rf);
  for (let i = 0; i < z; i++) {
    const c = (i / z) * Math.PI * 2; const L = [], R = [];
    for (let k = 0; k <= steps; k++) {
      const r = r0 + (ra - r0) * (k / steps); const t = Math.sqrt(Math.max(0, (r / rb) ** 2 - 1)); const ang = phi0 - inv(t);
      L.push([r * Math.cos(c - ang), r * Math.sin(c - ang)]); R.push([r * Math.cos(c + ang), r * Math.sin(c + ang)]);
    }
    const t0 = Math.sqrt(Math.max(0, (r0 / rb) ** 2 - 1)); const a0 = phi0 - inv(t0); const rin = rf * 0.92;
    const pts = [[rin * Math.cos(c - a0), rin * Math.sin(c - a0)], ...L, ...R.reverse(), [rin * Math.cos(c + a0), rin * Math.sin(c + a0)]];
    teeth.push(poly(K, pts));
  }
  return K.CrossSection.union([K.CrossSection.circle(rf, Math.max(32, z * 4)), ...teeth]);
}
function boreSection(K, d, dflat) {
  let b = K.CrossSection.circle(d / 2, 40);
  if (dflat) b = b.intersect(K.CrossSection.square([d * 2, d], true).translate([0, -d * 0.1]));
  return b;
}

// ------------------------------------------------------------------ gridfinity
gen('gridfinity', {
  label: 'Gridfinity-style bin', blurb: 'Storage bin on the 42 mm grid with a stacking base, dividers and magnet holes.',
  icon: gicon('<rect x="4" y="8" width="24" height="16" rx="3"/><path d="M12 8v16M20 8v16M6 24l2 3h16l2-3"/>'),
  params: [int('gx', 'Grid units wide', 2, 1, 8), int('gy', 'Grid units deep', 1, 1, 8), int('gz', 'Height units (7 mm)', 3, 2, 20),
    n('wall', 'Wall', 1.2, 0.6, 4, 0.1), int('div', 'Dividers', 1, 0, 10), bool('magnets', 'Magnet holes (6×2 mm)', false), bool('scoop', 'Finger scoop', true)],
  build: (p, K) => gridfinity(p, K),
});
function gridfinity(p, K) {
  const { Manifold } = K; const P = 42, S = 41.5, baseH = 4.75;
  const slab = (s, r, z) => roundedRect(K, s, s, r, 8).extrude(0.01).translate([0, 0, z]);
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    const x = (i - (p.gx - 1) / 2) * P, y = (j - (p.gy - 1) / 2) * P;
    const lower = Manifold.hull([slab(S - 5.9, 0.8, 0), slab(S - 4.3, 1.6, 0.8)]);
    const mid = Manifold.hull([slab(S - 4.3, 1.6, 0.8), slab(S - 4.3, 1.6, 2.6)]);
    const upper = Manifold.hull([slab(S - 4.3, 1.6, 2.6), slab(S, 3.75, baseH)]);
    let cell = Manifold.union([lower, mid, upper]);
    if (p.magnets) for (const sx of [-1, 1]) for (const sy of [-1, 1]) cell = cell.subtract(Manifold.cylinder(2.4, 3.25, 3.25, 28).translate([sx * 13, sy * 13, -0.01]));
    cells.push(cell.translate([x, y, 0]));
  }
  const W = p.gx * P - 0.5, D = p.gy * P - 0.5, H = p.gz * 7 - baseH;
  const outer = roundedRect(K, W, D, 3.75, 10).extrude(H).translate([0, 0, baseH - 0.01]);
  const iW = W - 2 * p.wall, iD = D - 2 * p.wall; const floorZ = baseH + 1.2;
  let cavity = roundedRect(K, iW, iD, Math.max(0.5, 3.75 - p.wall), 10).extrude(H + 1).translate([0, 0, floorZ]);
  if (p.scoop) {
    const sr = Math.min(12, H * 0.5);
    const fill = Manifold.cube([iW, sr, sr]).translate([-iW / 2, -iD / 2, floorZ]).subtract(Manifold.cylinder(iW + 2, sr, sr, 48).rotate([0, 90, 0]).translate([-iW / 2 - 1, -iD / 2 + sr, floorZ + sr]));
    cavity = cavity.subtract(fill);
  }
  let bin = Manifold.union([outer, ...cells]).subtract(cavity);
  for (let k = 1; k <= p.div; k++) {
    const x = -iW / 2 + (iW * k) / (p.div + 1);
    bin = bin.add(Manifold.cube([p.wall, iD + 0.2, H - 1.5]).translate([x - p.wall / 2, -iD / 2 - 0.1, floorZ - 0.01]));
  }
  return bin;
}

// ------------------------------------------------------------------ threads
const PITCH = { M5: 0.8, M6: 1, M8: 1.25, M10: 1.5, M12: 1.75, M16: 2, M20: 2.5, M24: 3 };
const THREAD_SIZES = [...Object.keys(PITCH), 'custom'];
export function threadSection(K, rMajor, depth, segs = 72) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const u = i / segs; const tri = 1 - Math.abs(2 * u - 1); // 0..1..0
    const r = rMajor - depth + depth * Math.min(1, Math.max(0, (tri - 0.08) / 0.84));
    const a = u * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return poly(K, pts);
}
export function threadRod(K, d, pitch, len, inner = false, fit = 0) {
  const depth = 0.6 * pitch; const rMajor = d / 2 + (inner ? fit : -fit);
  const turns = len / pitch; const rod = threadSection(K, rMajor, depth).extrude(len, Math.max(1, Math.ceil(turns * 16)), 360 * turns);
  return rod;
}
function sizeOf(p) { return p.size === 'custom' ? { d: p.d, pitch: p.pitch } : { d: parseFloat(p.size.slice(1)), pitch: PITCH[p.size] }; }
gen('bolt', {
  label: 'Bolt', blurb: 'Hex or round-head bolt with a printable ISO-style thread.',
  icon: gicon('<path d="M10 4h12l3 4H7z"/><path d="M12 8v20h8V8M12 12l8 2M12 16l8 2M12 20l8 2M12 24l8 2"/>'),
  params: [sel('size', 'Thread', 'M10', THREAD_SIZES), n('d', 'Custom diameter', 20, 4, 200, 0.5), n('pitch', 'Custom pitch', 2.5, 0.5, 10, 0.1),
    n('len', 'Thread length', 20, 2, 300), sel('head', 'Head', 'hex', [['hex', 'Hex'], ['round', 'Round knurled'], ['none', 'No head (threaded rod)']]), n('fit', 'Thread clearance', 0.15, 0, 1, 0.05)],
  build: (p, K) => {
    const { d, pitch } = sizeOf(p); const { Manifold } = K;
    let rod = threadRod(K, d, pitch, p.len, false, p.fit);
    const ch = 0.6 * pitch; const tip = Manifold.cylinder(p.len, d / 2 + p.len, d / 2 - ch, 64);
    rod = rod.intersect(p.head === 'none' ? tip.intersect(Manifold.cylinder(p.len, d / 2 - ch, d / 2 + p.len, 64)) : tip);
    if (p.head === 'none') return rod;
    const hh = d * 0.65; let head;
    if (p.head === 'hex') { const af = d * 1.6, Rc = af / 2 * 1.1; head = poly(K, circlePts(af / Math.sqrt(3), 6)).extrude(hh).intersect(Manifold.cylinder(hh, Rc + hh, Rc - hh * 0.35, 48)); }
    else { const R = d * 0.9; const pts = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; const r = R + (i % 4 < 2 ? 0 : -0.8); pts.push([Math.cos(a) * r, Math.sin(a) * r]); } head = poly(K, pts).extrude(hh); }
    return head.add(rod.translate([0, 0, hh - 0.01]));
  },
  note: 'Prints best standing on its head. Threads below M6 are too fine for most FDM printers.',
});
gen('nut', {
  label: 'Nut', blurb: 'Hex or wing nut that fits the bolt generator, with adjustable clearance.',
  icon: gicon('<path d="M10 5h12l6 11-6 11H10L4 16z"/><circle cx="16" cy="16" r="5"/>'),
  params: [sel('size', 'Thread', 'M10', THREAD_SIZES), n('d', 'Custom diameter', 20, 4, 200, 0.5), n('pitch', 'Custom pitch', 2.5, 0.5, 10, 0.1), n('h', 'Height', 8, 2, 100), sel('shape', 'Shape', 'hex', [['hex', 'Hex'], ['round', 'Knurled thumb nut']]), n('fit', 'Thread clearance', 0.2, 0, 1, 0.05)],
  build: (p, K) => {
    const { d, pitch } = sizeOf(p); const { Manifold } = K;
    const body = p.shape === 'hex' ? poly(K, circlePts(d * 1.6 / Math.sqrt(3), 6)).extrude(p.h) : poly(K, Array.from({ length: 72 }, (_, i) => { const a = i / 72 * Math.PI * 2, r = d * 1.1 + (i % 4 < 2 ? 0 : -0.8); return [Math.cos(a) * r, Math.sin(a) * r]; })).extrude(p.h);
    const inner = threadRod(K, d, pitch, p.h + 2, true, p.fit).translate([0, 0, -1]);
    const cs = 0.6 * pitch; const sink = Manifold.cylinder(cs + 0.01, d / 2 + cs, d / 2, 48).translate([0, 0, -0.01]);
    return body.subtract(inner).subtract(sink).subtract(sink.mirror([0, 0, 1]).translate([0, 0, p.h]));
  },
});

// ------------------------------------------------------------------ vase
gen('vase', {
  label: 'Vase (spiral mode)', blurb: 'Solid vase body for your slicer\'s spiral/vase mode, with twist and ribs.',
  icon: gicon('<path d="M11 4h10M12 4c0 5-6 7-6 14a10 10 0 0 0 20 0c0-7-6-9-6-14"/>'),
  params: [n('h', 'Height', 120, 10, 400), n('rb', 'Base diameter', 60, 5, 300), n('rm', 'Belly diameter', 90, 5, 300), n('belly', 'Belly height', 35, 5, 95, 1, '%'), n('rt', 'Top diameter', 50, 5, 300),
    int('sides', 'Sides (0 = round)', 0, 0, 24), int('ribs', 'Ribs', 12, 0, 64), n('ribDepth', 'Rib depth', 2, 0, 10, 0.1), n('twist', 'Twist', 90, -720, 720, 5, '°'),
    int('waves', 'Waves up the side', 0, 0, 20), n('waveDepth', 'Wave depth', 3, 0, 20, 0.5)],
  build: (p, K) => {
    const segs = p.sides >= 3 ? p.sides : 120; const pts = [];
    const N = p.ribs > 0 ? Math.max(segs, p.ribs * 12) : segs;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2; let r = 1;
      if (p.sides >= 3) { const k = Math.PI / p.sides; r = Math.cos(k) / Math.cos(((a + k) % (2 * k)) - k); }
      if (p.ribs > 0) r *= 1 - (p.ribDepth / Math.max(p.rm, 1)) * (0.5 - 0.5 * Math.cos(a * p.ribs));
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const body = poly(K, pts).extrude(p.h, Math.max(24, Math.round(p.h / 2)), p.twist);
    const f = (z) => { const t = z / p.h, b = p.belly / 100; const lerp = (a, c, u) => a + (c - a) * (0.5 - 0.5 * Math.cos(Math.PI * u)); return (t < b ? lerp(p.rb, p.rm, t / b) : lerp(p.rm, p.rt, (t - b) / (1 - b))) / 2; };
    const wave = (z) => (p.waves > 0 ? 1 + (p.waveDepth / Math.max(p.rm, 1)) * Math.sin((z / p.h) * p.waves * Math.PI * 2) : 1);
    return body.warp((v) => { const s = f(v[2]) * wave(v[2]); v[0] *= s; v[1] *= s; });
  },
  note: 'Slice with spiral/vase mode on for a single-wall vase. Keep the twist gentle so overhangs stay under 45°.',
});

// ------------------------------------------------------------------ knob
gen('knob', {
  label: 'Knob', blurb: 'Grip knob for a potentiometer or shaft, with D-shaft bore and pointer.',
  icon: gicon('<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4"/><path d="M16 5v5"/>'),
  params: [n('d', 'Diameter', 30, 8, 150), n('h', 'Height', 16, 4, 100), int('grips', 'Grip flutes', 18, 0, 60), n('shaft', 'Shaft diameter', 6, 2, 20, 0.1), bool('dflat', 'D-shaft flat', true), n('depth', 'Shaft depth', 12, 2, 100), bool('pointer', 'Pointer line', true)],
  build: (p, K) => {
    const { Manifold, CrossSection } = K; const R = p.d / 2;
    let prof = CrossSection.circle(R, 96);
    if (p.grips > 0) prof = prof.subtract(CrossSection.union(Array.from({ length: p.grips }, (_, i) => { const a = i / p.grips * Math.PI * 2; return CrossSection.circle(R * 0.08 + 0.6, 16).translate([Math.cos(a) * (R + 0.4), Math.sin(a) * (R + 0.4)]); })));
    let k = prof.extrude(p.h).intersect(Manifold.cylinder(p.h, R + 2, R + 2 - p.h * 0.12, 96));
    const shaft = boreSection(K, p.shaft + 0.2, p.dflat).extrude(Math.min(p.depth, p.h - 1.2)).translate([0, 0, -0.01]);
    k = k.subtract(shaft);
    if (p.pointer) k = k.subtract(Manifold.cube([1.2, R * 0.6, 1.2]).translate([-0.6, R * 0.3, p.h - 0.6]));
    return k;
  },
});

// ------------------------------------------------------------------ cable clip
gen('cableclip', {
  label: 'Cable clip', blurb: 'Screw-down clip with one or more snap-in cable slots.',
  icon: gicon('<path d="M4 24h24M8 24v-8a5 5 0 0 1 10 0v8M18 24v-8a5 5 0 0 1 10 0"/><circle cx="13" cy="17" r="2"/>'),
  params: [n('cable', 'Cable diameter', 6, 1, 40, 0.1), int('count', 'Cables', 2, 1, 12), n('wall', 'Wall', 1.8, 0.8, 6, 0.1), n('width', 'Clip width', 10, 3, 60), bool('screw', 'Screw tab', true), n('screwD', 'Screw hole', 3.4, 1, 8, 0.1)],
  build: (p, K) => {
    const { CrossSection } = K; const r = p.cable / 2 + 0.15, R = r + p.wall, pitch = 2 * R - p.wall * 0.5;
    const tab = p.screw ? p.screwD * 2.6 : 0; const total = p.count * pitch + p.wall + tab;
    let prof = CrossSection.square([total, p.wall]).translate([-total / 2, 0]);
    const x0 = -total / 2 + (p.screw ? tab : 0) + p.wall / 2;
    for (let i = 0; i < p.count; i++) { const cx = x0 + R + i * pitch - p.wall / 2 + p.wall / 2; prof = prof.add(CrossSection.circle(R, 48).translate([cx, R])); }
    for (let i = 0; i < p.count; i++) { const cx = x0 + R + i * pitch; prof = prof.subtract(CrossSection.circle(r, 48).translate([cx, R + 0.0])).subtract(CrossSection.square([r * 1.5, R + 1]).translate([cx - r * 0.75, R + r * 0.55])); }
    prof = prof.subtract(CrossSection.square([total + 2, 10]).translate([-total / 2 - 1, -10]));
    let clip = prof.extrude(p.width).rotate([90, 0, 0]);
    if (p.screw) clip = clip.subtract(K.Manifold.cylinder(p.wall * 3, p.screwD / 2, p.screwD / 2, 24).translate([-total / 2 + tab / 2, -p.width / 2, -p.wall]));
    return clip;
  },
});

// ------------------------------------------------------------------ text-free plate: sign / tag
gen('tag', {
  label: 'Name tag / keyring', blurb: 'Rounded plate with a keyring hole and raised border. Add text from Shapes.',
  icon: gicon('<rect x="4" y="9" width="24" height="14" rx="4"/><circle cx="8.5" cy="16" r="1.6"/><path d="M13 14h10M13 18h7"/>'),
  params: [n('w', 'Width', 60, 10, 300), n('d', 'Height', 22, 5, 200), n('t', 'Thickness', 2.4, 0.6, 20, 0.2), n('r', 'Corner radius', 5, 0, 50, 0.5), bool('hole', 'Keyring hole', true), n('holeD', 'Hole diameter', 5, 1, 20, 0.5), n('border', 'Raised border', 1.2, 0, 10, 0.2), n('borderH', 'Border height', 1, 0, 10, 0.2)],
  build: (p, K) => {
    let t = roundedRect(K, p.w, p.d, p.r, 10).extrude(p.t);
    if (p.border > 0 && p.borderH > 0) t = t.add(roundedRect(K, p.w, p.d, p.r, 10).subtract(roundedRect(K, p.w - 2 * p.border, p.d - 2 * p.border, Math.max(0.01, p.r - p.border), 10)).extrude(p.borderH).translate([0, 0, p.t - 0.01]));
    if (p.hole) t = t.subtract(K.Manifold.cylinder(p.t * 3, p.holeD / 2, p.holeD / 2, 32).translate([-p.w / 2 + p.holeD / 2 + Math.max(2, p.border + 1.5), 0, -p.t]));
    return t;
  },
});

// ------------------------------------------------------------------ LED strip channel (after usestl's LED Channel)
// Profile: U channel with chamfered bottom edges and a snap groove in each wall. The diffuser is a cover that
// sits on top with two flexible legs; barbs on the legs click into the grooves (push it straight down).
function ledDims(p) {
  const W = p.strip + 1, wall = p.wall, Wo = W + 2 * wall; // 0.5 mm play each side of the strip
  const Wt = W + 0.6;                    // opening at the top (walls step back 0.3 mm above the groove)
  const g0 = p.h - 4.45;                 // bottom of the groove
  const ct = p.dT, Wc = Math.min(Wo - 1.2, Wt + 2.2); // cover thickness and width (rests on the wall tops)
  const lt = 1.3;                        // leg thickness
  return { W, wall, Wo, Wt, g0, ct, Wc, lt };
}
function ledProfile(p, K) {
  const { W, Wo, Wt, g0 } = ledDims(p); const CS = K.CrossSection;
  if (g0 < p.floor + 2.4) throw new Error(`Channel height is too low for the snap-in diffuser. Make it at least ${(p.floor + 2.4 + 4.45).toFixed(2)} mm.`);
  if (p.wall < 1.4) throw new Error('Walls need to be at least 1.4 mm for the snap groove.');
  const c = 0.4; // bottom edge chamfer (helps with elephant's foot)
  const outer = CS.ofPolygons([[[-Wo / 2 + c, 0], [Wo / 2 - c, 0], [Wo / 2, c], [Wo / 2, p.h], [-Wo / 2, p.h], [-Wo / 2, c]]]);
  // inner cavity with the groove: in at 45°, straight, back out, then the slightly wider top opening
  const half = []; const x0 = W / 2, gd = 0.8;
  half.push([x0, p.floor], [x0, g0], [x0 + gd, g0 + gd], [x0 + gd, g0 + gd + 0.6], [Wt / 2, g0 + 2 * gd + 0.6], [Wt / 2, p.h + 1]);
  const cav = CS.ofPolygons([[...half, ...half.slice().reverse().map(([x, y]) => [-x, y])]]);
  return outer.subtract(cav);
}
function ledDiffuserProfile(p, K) {
  const { Wt, g0, ct, Wc, lt } = ledDims(p); const CS = K.CrossSection; const cl = Math.max(0.05, p.clr);
  const r = Math.min(0.6, ct / 2 - 0.05);
  const cover = CS.square([Wc - 2 * r, ct - r]).translate([-(Wc - 2 * r) / 2, p.h]).offset(r, 'Round', 2, 16).intersect(CS.square([Wc + 2, ct + 2]).translate([-Wc / 2 - 1, p.h]));
  const legX = Wt / 2 - cl; const zb = g0 + 0.15; const gd = 0.8;
  const leg = (s) => { const o = s * legX, i = s * (legX - lt); const barb = s * (legX + gd - 0.1 - cl);
    const pts = [[i, p.h + 0.01], [i, zb], [o, zb], [barb, g0 + gd + 0.15], [barb, g0 + gd + 0.5], [o, g0 + 2 * gd + 0.6], [o, p.h + 0.01]];
    return CS.ofPolygons([s > 0 ? pts : pts.slice().reverse()]); };
  return CS.union([cover, leg(1), leg(-1)]);
}
function along(cs, L, K) { return cs.extrude(L).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([-L / 2, 0, 0]); }
// Keep the side of a vertical plane where n·(x, y) ≤ d (n is a unit vector in XY).
function halfSpace(K, nx, ny, d, size = 4000) {
  return K.Manifold.cube([size, size, size], true).translate([-size / 2, 0, 0]).rotate([0, 0, Math.atan2(ny, nx) * 180 / Math.PI]).translate([nx * d, ny * d, 0]);
}
// 45° mitre: the back side (+y) of the channel is the inside of the corner, so it is shorter by one channel width.
// "Corner turns" = right mirrors that, so the front side is the inside.
function mitreCut(m, p, K, Wo) {
  const s = Math.SQRT1_2;
  if (p.finishEnd === 'miter') m = m.intersect(halfSpace(K, s, s, s * (p.len / 2 - Wo / 2)));
  if (p.startEnd === 'miter') m = m.intersect(halfSpace(K, -s, s, s * (p.len / 2 - Wo / 2)));
  return p.miterSide === 'right' ? m.mirror([0, 1, 0]) : m;
}
// Corner joint: an L-shaped sleeve that slides over two mitred channel ends and holds them at 90°.
function ledCornerJoint(p, K) {
  const { Wo } = ledDims(p); const M = K.Manifold; const s = Math.SQRT1_2;
  const g = 0.2, jw = 1.4, jl = p.jlen / 2, iW = Wo + 2 * g, oW = iW + 2 * jw, jh = p.h - 0.6;
  const inner = K.CrossSection.ofPolygons([[[-iW / 2 + 0.4, -0.01], [iW / 2 - 0.4, -0.01], [iW / 2, 0.4], [iW / 2, jh + 1], [-iW / 2, jh + 1], [-iW / 2, 0.4]]]);
  const prof = K.CrossSection.square([oW, jh + jw]).translate([-oW / 2, -jw]).subtract(inner);
  // arm along -x from the corner centre (0,0), long enough to pass the mitre line x + y = 0
  const L = jl + oW; const arm = along(prof, L, K).translate([-L / 2 + oW / 2, 0, 0]).intersect(halfSpace(K, s, s, 0));
  return M.union([arm, arm.mirror([s, s, 0])]); // second arm along +y
}
function ledCap(p, K, kind) {
  const { W, Wo, g0, ct } = ledDims(p); const t = 2, plug = 8, cl = Math.max(0.1, p.clr);
  const CS = K.CrossSection;
  // end plate covers the channel and the diffuser cover; the plug fills the strip space below the diffuser legs
  const plateCS = CS.square([Wo, p.h + ct]).translate([-Wo / 2, 0]);
  const plate = plateCS.extrude(t).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([-t, 0, 0]);
  const plugM = K.Manifold.cube([plug, W - 2 * cl, g0 - p.floor - cl]).translate([0, -(W - 2 * cl) / 2, p.floor + cl / 2]);
  let cap = plate.add(plugM);
  if (kind === 'cable') cap = cap.subtract(K.Manifold.cylinder(t + plug + 2, 2.2, 2.2, 32).rotate([0, 90, 0]).translate([-t - 1, 0, p.floor + 2.2]).add(K.Manifold.cube([t + plug + 2, 4.4, 2.2]).translate([-t - 1, -2.2, p.floor])));
  return cap; // plate at x ∈ [-t, 0], plug pointing +x (into the channel)
}
gen('ledchannel', {
  label: 'LED strip channel', blurb: 'Channel with a snap-in diffuser sized to your strip. End caps, 45° mitres, corner joints and joiners.',
  icon: gicon('<path d="M3 13h26v8H3z"/><path d="M3 13l2-2h22l2 2"/><path d="M8 17h2M14 17h2M20 17h2" stroke-width="2"/>'),
  keepOrigin: true,
  multi: [['channel', 'Channel', '#16D8AA'], ['diffuser', 'Diffuser', '#F3F3F0'], ['caps', 'End caps', '#16D8AA'], ['joiner', 'Joiner', '#16D8AA'], ['corner', 'Corner joint', '#16D8AA']],
  params: [n('len', 'Length of each piece', 200, 20, 1000), n('strip', 'LED strip width', 10, 3, 40, 0.5), n('h', 'Channel height', 9.25, 8.25, 40, 0.25), n('clr', 'Diffuser clearance', 0.15, 0, 0.6, 0.05),
    n('wall', 'Wall', 2.2, 1.4, 4, 0.1), n('floor', 'Floor', 1.4, 0.8, 4, 0.1), n('dT', 'Diffuser cover thickness', 1.45, 0.6, 3, 0.05),
    sel('startEnd', 'Start end', 'straight', [['straight', 'Straight'], ['miter', '45° mitre (corner)']]), sel('startCap', 'Start cap', 'cable', [['none', 'None'], ['smooth', 'Smooth'], ['cable', 'With cable exit']]),
    sel('finishEnd', 'Finish end', 'straight', [['straight', 'Straight'], ['miter', '45° mitre (corner)']]), sel('finishCap', 'Finish cap', 'smooth', [['none', 'None'], ['smooth', 'Smooth'], ['cable', 'With cable exit']]),
    sel('miterSide', 'Mitred corners turn', 'left', [['left', 'Left (back edge is the inside)'], ['right', 'Right (front edge is the inside)']]),
    int('holes', 'M3 mounting holes', 0, 0, 20), int('joiners', 'Joiners', 1, 0, 10), int('corners', 'Corner joints', 1, 0, 10), n('jlen', 'Joiner length', 30, 15, 80, 1), sel('layout', 'Show', 'assembled', [['assembled', 'Assembled'], ['separate', 'Separate parts (to print)']]),
    sel('part', 'This object is the', 'channel', [['channel', 'Channel'], ['diffuser', 'Diffuser'], ['caps', 'End caps'], ['joiner', 'Joiner'], ['corner', 'Corner joint']])],
  build: (p, K) => {
    const { W, Wo, ct } = ledDims(p); const sep = p.layout === 'separate'; const M = K.Manifold;
    if (p.part === 'diffuser') {
      // leave room for the cap plates at straight, capped ends
      const sIn = p.startEnd === 'straight' && p.startCap !== 'none' ? 0.75 : 0, fIn = p.finishEnd === 'straight' && p.finishCap !== 'none' ? 0.75 : 0;
      let d = along(ledDiffuserProfile(p, K), p.len - sIn - fIn, K).translate([(sIn - fIn) / 2, 0, 0]);
      d = mitreCut(d, p, K, Wo);
      if (!sep) return d;
      // print it cover-down: flip, put on the bed, next to the channel
      const f = d.rotate([180, 0, 0]); const b = f.boundingBox(); return f.translate([0, Wo + 8 - b.min[1] + Wo / 2 - Wo / 2, -b.min[2]]);
    }
    if (p.part === 'caps') {
      const caps = [];
      if (p.startEnd === 'straight' && p.startCap !== 'none') caps.push({ c: ledCap(p, K, p.startCap), at: -p.len / 2, flip: false });
      if (p.finishEnd === 'straight' && p.finishCap !== 'none') caps.push({ c: ledCap(p, K, p.finishCap), at: p.len / 2, flip: true });
      if (!caps.length) throw new Error('No end caps: both ends are mitred or set to None.');
      const out = caps.map(({ c, at, flip }, i) => {
        if (sep) return c.rotate([0, -90, 0]).translate([0, 0, 2]).translate([i * (p.h + ct + 8) - p.len / 2, -(Wo + 10 + Wo / 2), 0]); // plate down on the bed
        return (flip ? c.rotate([0, 0, 180]) : c).translate([at, 0, 0]);
      });
      return M.union(out);
    }
    if (p.part === 'joiner') {
      if (!p.joiners) throw new Error('Set Joiners to 1 or more to make joiners.');
      // a sleeve that slides over the outside of two channel ends (0.2 mm play), up to just under the cover
      const g = 0.2, jw = 1.4, jl = p.jlen, iW = Wo + 2 * g, oW = iW + 2 * jw, jh = p.h - 0.6;
      const inner = K.CrossSection.ofPolygons([[[-iW / 2 + 0.4, -0.01], [iW / 2 - 0.4, -0.01], [iW / 2, 0.4], [iW / 2, jh + 1], [-iW / 2, jh + 1], [-iW / 2, 0.4]]]);
      const prof = K.CrossSection.square([oW, jh + jw]).translate([-oW / 2, -jw]).subtract(inner);
      // stops in the middle, only against the walls: both pieces butt against them and the strip still passes
      const stop = (s) => M.cube([1.2, p.wall, jh * 0.7]).translate([-0.6, s > 0 ? Wo / 2 - p.wall : -Wo / 2, 0.4]);
      const one = along(prof, jl, K).add(stop(1)).add(stop(-1));
      const list = Array.from({ length: p.joiners }, (_, i) => (sep ? one.translate([i * (jl + 6) - p.len / 2 + jl / 2, -(2 * Wo + 30 + ct), jw]) : one.translate([p.len / 2 + 0.6, 0, 0])));
      return M.union(list);
    }
    if (p.part === 'corner') {
      if (!p.corners) throw new Error('Set Corner joints to 1 or more to make corner joints.');
      const c = ledCornerJoint(p, K); const right = p.miterSide === 'right';
      if (sep) { const b = c.boundingBox(); return M.union(Array.from({ length: p.corners }, (_, i) => c.translate([i * (b.max[0] - b.min[0] + 6) - b.min[0] + p.len / 2 + 10, -b.min[1] + Wo + 10, 1.4]))); }
      // assembled: at a mitred end (the finish end first), where the next channel would turn
      const at = p.finishEnd === 'miter' ? p.len / 2 - Wo / 2 : p.startEnd === 'miter' ? -(p.len / 2 - Wo / 2) : p.len / 2 + Wo / 2 + 0.6;
      let cc = p.finishEnd === 'miter' || p.startEnd !== 'miter' ? c : c.mirror([1, 0, 0]);
      if (right) cc = cc.mirror([0, 1, 0]);
      return cc.translate([at, 0, 0]);
    }
    let ch = along(ledProfile(p, K), p.len, K);
    ch = mitreCut(ch, p, K, Wo);
    if (p.holes > 0) {
      const usable = p.len - 30; const xs = p.holes === 1 ? [0] : Array.from({ length: p.holes }, (_, i) => -usable / 2 + usable * i / (p.holes - 1));
      // countersunk from the inside, so the screw head sits flush with the floor under the strip
      for (const x of xs) ch = ch.subtract(M.cylinder(p.floor + 2, 1.7, 1.7, 24).translate([x, 0, -1])).subtract(M.cylinder(p.floor + 0.02, 1.7, Math.min(3.1, 1.7 + p.floor), 24).translate([x, 0, -0.01]));
    }
    return ch;
  },
  note: 'Print the channel on its back, the diffuser cover-down in translucent filament and the caps plate-down. Push the diffuser straight down until both legs click. A joiner slides over two straight channel ends. For a corner, set the ends that meet to 45° mitre (the inside edge is shorter) and slide a corner joint over both. LED strips can’t bend sideways, so cut the strip at the corner and join it with a corner connector or two short wires.',
});

// ------------------------------------------------------------------ Hexagon wall lights
// A honeycomb of LED channel bars joined by 2-way and 3-way connectors. The bars use the LED channel profile
// and its snap-in diffuser; each connector has sleeves the bar ends slide into and a hollow hub for the wires.
const HEX_LAYOUTS = {
  single: [[0, 0]], three: [[0, 0], [1, 0], [0, 1]],
  flower: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]],
  wall: [[-2, 0], [-1, 0], [0, 0], [1, 0], [-1, 1], [-1, -1], [1, -1]],
};
// Any number of hexagons. Each one is a module: adding a hexagon reuses the bars it shares with its neighbours,
// so a wall grows one cell at a time. compact = honeycomb cluster that grows ring by ring around the first cell;
// strip = two rows, zig-zag (the classic garage wall); row = one straight row; column = one stacked line.
function hexCells(n, shape) {
  const out = [];
  if (shape === 'row') for (let i = 0; i < n; i++) out.push([i, 0]);
  else if (shape === 'strip') for (let i = 0; i < n; i++) out.push([Math.floor(i / 2), i % 2]);
  else if (shape === 'column') for (let i = 0; i < n; i++) out.push([-Math.floor(i / 2), i]);
  else { // compact: spiral out ring by ring
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]; out.push([0, 0]);
    for (let k = 1; out.length < n; k++) {
      let q = dirs[4][0] * k, r = dirs[4][1] * k;
      for (let d = 0; d < 6 && out.length < n; d++) for (let j = 0; j < k && out.length < n; j++) { out.push([q, r]); q += dirs[d][0]; r += dirs[d][1]; }
    }
  }
  return out;
}
function hexGrid(p) {
  let cells = HEX_LAYOUTS[p.layoutHex];
  if (p.layoutHex === 'count') cells = hexCells(Math.max(1, Math.round(p.hexCount || 1)), p.hexShape || 'compact');
  if (p.layoutHex === 'grid') { cells = []; for (let r = 0; r < p.rows; r++) for (let q = 0; q < p.cols; q++) cells.push([q - Math.floor(r / 2), r]); }
  const S = p.side, verts = new Map(), edges = new Map();
  const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const vert = (x, y) => { const k = key(x, y); if (!verts.has(k)) verts.set(k, { x, y, dirs: [] }); return k; };
  for (const [q, r] of cells) {
    const cx = S * Math.sqrt(3) * (q + r / 2), cy = S * 1.5 * r;
    const ks = Array.from({ length: 6 }, (_, i) => { const a = (30 + 60 * i) * Math.PI / 180; return vert(cx + S * Math.cos(a), cy + S * Math.sin(a)); });
    for (let i = 0; i < 6; i++) { const a = ks[i], b = ks[(i + 1) % 6]; const ek = a < b ? `${a}|${b}` : `${b}|${a}`; if (!edges.has(ek)) edges.set(ek, [a, b]); }
  }
  for (const [a, b] of edges.values()) {
    const A = verts.get(a), B = verts.get(b);
    A.dirs.push(Math.round(Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI)); B.dirs.push(Math.round(Math.atan2(A.y - B.y, A.x - B.x) * 180 / Math.PI));
  }
  // centre the whole wall on the origin
  const vs = [...verts.values()]; const mx = (Math.min(...vs.map((v) => v.x)) + Math.max(...vs.map((v) => v.x))) / 2, my = (Math.min(...vs.map((v) => v.y)) + Math.max(...vs.map((v) => v.y))) / 2;
  for (const v of vs) { v.x -= mx; v.y -= my; }
  const W = Math.max(...vs.map((v) => v.x)) * 2, H = Math.max(...vs.map((v) => v.y)) * 2;
  return { cells, verts: vs, edges: [...edges.values()].map(([a, b]) => [verts.get(a), verts.get(b)]), W, H };
}
function hexDims(p) {
  const { W, Wo, g0, ct } = ledDims(p);
  const g = 0.2, jw = 1.4, iW = Wo + 2 * g, oW = iW + 2 * jw, jh = p.h - 0.6;
  const R = Math.max(0.6 * oW, W / 2 + 4); // distance from the vertex to where a bar starts
  const bar = p.side - 2 * R - 0.4;
  return { W, Wo, g0, ct, g, jw, iW, oW, jh, R, bar };
}
// Modular ends: every joint is a 3-way connector. Where a joint has only two bars (the outside of the wall), the
// third arm points outward and is closed with a blanking plug that pulls out, so a hexagon can be added later.
const modularEnds = (p) => (p.ends || 'closed') === 'modular';
function freeDir(dirs) { // the missing third direction of a 2-bar joint (bars are 120° apart on a hex lattice)
  const a = dirs[0]; for (const c of [a + 120, a + 240]) { const n = ((Math.round(c) % 360) + 540) % 360 - 180; if (!dirs.some((d) => Math.abs(((d - n + 540) % 360) - 180) < 2)) return n; }
  return a + 180;
}
const jointDirs = (v, p) => (modularEnds(p) && v.dirs.length === 2 ? [...v.dirs, freeDir(v.dirs)] : v.dirs);
// Blanking plug: slides into a connector sleeve like the end of a bar (same outside shape, same clearance) with a
// plate that closes the end. Built along +x from the joint centre, like a sleeve.
function hexPlug(p, K) {
  const M = K.Manifold; const { Wo, jw, oW, R } = hexDims(p); const CS = K.CrossSection; const c = 0.4, t = 2;
  const outer = CS.ofPolygons([[[-Wo / 2 + c, 0], [Wo / 2 - c, 0], [Wo / 2, c], [Wo / 2, p.h], [-Wo / 2, p.h], [-Wo / 2, c]]]);
  // the plug fills the sleeve from 0.3 mm short of the hub to its mouth, and runs 0.3 mm on into the end plate
  const L = p.sleeve; const plug = along(outer, L, K).translate([R + 0.3 + L / 2, 0, 0]);
  const plate = M.cube([t, oW, p.h + jw]).translate([R + p.sleeve, -oW / 2, -jw]);
  // grip: a notch on top of the plate edge so it can be levered out with a fingernail or a flat screwdriver
  return M.union([plug, plate]).subtract(M.cube([t + 2, 6, 1.2]).translate([R + p.sleeve + t / 2, -3, p.h - 1.2]));
}
// Open-top hubs: the hub stops at the bar tops and is hollow down to the channel floor, so the LED strip runs in at the
// same height as in the bars and the strip ends, jumper wires and solder joints sit inside, under the diffuser.
const openHubs = (p) => (p.hubTop || 'closed') === 'open';
const hubTopZ = (p) => (openHubs(p) ? p.h : p.h + hexDims(p).ct);
function hexConnector(p, K, dirs) {
  const M = K.Manifold; const { W, g0, ct, jw, iW, oW, jh, R } = hexDims(p);
  const top = openHubs(p) ? p.h : p.h + ct, sl = p.sleeve; void ct;
  const inner = K.CrossSection.ofPolygons([[[-iW / 2 + 0.4, -0.01], [iW / 2 - 0.4, -0.01], [iW / 2, 0.4], [iW / 2, jh + 1], [-iW / 2, jh + 1], [-iW / 2, 0.4]]]);
  const prof = K.CrossSection.square([oW, jh + jw]).translate([-oW / 2, -jw]).subtract(inner);
  // the sleeve reaches 0.5 mm into the hub so every arm is fused to it (touching faces alone can leave an arm loose)
  const sleeve = along(prof, sl + 0.5, K).translate([R + sl / 2 - 0.25, 0, 0]);
  const face = M.cube([0.01, oW, top + jw]).translate([R - 0.01, -oW / 2, -jw]);
  const hub = M.hull(dirs.map((a) => face.rotate([0, 0, a])));
  const tunnel = M.cube([R + 0.5, W, g0 - p.floor]).translate([0, -W / 2, p.floor]);
  let c = M.union([hub, ...dirs.map((a) => sleeve.rotate([0, 0, a]))]);
  c = c.subtract(M.union([M.cylinder(g0 - p.floor, W / 2, W / 2, 32).translate([0, 0, p.floor]), ...dirs.map((a) => tunnel.rotate([0, 0, a]))]));
  if (openHubs(p)) {
    // hollow the hub: inner walls follow the sleeve insides, 1.4 mm walls all round, floor level with the channel floor
    const inFace = M.cube([0.01, iW, top + 2]).translate([R + 0.6, -iW / 2, p.floor]);
    c = c.subtract(M.hull(dirs.map((a) => inFace.rotate([0, 0, a]))));
    // countersunk M3 screw, head flush with the hub floor (under the strip)
    c = c.subtract(M.cylinder(top + jw + 2, 1.7, 1.7, 24).translate([0, 0, -jw - 1])).subtract(M.cylinder(1.6, 1.7, 3.3, 24).translate([0, 0, p.floor - 1.59]));
  } else {
    // countersunk M3 screw through the middle of the hub, head flush with the top
    c = c.subtract(M.cylinder(top + jw + 2, 1.7, 1.7, 24).translate([0, 0, -jw - 1])).subtract(M.cylinder(1.6, 1.7, 3.3, 24).translate([0, 0, top - 1.59]));
  }
  if (p.backHole) c = c.subtract(M.cylinder(jw + p.floor + 1, 3, 3, 24).translate([0, 0, -jw - 0.5]).translate([R * 0.55 * Math.cos(dirs[0] * Math.PI / 180), R * 0.55 * Math.sin(dirs[0] * Math.PI / 180), 0]));
  return c;
}
function hexCounts(p) {
  try {
    const gr = hexGrid(p); const d = hexDims(p);
    let n3 = gr.verts.filter((v) => v.dirs.length === 3).length, n2 = gr.verts.filter((v) => v.dirs.length === 2).length, plugs = 0;
    if (modularEnds(p)) { plugs = n2; n3 += n2; n2 = 0; }
    return { gr, d, n3, n2, plugs, bars: gr.edges.length };
  } catch { return null; }
}
// ---- Full-frame diffuser: one cover over every bar and connector, held on with double-sided tape.
// The footprint is the bars plus the connector hubs. The cover sits on the hub tops (with the tape under it); ribs
// under the cover drop onto the bar tops so the tape touches every bar too. Optional fillets/chamfers on the
// outer edge and/or the edges around each hexagon. It can be split so each piece fits a plate: cuts go across
// the middle of bars (never through a connector), so every joint sits on a bar with tape under both sides.
function hullPts(pts) { // convex hull, counter-clockwise (Andrew's monotone chain)
  const q = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (q.length < 3) return q;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const v of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 1e-9) lo.pop(); lo.push(v); }
  for (const v of q.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], v) <= 1e-9) up.pop(); up.push(v); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
function stripAlong(a, b, t0, t1, w) { // rectangle along a→b from distance t0 to t1, width w (counter-clockwise)
  const L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const P = (t, s) => [a.x + ux * t - uy * s * w / 2, a.y + uy * t + ux * s * w / 2];
  return [P(t0, -1), P(t1, -1), P(t1, 1), P(t0, 1)];
}
function frameFootprint(p, K, gr, d, w) {
  const CS = K.CrossSection; const rings = [];
  for (const [a, b] of gr.edges) rings.push(stripAlong(a, b, d.R - 0.05, p.side - d.R + 0.05, w));
  for (const v of gr.verts) { // the hub: same shape as the connector's hub (hull of the sleeve faces), at the cover width
    const pts = [];
    for (const deg of jointDirs(v, p)) { const r = deg * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r); pts.push([v.x + ux * d.R + uy * w / 2, v.y + uy * d.R - ux * w / 2], [v.x + ux * d.R - uy * w / 2, v.y + uy * d.R + ux * w / 2]); }
    rings.push(hullPts(pts));
  }
  return CS.union(rings.map((r) => CS.ofPolygons([r])));
}
// The footprint shrunk at its top for a fillet/chamfer, only on the edges that are switched on.
function insetSection(K, outerCS, holesCS, dOut, dIn) {
  const o = dOut > 0 ? outerCS.offset(-dOut, 'Miter', 4) : outerCS;
  if (!holesCS || holesCS.isEmpty()) return o;
  return o.subtract(dIn > 0 ? holesCS.offset(dIn, 'Miter', 4) : holesCS);
}
function frameCover(p, K, foot, z0) {
  const M = K.Manifold, CS = K.CrossSection; const T = p.fdT;
  const on = p.filOut || p.filIn; const r = Math.min(p.filR, T - 0.3);
  if (!on || !(r > 0.05)) return foot.extrude(T).translate([0, 0, z0]);
  const rings = foot.toPolygons(); const outerCS = CS.ofPolygons(rings.filter((g) => ringArea(g) > 0));
  const holesCS = outerCS.subtract(foot);
  // steps of 0.1 mm or finer: thinner than any print layer, so it slices exactly like a smooth fillet
  const n = Math.max(4, Math.min(30, Math.ceil(r / 0.1))); const dz = r / n;
  const parts = [foot.extrude(T - r + 0.002).translate([0, 0, z0])];
  for (let i = 1; i <= n; i++) {
    const t = r * i / n; const ins = p.filType === 'chamfer' ? t : r - Math.sqrt(Math.max(0, r * r - t * t));
    const sec = insetSection(K, outerCS, holesCS, p.filOut ? ins : 0, p.filIn ? ins : 0);
    if (!sec.isEmpty()) parts.push(sec.extrude(dz + 0.002).translate([0, 0, z0 + T - r + (i - 1) * dz]));
  }
  return M.union(parts);
}
// Points closer to v than to any other vertex: cutting along these lines splits every bar at its middle.
function clipHalf(poly, nx, ny, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length]; const fa = A[0] * nx + A[1] * ny - c, fb = B[0] * nx + B[1] * ny - c;
    if (fa <= 0) out.push(A);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
  }
  return out;
}
function vertexCell(v, verts, S) {
  let poly = [[v.x - 3 * S, v.y - 3 * S], [v.x + 3 * S, v.y - 3 * S], [v.x + 3 * S, v.y + 3 * S], [v.x - 3 * S, v.y + 3 * S]];
  for (const u of verts) {
    if (u === v) continue; const dx = u.x - v.x, dy = u.y - v.y; if (Math.hypot(dx, dy) > 2.5 * S) continue;
    poly = clipHalf(poly, dx, dy, (u.x + v.x) / 2 * dx + (u.y + v.y) / 2 * dy);
  }
  return poly;
}
// Smallest turn (0–175°, 5° steps) at which the points fit in maxW × maxD; null if none.
function fitTurn(pts, maxW, maxD) {
  for (let a = 0; a < 180; a += 5) {
    const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
    if (x1 - x0 <= maxW && y1 - y0 <= maxD) return a;
  }
  return null;
}
function frameDiffuserLimits(p) {
  if (p.fdSplit === 'joint') return [1e9, 1e9];
  if (p.fdSplit === 'custom') return [p.fdMaxW, p.fdMaxD];
  if (p.fdSplit === 'plate') return [(p.bedW || 256) - 2 * FRAME_PLATE_MARGIN, (p.bedD || 256) - 2 * FRAME_PLATE_MARGIN];
  return null;
}
const FRAME_PLATE_MARGIN = 3; // mm kept clear at each plate edge (skirt, brim, purge line)
function frameDiffuserPieces(p, K, gr, d) {
  const CS = K.CrossSection; const w = d.oW + 2 * p.fdOver; const foot = frameFootprint(p, K, gr, d, w);
  const lim = frameDiffuserLimits(p);
  if (!lim) return { foot, w, groups: [{ verts: gr.verts, cs: null, turn: 0 }] };
  const cells = new Map(gr.verts.map((v) => [v, vertexCell(v, gr.verts, p.side)]));
  if (p.fdSplit === 'joint') { // modular: one piece per connector (its cover and half of each bar)
    const region = (v) => CS.ofPolygons([cells.get(v)]);
    return { foot, w, groups: gr.verts.map((v) => { const cs = region(v); const t = fitTurn(foot.intersect(cs).toPolygons().flat(), 1e9, 1e9) ?? 0; return { verts: [v], cs, turn: t }; }) };
  }
  const [mw, md] = lim;
  const adj = new Map(gr.verts.map((v) => [v, []])); for (const [a, b] of gr.edges) { adj.get(a).push(b); adj.get(b).push(a); }
  // closing (grow, then shrink) seals the hairline gaps rounding leaves where neighbouring cells meet
  const regionOf = (vs) => CS.union(vs.map((v) => CS.ofPolygons([cells.get(v)]))).offset(0.05, 'Miter', 4).offset(-0.05, 'Miter', 4);
  const turnOf = (vs) => { const cut = foot.intersect(regionOf(vs)); return fitTurn(cut.toPolygons().flat(), mw, md); };
  // try the whole frame in one piece first (a small layout on a big plate)
  const whole = fitTurn(foot.toPolygons().flat(), mw, md);
  if (whole !== null) return { foot, w, groups: [{ verts: gr.verts, cs: null, turn: whole }] };
  // grow pieces outward from a corner of the layout, one bar at a time, while they still fit; try a few corners and
  // directions and keep the split with the fewest pieces
  const split = (ang) => {
    const c = Math.cos(ang), sn = Math.sin(ang); const key = (v) => v.x * c + v.y * sn;
    const order = gr.verts.slice().sort((a, b) => key(a) - key(b) || a.x - b.x || a.y - b.y); const left = new Set(order); const groups = [];
    while (left.size) {
      const seed = order.find((v) => left.has(v)); const grp = [seed]; left.delete(seed);
      let turn = turnOf(grp);
      if (turn === null) {
        const b = foot.intersect(regionOf(grp)).bounds(); const sz = Math.ceil(Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]));
        throw new Error(`A piece can’t be smaller than one connector with half of each bar (about ${sz} mm across). Choose a bigger plate or a bigger custom size, or a smaller hexagon side.`);
      }
      for (let grew = true; grew;) {
        grew = false;
        const cands = [...new Set(grp.flatMap((v) => adj.get(v)))].filter((u) => left.has(u)).sort((a, b) => key(a) - key(b) || a.x - b.x || a.y - b.y);
        for (const u of cands) { const t = turnOf([...grp, u]); if (t !== null) { grp.push(u); left.delete(u); turn = t; grew = true; break; } }
      }
      groups.push({ verts: grp, turn });
    }
    return groups;
  };
  let best = null;
  for (let k = 0; k < 6; k++) { const gs = split(k * Math.PI / 3); if (!best || gs.length < best.length) best = gs; }
  const groups = best.map((g) => ({ ...g, cs: regionOf(g.verts) }));
  return { foot, w, groups };
}
function frameDiffuser(p, K, gr, d) {
  const M = K.Manifold; const { foot, groups } = frameDiffuserPieces(p, K, gr, d);
  const tape = Math.max(0, p.tape); const z0 = hubTopZ(p) + tape; // cover underside: on the hub tops, plus the tape
  let solid = frameCover(p, K, foot, z0);
  // ribs onto the bar tops (the bars are d.ct lower than the hubs), so the tape holds the bars as well
  const rh = hubTopZ(p) - p.h; // hubs stand this much above the bars (0 when they're open)
  if (rh > 0.05) { const ribs = gr.edges.map(([a, b]) => K.CrossSection.ofPolygons([stripAlong(a, b, d.R + 0.2, p.side - d.R - 0.2, d.Wo)]).extrude(rh + 0.01).translate([0, 0, p.h + tape])); solid = M.union([solid, ...ribs]); }
  const sep = p.layout === 'separate';
  // assembled view only: trim 0.3 mm off each side of every cut so the joints show (the pieces to print are full size)
  const prism = (cs) => (sep ? cs : cs.offset(-0.3, 'Miter', 4)).extrude(400).translate([0, 0, -200]);
  let pieces = groups.map((g) => (g.cs ? solid.intersect(prism(g.cs)) : solid));
  pieces = pieces.map((m, i) => ({ m, turn: groups[i].turn })).filter((x) => !x.m.isEmpty() && x.m.volume() > 1);
  const pick = p.fdPiece > 0 ? Math.min(p.fdPiece, pieces.length) : 0;
  if (!sep) return pick ? pieces[pick - 1].m : pieces.length === 1 ? pieces[0].m : M.compose(pieces.map((x) => x.m));
  // to print: turned to fit the plate, cover face down (smooth face, ribs up, no supports), side by side
  const flat = pieces.map(({ m, turn }) => { const f = m.rotate([0, 0, turn]).rotate([180, 0, 0]); const b = f.boundingBox(); return f.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]); });
  if (pick) return flat[pick - 1];
  let x = 0; const out = [];
  for (const f of flat) { const b = f.boundingBox(); const wx = b.max[0] - b.min[0]; out.push(f.translate([x + wx / 2, 0, 0])); x += wx + 10; }
  return M.compose(out).translate([-(x - 10) / 2, 0, 0]);
}
// ---- Snap-fit diffuser with angled joints: one piece per bar, cut along the angle bisectors at each connector so the
// cuts meet at the hub centre (a straight mitre through 2-bar corners, a three-way star through 3-bar joints). Pieces
// snap into the bar grooves like the snap-in diffuser, and cover the open hubs too. Neighbouring pieces overlap in a
// half-lap (the top half of one over the bottom half of the next), so no light leaks and the whole frame reads as one.
const isMiter = (q) => q.diffType === 'miter';
function edgeCell(gr, a, b, Lr) {
  const ang = (v, w) => Math.atan2(w.y - v.y, w.x - v.x);
  const sides = (v, e) => { // bisector angles either side of edge direction e at vertex v
    const ds = v.dirs.map((d) => d * Math.PI / 180); let ccw = 2 * Math.PI, cw = 2 * Math.PI;
    for (const d of ds) { let g = ((d - e) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (g < 1e-3) continue; ccw = Math.min(ccw, g); cw = Math.min(cw, 2 * Math.PI - g); }
    return { left: e + ccw / 2, right: e - cw / 2 };
  };
  const u = ang(a, b), sa = sides(a, u), sb = sides(b, u + Math.PI);
  const P = (v, t) => [v.x + Math.cos(t) * Lr, v.y + Math.sin(t) * Lr];
  const ring = [[a.x, a.y], P(a, sa.right), P(b, sb.left), [b.x, b.y], P(b, sb.right), P(a, sa.left)];
  return ringArea(ring) < 0 ? ring.reverse() : ring;
}
function miterDiffuser(p, K, gr, d) {
  const M = K.Manifold, CS = K.CrossSection; const ct = d.ct, h0 = p.h; const lap = Math.max(0, p.lapLen ?? 3);
  const w = d.oW + 2 * (p.fdOver ?? 0.5); const foot = frameFootprint(p, K, gr, d, w);
  const cells = gr.edges.map(([a, b]) => CS.ofPolygons([edgeCell(gr, a, b, 3 * w + 20)]));
  // two layers, each a partition of the footprint; the order flips between layers, which makes the half-lap
  const layer = (order) => { const out = new Array(cells.length); let taken = null;
    for (const i of order) { let c = lap > 0 ? cells[i].offset(lap, 'Miter', 4) : cells[i]; if (taken) c = c.subtract(taken); out[i] = c.intersect(foot); taken = taken ? taken.add(c) : c; }
    return out; };
  const idx = cells.map((_, i) => i); const half = ct / 2;
  const topL = layer(idx), botL = lap > 0 ? layer(idx.slice().reverse()) : topL;
  const legs = along(ledDiffuserProfile(p, K).subtract(CS.square([400, 400]).translate([-200, h0])), d.bar - 0.3, K); // the snap legs only
  const pieces = gr.edges.map(([a, b], i) => {
    const parts = [botL[i].extrude(half + 0.001).translate([0, 0, h0]), topL[i].extrude(ct - half).translate([0, 0, h0 + half])];
    parts.push(legs.rotate([0, 0, Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI]).translate([(a.x + b.x) / 2, (a.y + b.y) / 2, 0]));
    let m = M.union(parts);
    const r = Math.min(p.filR ?? 0.6, ct - 0.3); // soften the top edges of the long sides (never the joints)
    if ((p.filOut || p.filIn) && r > 0.05) m = softenTop(K, m, foot, h0 + ct, r, p);
    return m;
  });
  return pieces;
}
// round/chamfer the outside and/or hexagon-side top edges of a piece, without touching its joint faces
function softenTop(K, m, foot, ztop, r, p) {
  const CS = K.CrossSection; const rings = foot.toPolygons(); const outerCS = CS.ofPolygons(rings.filter((g) => ringArea(g) > 0));
  const holesCS = outerCS.subtract(foot); const n = Math.max(4, Math.min(16, Math.ceil(r / 0.1))); const cut = [];
  for (let i = 1; i <= n; i++) {
    const t = r * i / n; const ins = p.filType === 'chamfer' ? t : r - Math.sqrt(Math.max(0, r * r - t * t));
    const keep = insetSection(K, outerCS, holesCS, p.filOut ? ins : 0, p.filIn ? ins : 0);
    cut.push(CS.square([1e5, 1e5], true).subtract(keep).extrude(r / n + 0.002).translate([0, 0, ztop - r + (i - 1) * r / n]));
  }
  return m.subtract(K.Manifold.union(cut));
}
function miterOutput(p, K, gr, d) {
  const M = K.Manifold; const pieces = miterDiffuser(p, K, gr, d);
  const pick = p.fdPiece > 0 ? Math.min(p.fdPiece, pieces.length) : 0;
  if (p.layout !== 'separate') return pick ? pieces[pick - 1] : M.compose(pieces); // assembled: seamless, as it will look
  // to print: cover face down (smooth face, legs up), turned along X, in rows
  const flat = pieces.map((m, i) => { const [a, b] = gr.edges[i]; const f = m.rotate([0, 0, -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI]).rotate([180, 0, 0]); const bb = f.boundingBox(); return f.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]); });
  if (pick) return flat[pick - 1];
  const out = []; const cols = Math.max(1, Math.floor(240 / (p.side + 10))); let row = 0, col = 0, rowH = 0, y = 0;
  for (const f of flat) { const bb = f.boundingBox(); const wx = bb.max[0] - bb.min[0], wy = bb.max[1] - bb.min[1]; out.push(f.translate([col * (p.side + 10), -y, 0])); rowH = Math.max(rowH, wy); if (++col >= cols) { col = 0; row++; y += rowH + 6; rowH = 0; } void wx; }
  void row; return M.compose(out);
}
function frameDiffuserInfo(p) {
  try {
    const gr = hexGrid(p); const d = hexDims(p); const K = KERNEL || kernelRef; if (!K) return null;
    const { groups } = frameDiffuserPieces(p, K, gr, d); return { pieces: groups.length };
  } catch (e) { return { error: e.message }; }
}
let kernelRef = null;
const infoMemo = new Map();
function frameDiffuserInfoMemo(p) {
  const k = JSON.stringify(['ends', 'sleeve', 'layoutHex', 'hexCount', 'hexShape', 'rows', 'cols', 'side', 'strip', 'h', 'wall', 'dT', 'fdOver', 'fdSplit', 'fdMaxW', 'fdMaxD', 'bedW', 'bedD'].map((x) => p[x]));
  if (!infoMemo.has(k)) { const r = frameDiffuserInfo(p); if (!r) return null; if (infoMemo.size > 50) infoMemo.clear(); infoMemo.set(k, r); }
  return infoMemo.get(k);
}
const isFrame = (q) => (q.diffType || 'snap') === 'frame';
const filOn = (q) => (isFrame(q) || isMiter(q)) && (q.filOut || q.filIn);
gen('hexlight', {
  label: 'Hexagon wall lights', blurb: 'Honeycomb LED wall light: channel bars with snap-in diffusers, joined by 2-way and 3-way connectors.',
  icon: gicon('<path d="M10 4l6 3.5v7L10 18l-6-3.5v-7z"/><path d="M22 11l6 3.5v7L22 25l-6-3.5v-7z"/><path d="M10 18v7l6 3.5"/>'),
  keepOrigin: true,
  multi: [['bar', 'Bars', '#2B2F36'], ['diffuser', 'Diffusers', '#F3F3F0'], ['joint3', '3-way connectors', '#2B2F36'], ['joint2', 'Edge pieces (plugs or 2-way)', '#2B2F36']],
  params: [sel('layoutHex', 'Layout', 'count', [['count', 'Choose how many hexagons'], ['single', 'One hexagon'], ['three', 'Three'], ['flower', 'Seven (flower)'], ['wall', 'Seven in a row (wall)'], ['grid', 'Grid (rows × columns)']]),
    { ...int('hexCount', 'Number of hexagons', 7, 1, 60), when: (q) => q.layoutHex === 'count' },
    { ...sel('hexShape', 'Arrangement', 'compact', [['compact', 'Honeycomb cluster'], ['strip', 'Two rows (zig-zag wall)'], ['row', 'One row'], ['column', 'One column']]), when: (q) => q.layoutHex === 'count' },
    { ...int('rows', 'Rows (grid)', 2, 1, 12), when: (q) => q.layoutHex === 'grid' }, { ...int('cols', 'Columns (grid)', 3, 1, 12), when: (q) => q.layoutHex === 'grid' },
    n('side', 'Hexagon side (vertex to vertex)', 150, 60, 800, 1), n('strip', 'LED strip width', 10, 3, 30, 0.5), n('h', 'Channel height', 9.25, 8.25, 30, 0.25),
    n('wall', 'Wall', 2.2, 1.4, 4, 0.1), n('floor', 'Floor', 1.4, 0.8, 4, 0.1), n('dT', 'Diffuser cover thickness', 1.45, 0.6, 3, 0.05), n('clr', 'Diffuser clearance', 0.15, 0, 0.6, 0.05),
    n('sleeve', 'Connector sleeve length', 15, 6, 40, 1), bool('backHole', 'Cable hole through the back of the connectors', false),
    sel('ends', 'Outside edge', 'modular', [['modular', 'Modular: 3-way connectors with plugs (add hexagons later)'], ['closed', 'Closed: 2-way corners (neater, fixed size)']]),
    sel('hubTop', 'Connector hubs', 'open', [['open', 'Open top: strip ends and wires join inside, under the diffuser'], ['closed', 'Closed top']]),
    sel('diffType', 'Diffuser', 'miter', [['miter', 'Snap-fit, angled joints (looks like one piece)'], ['frame', 'Full frame, one cover (double-sided tape)'], ['snap', 'Snap-in, one per bar']]),
    { ...n('lapLen', 'Joint overlap (half-lap)', 3, 0, 8, 0.5), when: isMiter },
    { ...n('fdT', 'Full-frame cover thickness', 2, 0.8, 6, 0.1), when: isFrame },
    { ...n('fdOver', 'Cover overhang past the connectors', 0.5, 0, 6, 0.1), when: (q) => isFrame(q) || isMiter(q) },
    { ...n('tape', 'Double-sided tape thickness', 1, 0, 3, 0.05), when: isFrame },
    { ...sel('fdSplit', 'Piece size', 'plate', [['none', 'No limit (one piece)'], ['plate', 'Fit my build plate'], ['custom', 'Custom maximum size'], ['joint', 'Modular: one piece per connector']]), when: isFrame },
    { ...n('fdMaxW', 'Largest piece: width', 200, 60, 3000, 1), when: (q) => isFrame(q) && q.fdSplit === 'custom' },
    { ...n('fdMaxD', 'Largest piece: depth', 200, 60, 3000, 1), when: (q) => isFrame(q) && q.fdSplit === 'custom' },
    { ...int('fdPiece', 'Show piece (0 = all)', 0, 0, 200), when: (q) => (isFrame(q) && q.fdSplit !== 'none') || isMiter(q) },
    { ...bool('filOut', 'Round the outer edge', true), when: (q) => isFrame(q) || isMiter(q) },
    { ...bool('filIn', 'Round the edges around each hexagon', true), when: (q) => isFrame(q) || isMiter(q) },
    { ...sel('filType', 'Edge shape', 'round', [['round', 'Fillet (round)'], ['chamfer', 'Chamfer (45°)']]), when: filOn },
    { ...n('filR', 'Fillet / chamfer size', 0.8, 0.1, 5, 0.1), when: filOn },
    { ...n('bedW', 'Plate width', 256, 50, 2000), when: () => false }, { ...n('bedD', 'Plate depth', 256, 50, 2000), when: () => false },
    sel('layout', 'Show', 'assembled', [['assembled', 'Whole wall (assembled)'], ['separate', 'One of each part (to print)']]),
    sel('part', 'This object is the', 'bar', [['bar', 'Bars'], ['diffuser', 'Diffusers'], ['joint3', '3-way connectors'], ['joint2', 'Edge pieces (plugs, or 2-way connectors when closed)']])],
  build: (p, K) => {
    const M = K.Manifold; const d = hexDims(p);
    if (d.bar < 20) throw new Error(`Hexagons are too small for this channel. Make the side at least ${Math.ceil(2 * d.R + 21)} mm.`);
    const gr = hexGrid(p); const sep = p.layout === 'separate';
    if (p.part === 'diffuser' && isFrame(p)) { kernelRef = K; return frameDiffuser(p, K, gr, d); }
    if (p.part === 'diffuser' && isMiter(p)) return miterOutput(p, K, gr, d);
    if (p.part === 'bar' || p.part === 'diffuser') {
      const piece = p.part === 'bar' ? along(ledProfile(p, K), d.bar, K) : along(ledDiffuserProfile(p, K), d.bar - 0.3, K);
      if (sep) return p.part === 'bar' ? piece : (() => { const f = piece.rotate([180, 0, 0]); const b = f.boundingBox(); return f.translate([0, d.oW + 10 - b.min[1], -b.min[2]]); })();
      return M.union(gr.edges.map(([a, b]) => piece.rotate([0, 0, Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI]).translate([(a.x + b.x) / 2, (a.y + b.y) / 2, 0])));
    }
    if (p.part === 'joint2' && modularEnds(p)) {
      // modular ends: this part is the blanking plugs for the outward arms
      const ends = gr.verts.filter((v) => v.dirs.length === 2);
      if (!ends.length) throw new Error('This layout has no open ends to plug.');
      const plug = hexPlug(p, K);
      if (sep) { const f = plug.rotate([0, -90, 0]); const b = f.boundingBox(); return f.translate([-(b.min[0] + b.max[0]) / 2 + 2 * d.R + p.sleeve + 15, -(b.min[1] + b.max[1]) / 2 - (d.oW + 2 * d.R + p.sleeve + 25), -b.min[2]]); } // plate down on the bed
      return M.union(ends.map((v) => plug.rotate([0, 0, freeDir(v.dirs)]).translate([v.x, v.y, 0])));
    }
    const want = p.part === 'joint3' ? 3 : 2;
    const vs = gr.verts.filter((v) => jointDirs(v, p).length === want);
    if (!vs.length) throw new Error(`This layout has no ${want}-way connectors.`);
    if (sep) { const c = hexConnector(p, K, want === 3 ? [90, 210, 330] : [30, 150]); return c.translate([want === 3 ? -2 * d.R - p.sleeve - 15 : 2 * d.R + p.sleeve + 15, -(d.oW + 2 * d.R + p.sleeve + 25), d.jw]); }
    const cache = new Map();
    return M.union(vs.map((v) => { const dirs = jointDirs(v, p); const k = dirs.slice().sort((x, y) => x - y).join(','); if (!cache.has(k)) cache.set(k, hexConnector(p, K, dirs)); return cache.get(k).translate([v.x, v.y, 0]); }));
  },
  note: (p) => {
    const c = hexCounts(p); if (!c) return '';
    const strip = (c.bars * (c.d.bar + 2 * c.d.R) / 1000).toFixed(1);
    const joints = modularEnds(p) ? `${c.n3} three-way connectors and ${c.plugs} blanking plugs` : `${c.n3} three-way and ${c.n2} two-way connectors`;
    const grow = modularEnds(p) ? 'Every part is modular: all joints are the same 3-way connector, and the arms on the outside edge are closed with plugs. To add a hexagon later, pull out the plugs where it goes, slide in bars and fit connectors at the new corners. ' : 'The outside edge uses closed 2-way corners: to add a hexagon later, swap the 2-way corners it touches for 3-way connectors (or switch Outside edge to Modular). ';
    const common = `${joints}. The wall is about ${Math.round(c.gr.W)} × ${Math.round(c.gr.H)} mm and needs about ${strip} m of LED strip. ${grow}`;
    const wiring = 'Cut the strip to one piece per bar and join neighbours with short wires through the connector hubs (strips can’t bend sideways). Screw each connector to the wall through its centre. ';
    if (isFrame(p)) {
      const info = frameDiffuserInfoMemo(p);
      const pcs = info?.error ? `Diffuser: ${info.error} ` : info ? `Full-frame diffuser: ${info.pieces === 1 ? 'one piece' : `${info.pieces} pieces`}${p.fdSplit === 'plate' ? ` (fits a ${p.bedW || 256} × ${p.bedD || 256} mm plate with ${FRAME_PLATE_MARGIN} mm to spare at each edge)` : p.fdSplit === 'custom' ? ` (each at most ${p.fdMaxW} × ${p.fdMaxD} mm)` : p.fdSplit === 'joint' ? ', one per connector: each covers its connector and half of each bar, so new hexagons just need more pieces (re-print the edge pieces next to a new hexagon, as they gain an arm)' : ''}. ` : '';
      return `To print for this layout: ${c.bars} bars (${c.d.bar.toFixed(1)} mm each), ${common}${pcs}` +
        'Print bars on their back and connectors flat. Print the diffuser cover face down in translucent filament (Show → One of each part lays the pieces out turned to fit; use Show piece to export one plate at a time). A chamfer prints cleaner than a fillet on the face-down edge. ' +
        `Fix it with ${p.tape} mm double-sided tape on the connector tops and on the bar tops under the ribs; pieces join across the middle of a bar, so put tape under both sides of each joint. ` + wiring;
    }
    return `To print for this layout: ${c.bars} bars and ${c.bars} diffusers (${c.d.bar.toFixed(1)} mm each), ${common}` +
      'Print bars on their back, diffusers cover-down in translucent filament, connectors flat. ' + wiring + 'Use “One of each part” to print, then make copies with Make many.';
  },
});

// ------------------------------------------------------------------ Gridfinity baseplate sized to a drawer
gen('gfbase', {
  label: 'Gridfinity baseplate for a drawer', blurb: 'Enter your drawer size: as many 42 mm cells as fit, padding to fill the rest, split to fit your bed.',
  icon: gicon('<rect x="4" y="4" width="24" height="24" rx="2"/><path d="M12 4v24M20 4v24M4 12h24M4 20h24"/>'),
  params: [n('dw', 'Drawer width', 300, 42, 2000), n('dd', 'Drawer depth', 200, 42, 2000), n('fit', 'Clearance (total)', 1, 0, 6, 0.5), bool('fill', 'Fill the drawer (padding)', true),
    sel('align', 'Grid position', 'center', [['center', 'Centred'], ['corner', 'Front-left corner']]), bool('magnets', 'Magnet holes (6×2 mm)', false), n('bed', 'Largest piece', 220, 84, 600, 1), n('gap', 'Gap between pieces', 4, 1, 30, 1)],
  build: (p, K) => {
    const M = K.Manifold; const P = 42; const W = p.dw - p.fit, D = p.dd - p.fit;
    const nx = Math.floor(W / P), ny = Math.floor(D / P); if (!nx || !ny) throw new Error('The drawer is smaller than one 42 mm cell.');
    const gw = nx * P, gd = ny * P; const fw = p.fill ? W : gw, fd = p.fill ? D : gd;
    const offx = p.align === 'center' ? (fw - gw) / 2 : 0, offy = p.align === 'center' ? (fd - gd) / 2 : 0;
    const H = 4.65, floor = p.magnets ? 2.4 : 0;
    const slab = (sz, r, z) => roundedRect(K, sz, sz, r, 8).extrude(0.01).translate([0, 0, z]);
    const pocket = M.union([M.hull([slab(P - 5.7, 0.8, -0.01), slab(P - 4.3, 1.6, 0.7)]), M.hull([slab(P - 4.3, 1.6, 0.7), slab(P - 4.3, 1.6, 2.5)]), M.hull([slab(P - 4.3, 1.6, 2.5), slab(P, 4, H + 0.01)])]).translate([0, 0, floor]);
    const through = floor ? null : M.cube([P - 5.7, P - 5.7, floor + 1], true);
    const magnet = p.magnets ? M.union([-1, 1].flatMap((sx) => [-1, 1].map((sy) => M.cylinder(2.41, 3.25, 3.25, 28).translate([sx * 13, sy * 13, floor - 2.4])))) : null;
    // split along cell lines so every piece fits the bed
    const per = Math.max(1, Math.floor((p.bed - Math.max(offx, offy)) / P));
    const cuts = (n, off, full) => { const xs = [0]; for (let c = per; c < n; c += per) xs.push(off + c * P); xs.push(full); return xs; };
    const cx = cuts(nx, offx, fw), cy = cuts(ny, offy, fd); const pieces = [];
    for (let i = 0; i + 1 < cx.length; i++) for (let j = 0; j + 1 < cy.length; j++) {
      const x0 = cx[i], x1 = cx[i + 1], y0 = cy[j], y1 = cy[j + 1];
      let piece = M.cube([x1 - x0, y1 - y0, H + floor]).translate([x0, y0, 0]);
      const holes = [];
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        const ccx = offx + (a + 0.5) * P, ccy = offy + (b + 0.5) * P; if (ccx < x0 || ccx > x1 || ccy < y0 || ccy > y1) continue;
        holes.push(pocket.translate([ccx, ccy, 0])); if (magnet) holes.push(magnet.translate([ccx, ccy, 0]));
      }
      if (holes.length) piece = piece.subtract(M.union(holes));
      pieces.push(piece.translate([i * p.gap, j * p.gap, 0]));
    }
    void through;
    return M.union(pieces).translate([-fw / 2, -fd / 2, 0]);
  },
  note: 'Cells snap together across the joins. Measure the inside of the drawer at the bottom.',
});

// ------------------------------------------------------------------ UI tab
// "Fit my build plate": keep generator parts that read the plate size in step with the chosen printer.
function plateSize(app) { const b = app.printerBed?.() || app.view?.r?.bed; return b ? [b.w, b.d] : [256, 256]; }
function syncPlate(app) {
  const [w, d] = plateSize(app); let changed = false;
  const visit = (list) => { for (const o of list || []) { if (o.children) visit(o.children); if (o.params && 'bedW' in o.params && (o.params.bedW !== w || o.params.bedD !== d)) { o.params = { ...o.params, bedW: w, bedD: d }; changed = true; } } };
  visit(app.scene?.objects);
  if (changed) { app.refresh?.(); app.view?.redraw?.(); }
}
export function install(app) {
  if (typeof app.applyPrinter === 'function') { const orig = app.applyPrinter.bind(app); app.applyPrinter = (...a) => { const r = orig(...a); syncPlate(app); return r; }; }
  app.scene?.on?.('change', () => syncPlate(app));
  const addGen = (g) => {
    app.setMode('design');
    if (!g.multi) return app.addShape(g.kind, defaultsOf(g), { name: g.label, list: GENERATORS });
    // several linked objects, one per part, so each can have its own colour in a 3MF
    const p = defaultsOf(g); const link = `L${Date.now().toString(36)}`; const s = app.scene; const made = [];
    if ('bedW' in p) [p.bedW, p.bedD] = plateSize(app);
    const first = app.addShape(g.kind, { ...p, part: g.multi[0][0] }, { name: `${g.label} · ${g.multi[0][1]}`, color: g.multi[0][2] });
    first.link = link; first.local = ['part']; made.push(first);
    s.edit(`add ${g.label.toLowerCase()}`, () => {
      for (const [part, name, color] of g.multi.slice(1)) {
        const o = { ...JSON.parse(JSON.stringify(first)), id: `${first.id}${part}`, name: `${g.label} · ${name}`, color, params: { ...first.params, part } };
        s.objects.push(o); made.push(o);
      }
      s.selection = new Set(made.map((o) => o.id));
    });
    s.emit('select'); app.toast(`${g.label}: ${made.length} linked parts. Change a setting on any of them and the others follow.`);
  };
  for (const g of GENERATORS) app.addAction({ label: g.label, group: 'Generator', iconHtml: g.icon, run: () => addGen(g) });
  app.library.addTab('generators', 'Parts', (el) => {
    el.append(h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Complete parts from a few measurements. Every number stays editable in the panel on the right.'));
    el.append(h('div', { class: 'gen-list' }, ...GENERATORS.map((g) => h('button', { class: 'gen-btn', onclick: () => addGen(g) },
      h('span', { html: g.icon }), h('b', {}, g.label), h('span', {}, g.blurb)))));
  });
}
export function defaultsOf(g) { const p = {}; for (const f of g.params) p[f.key] = f.def; return p; }
void ICONS; void roundedBox; void METRIC;
