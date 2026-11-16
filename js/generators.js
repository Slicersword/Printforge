// Parametric generators: complete printable parts from a few numbers.
import { registerKind } from './kernel.js';
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
function mitreCut(m, p, K, Wo) {
  const big = 4 * (Wo + p.h + 50);
  const cutter = (sign) => K.Manifold.cube([big, big, big], true).translate([sign * big / 2, 0, 0]).rotate([0, 0, -sign * 45]);
  if (p.startEnd === 'miter') m = m.subtract(cutter(-1).translate([-p.len / 2, -Wo / 2, 0]));
  if (p.finishEnd === 'miter') m = m.subtract(cutter(1).translate([p.len / 2, -Wo / 2, 0]));
  return m;
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
  label: 'LED strip channel', blurb: 'Channel with a snap-in diffuser sized to your strip. End caps, 45° mitres for corners and joiners.',
  icon: gicon('<path d="M3 13h26v8H3z"/><path d="M3 13l2-2h22l2 2"/><path d="M8 17h2M14 17h2M20 17h2" stroke-width="2"/>'),
  keepOrigin: true,
  multi: [['channel', 'Channel', '#16D8AA'], ['diffuser', 'Diffuser', '#F3F3F0'], ['caps', 'End caps', '#16D8AA'], ['joiner', 'Joiner', '#16D8AA']],
  params: [n('len', 'Length of each piece', 200, 20, 1000), n('strip', 'LED strip width', 10, 3, 40, 0.5), n('h', 'Channel height', 9.25, 8.25, 40, 0.25), n('clr', 'Diffuser clearance', 0.15, 0, 0.6, 0.05),
    n('wall', 'Wall', 2.2, 1.4, 4, 0.1), n('floor', 'Floor', 1.4, 0.8, 4, 0.1), n('dT', 'Diffuser cover thickness', 1.45, 0.6, 3, 0.05),
    sel('startEnd', 'Start end', 'straight', [['straight', 'Straight'], ['miter', '45° mitre (corner)']]), sel('startCap', 'Start cap', 'cable', [['none', 'None'], ['smooth', 'Smooth'], ['cable', 'With cable exit']]),
    sel('finishEnd', 'Finish end', 'straight', [['straight', 'Straight'], ['miter', '45° mitre (corner)']]), sel('finishCap', 'Finish cap', 'smooth', [['none', 'None'], ['smooth', 'Smooth'], ['cable', 'With cable exit']]),
    int('holes', 'M3 mounting holes', 0, 0, 20), int('joiners', 'Joiners', 1, 0, 10), n('jlen', 'Joiner length', 30, 15, 80, 1), sel('layout', 'Show', 'assembled', [['assembled', 'Assembled'], ['separate', 'Separate parts (to print)']]),
    sel('part', 'This object is the', 'channel', [['channel', 'Channel'], ['diffuser', 'Diffuser'], ['caps', 'End caps'], ['joiner', 'Joiner']])],
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
    let ch = along(ledProfile(p, K), p.len, K);
    ch = mitreCut(ch, p, K, Wo);
    if (p.holes > 0) {
      const usable = p.len - 30; const xs = p.holes === 1 ? [0] : Array.from({ length: p.holes }, (_, i) => -usable / 2 + usable * i / (p.holes - 1));
      // countersunk from the inside, so the screw head sits flush with the floor under the strip
      for (const x of xs) ch = ch.subtract(M.cylinder(p.floor + 2, 1.7, 1.7, 24).translate([x, 0, -1])).subtract(M.cylinder(p.floor + 0.02, 1.7, Math.min(3.1, 1.7 + p.floor), 24).translate([x, 0, -0.01]));
    }
    return ch;
  },
  note: 'Print the channel on its back, the diffuser cover-down in translucent filament and the caps plate-down. Push the diffuser straight down until both legs click. A joiner slides over two channel ends.',
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
export function install(app) {
  const addGen = (g) => {
    app.setMode('design');
    if (!g.multi) return app.addShape(g.kind, defaultsOf(g), { name: g.label, list: GENERATORS });
    // several linked objects, one per part, so each can have its own colour in a 3MF
    const p = defaultsOf(g); const link = `L${Date.now().toString(36)}`; const s = app.scene; const made = [];
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
