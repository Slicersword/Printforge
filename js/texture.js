// Texture an STL (after usestl's texture tool): wrap a relief texture onto any part.
// The mesh is subdivided until every edge is small compared with the pattern, then each vertex is pushed
// along its normal by the texture value. Projection: box (by face direction), cylinder or top-down.
// The base (faces pointing down) stays flat; you can paint more faces to keep smooth.
import { K, worldManifold, renderData, free, manifoldFromMesh } from './kernel.js';
import { h, row, numField } from './ui.js';
import { hex } from './renderer.js';
import { grayFromFile } from './makers.js';

// ---------------------------------------------------------------- texture library (period 1 in u and v, value 0..1)
const fr = (x) => x - Math.floor(x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const PER = 4; // periodic noise lattice size per tile
function vnoise(u, v, per = PER) { const x = u * per, y = v * per; const i = Math.floor(x), j = Math.floor(y); const fx = x - i, fy = y - j; const w = (a) => ((a % per) + per) % per;
  const a = hash(w(i), w(j)), b = hash(w(i + 1), w(j)), c = hash(w(i), w(j + 1)), d = hash(w(i + 1), w(j + 1)); const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; }
const fbm = (u, v) => 0.5 * vnoise(u, v, 4) + 0.3 * vnoise(u, v, 8) + 0.2 * vnoise(u, v, 16);
function voronoi(u, v, per) { const x = u * per, y = v * per; const i = Math.floor(x), j = Math.floor(y); let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ci = i + a, cj = j + b; const w = (q) => ((q % per) + per) % per; const px = ci + hash(w(ci), w(cj)), py = cj + hash(w(cj) + 7, w(ci) + 3); const d = Math.hypot(px - x, py - y); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d; }
  return [f1, f2]; }
function hexCell(u, v) { const sy = Math.sqrt(3); let ax = fr(u) - 0.5, ay = fr(v / sy) * sy - sy / 2; let bx = fr(u - 0.5) - 0.5, by = fr((v - sy / 2) / sy) * sy - sy / 2;
  const [x, y] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by]; return Math.max(Math.abs(x) * 0.5 + Math.abs(y) * 0.8660254, Math.abs(x)); } // 0 centre … 0.5 edge
const inHeart = (x, y) => { x *= 1.25; y = y * 1.25 + 0.15; const a = x * x + y * y - 0.25; return a * a * a - x * x * y * y * y < 0; };
const inStar = (x, y) => { const r = Math.hypot(x, y), a = Math.atan2(y, x) + Math.PI / 2; const k = Math.cos(Math.PI / 5) / Math.cos(((a % (2 * Math.PI / 5)) + 2 * Math.PI / 5) % (2 * Math.PI / 5) - Math.PI / 5); return r < 0.38 * (0.55 + 0.45 * (k - 1) * 4.2 > 0 ? Math.min(1, 0.55 + 0.45 * (k - 1) * 4.2) : 0.55); };
export const TEXTURES = {
  honeycomb: { label: 'Honeycomb', f: (u, v) => smooth(0.4, 0.46, 0.5 - hexCell(u, v) + 0.4) },
  hexbumps: { label: 'Hex bumps', f: (u, v) => Math.sqrt(clamp01(1 - (hexCell(u, v) / 0.5) ** 2)) },
  knurl: { label: 'Knurl', f: (u, v) => 1 - 2 * Math.max(Math.abs(fr(u + v) - 0.5), Math.abs(fr(u - v) - 0.5)) },
  diamond: { label: 'Diamond plate', f: (u, v) => { const a = fr(u * 2), b = fr(v * 2); const flip = (Math.floor(u * 2) + Math.floor(v * 2)) % 2; const x = flip ? a - b : a + b - 1; return smooth(0.18, 0.08, Math.abs(x)) * smooth(0.05, 0.2, Math.min(a, 1 - a, b, 1 - b) + 0.12); } },
  bricks: { label: 'Bricks', f: (u, v) => { const r = Math.floor(v * 3); const x = fr(u * 1.5 + (r % 2) * 0.5), y = fr(v * 3); return smooth(0, 0.06, Math.min(x, 1 - x)) * smooth(0, 0.1, Math.min(y, 1 - y)); } },
  noise: { label: 'Noise', f: (u, v) => fbm(u, v) },
  stone: { label: 'Stone', f: (u, v) => { const [a, b] = voronoi(u, v, 5); return smooth(0, 0.18, b - a) * (0.75 + 0.25 * fbm(u, v)); } },
  leather: { label: 'Leather', f: (u, v) => { const [a, b] = voronoi(u, v, 12); return smooth(0, 0.12, b - a) * 0.8 + 0.2 * vnoise(u, v, 16); } },
  wood: { label: 'Wood grain', f: (u, v) => 0.5 + 0.5 * Math.sin(Math.PI * 2 * (v * 6 + fbm(u, v) * 2.2)) },
  stripes: { label: 'Stripes', f: (u) => 0.5 + 0.5 * Math.sin(2 * Math.PI * u) },
  ribs: { label: 'Ribs', f: (u) => smooth(0.15, 0.3, 0.5 - Math.abs(fr(u) - 0.5)) },
  waves: { label: 'Waves', f: (u, v) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (u + 0.25 * Math.sin(2 * Math.PI * v))) },
  ripple: { label: 'Egg crate', f: (u, v) => 0.5 + 0.25 * (Math.sin(2 * Math.PI * u) + Math.sin(2 * Math.PI * v)) },
  zigzag: { label: 'Chevron', f: (u, v) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (v * 2 + Math.abs(fr(u) - 0.5) * 2)) },
  dots: { label: 'Dots', f: (u, v) => Math.sqrt(clamp01(1 - (Math.hypot(fr(u) - 0.5, fr(v) - 0.5) / 0.32) ** 2)) },
  checker: { label: 'Checker', f: (u, v) => { const a = fr(u * 2), b = fr(v * 2); const c = (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 0 ? 1 : 0; return c * smooth(0, 0.06, Math.min(a, 1 - a, b, 1 - b)); } },
  grid: { label: 'Grid', f: (u, v) => 1 - smooth(0.04, 0.08, Math.min(Math.abs(fr(u) - 0.5), Math.abs(fr(v) - 0.5)) - 0.4 + 0.04) },
  weave: { label: 'Basket weave', f: (u, v) => { const cu = Math.floor(u * 2), cv = Math.floor(v * 2); const a = fr(u * 2), b = fr(v * 2); const horiz = (cu + cv) % 2 === 0; const t = horiz ? fr(b * 3) : fr(a * 3); return 0.25 + 0.75 * Math.sin(Math.PI * t); } },
  twill: { label: 'Carbon twill', f: (u, v) => { const k = Math.floor(u * 4) + Math.floor(v * 4); const t = (((k % 4) + 4) % 4) < 2 ? fr(u * 4) : fr(v * 4); return 0.3 + 0.7 * Math.sin(Math.PI * t); } },
  crosshatch: { label: 'Crosshatch', f: (u, v) => Math.max(smooth(0.42, 0.48, Math.abs(fr((u + v) * 2) - 0.5)), smooth(0.42, 0.48, Math.abs(fr((u - v) * 2) - 0.5))) },
  scales: { label: 'Scales', f: (u, v) => { let best = 0; for (const [ox, oy] of [[0, 0], [0.5, 0.5], [1, 0], [0.5, -0.5], [0, 1], [1, 1]]) { const dx = fr(u) - ox, dy = fr(v * 2) / 2 - oy / 2 - 0.0; const d = Math.hypot(dx, dy * 2 - 0.0); if (d < 0.5) best = Math.max(best, 1 - d * 1.8); } return clamp01(best); } },
  triangles: { label: 'Triangles', f: (u, v) => { const y = v * 1.1547; const a = fr(y), b = fr(u + y * 0.5), c = fr(u - y * 0.5); return smooth(0.02, 0.09, Math.min(a, 1 - a, b, 1 - b, c, 1 - c)); } },
  rings: { label: 'Rings', f: (u, v) => 0.5 + 0.5 * Math.cos(2 * Math.PI * 3 * Math.hypot(fr(u) - 0.5, fr(v) - 0.5)) },
  hearts: { label: 'Hearts', f: (u, v) => (inHeart(fr(u) - 0.5, fr(v) - 0.5) ? 1 : 0) },
  stars: { label: 'Stars', f: (u, v) => (inStar(fr(u) - 0.5, fr(v) - 0.5) ? 1 : 0) },
  plus: { label: 'Crosses', f: (u, v) => { const x = Math.abs(fr(u) - 0.5), y = Math.abs(fr(v) - 0.5); return (x < 0.09 && y < 0.3) || (y < 0.09 && x < 0.3) ? 1 : 0; } },
  xmarks: { label: 'X marks', f: (u, v) => { const x = fr(u) - 0.5, y = fr(v) - 0.5; return Math.max(Math.abs(x), Math.abs(y)) < 0.28 && (Math.abs(x - y) < 0.1 || Math.abs(x + y) < 0.1) ? 1 : 0; } },
  sparkle: { label: 'Speckle', f: (u, v) => { let best = 0; const x = u * 6, y = v * 6; const i = Math.floor(x), j = Math.floor(y); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ci = ((i + a) % 6 + 6) % 6, cj = ((j + b) % 6 + 6) % 6; const px = i + a + hash(ci, cj), py = j + b + hash(cj + 9, ci + 4), rr = 0.12 + 0.18 * hash(ci + 3, cj + 7); const d = Math.hypot(px - x, py - y); if (d < rr) best = Math.max(best, Math.sqrt(1 - (d / rr) ** 2)); } return best; } },
  maze: { label: 'Maze', f: (u, v) => { const x = u * 4, y = v * 4; const i = Math.floor(x), j = Math.floor(y); const flip = hash(((i % 4) + 4) % 4, ((j % 4) + 4) % 4) > 0.5; const a = fr(x), b = fr(y); const d = flip ? Math.abs(a - b) : Math.abs(a + b - 1); return smooth(0.16, 0.1, d / Math.SQRT2 * 1.4); } },
  circuit: { label: 'Truchet arcs', f: (u, v) => { const x = u * 4, y = v * 4; const i = Math.floor(x), j = Math.floor(y); const flip = hash(((i % 4) + 4) % 4 + 2, ((j % 4) + 4) % 4 + 5) > 0.5; let a = fr(x), b = fr(y); if (flip) a = 1 - a; const d = Math.min(Math.abs(Math.hypot(a, b) - 0.5), Math.abs(Math.hypot(a - 1, b - 1) - 0.5)); return smooth(0.12, 0.06, d); } },
  puzzle: { label: 'Puzzle', f: (u, v) => { const x = fr(u), y = fr(v); const ex = Math.min(x, 1 - x), ey = Math.min(y, 1 - y); const knobs = Math.min(Math.abs(Math.hypot(x - 0.5, y - 0.04) - 0.13), Math.abs(Math.hypot(x - 0.96, y - 0.5) - 0.13)); const edge = Math.min(Math.hypot(x - 0.5, y - 0.04) < 0.13 ? 1 : ey, Math.hypot(x - 0.96, y - 0.5) < 0.13 ? 1 : ex); return smooth(0.01, 0.05, Math.min(edge, knobs)); } },
  arcs: { label: 'Arcs', f: (u, v) => { const r = Math.hypot(fr(u) - 0.5, fr(v)); return 0.5 + 0.5 * Math.cos(2 * Math.PI * r * 4); } },
  bars: { label: 'Bars', f: (u, v) => { const x = fr(u * 3), y = fr(v); const h2 = hash(Math.floor(u * 3) % 3 + 11, 1); return x > 0.2 && x < 0.8 && Math.abs(y - 0.5) < 0.25 + 0.2 * h2 ? 1 : 0; } },
};

// ---------------------------------------------------------------- mesh work
/** Split edges longer than L (midpoints shared per edge, so no cracks). Returns { P: number[], T: number[] }. */
export function subdivide(P, T, L, maxTris = 1.2e6) {
  const L2 = L * L;
  for (let pass = 0; pass < 14; pass++) {
    const mids = new Map(); let any = false;
    const mid = (a, b) => { const k = a < b ? a * 0x200000 + b : b * 0x200000 + a; let m = mids.get(k); if (m === undefined) { m = P.length / 3; P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2); mids.set(k, m); } return m; };
    const long = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz > L2; };
    // mark first, so both triangles sharing an edge agree
    const marked = new Set(); const nT = T.length / 3;
    for (let f = 0; f < nT; f++) for (let e = 0; e < 3; e++) { const a = T[f * 3 + e], b = T[f * 3 + (e + 1) % 3]; if (long(a, b)) { marked.add(a < b ? a * 0x200000 + b : b * 0x200000 + a); any = true; } }
    if (!any) break;
    if (T.length / 3 + marked.size * 2 > maxTris) break;
    const isM = (a, b) => marked.has(a < b ? a * 0x200000 + b : b * 0x200000 + a);
    const out = [];
    for (let f = 0; f < nT; f++) {
      let v = [T[f * 3], T[f * 3 + 1], T[f * 3 + 2]]; let m = [isM(v[0], v[1]), isM(v[1], v[2]), isM(v[2], v[0])]; const c = m.filter(Boolean).length;
      if (c === 0) { out.push(...v); continue; }
      if (c === 3) { const ab = mid(v[0], v[1]), bc = mid(v[1], v[2]), ca = mid(v[2], v[0]); out.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca); continue; }
      // rotate so that: one split → edge 0 is split; two splits → edge 2 is the unsplit one
      for (let r = 0; r < 3; r++) { if ((c === 1 && m[0]) || (c === 2 && !m[2])) break; v = [v[1], v[2], v[0]]; m = [m[1], m[2], m[0]]; }
      const [a, b, cc] = v;
      if (c === 1) { const ab = mid(a, b); out.push(a, ab, cc, ab, b, cc); }
      else { const ab = mid(a, b), bc = mid(b, cc); out.push(ab, b, bc, a, ab, bc, a, bc, cc); }
    }
    T = out;
  }
  return { P, T };
}

/** Build the textured mesh. `src` = { P, T } world mesh; returns { v: Float32Array, t: Uint32Array, tris }. */
export function textureMesh(src, o) {
  const fn = o.image ? imageSampler(o.image) : (TEXTURES[o.texture] || TEXTURES.honeycomb).f;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < src.P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], src.P[i + k]); hi[k] = Math.max(hi[k], src.P[i + k]); }
  // pick the edge length: fine enough for the pattern, but keep the triangle count sane
  let area = 0; const T0 = src.T, P0 = src.P;
  for (let f = 0; f < T0.length; f += 3) { const a = T0[f] * 3, b = T0[f + 1] * 3, c = T0[f + 2] * 3; const ux = P0[b] - P0[a], uy = P0[b + 1] - P0[a + 1], uz = P0[b + 2] - P0[a + 2], vx = P0[c] - P0[a], vy = P0[c + 1] - P0[a + 1], vz = P0[c + 2] - P0[a + 2]; area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; }
  let L = Math.max(0.2, o.size / (o.detail || 14)); const budget = o.maxTris || 900000; if (area / (L * L * 0.45) > budget) L = Math.sqrt(area / (budget * 0.45));
  const { P, T } = subdivide(Array.from(src.P), Array.from(src.T), L);
  const nV = P.length / 3, nT = T.length / 3;
  // face normals, masks and vertex normals
  const N = new Float64Array(nV * 3), keep = new Uint8Array(nV); const cosBase = Math.cos((o.baseAngle ?? 5) * Math.PI / 180);
  for (let f = 0; f < nT; f++) {
    const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz) || 1;
    const ux1 = nx / len, uy1 = ny / len, uz1 = nz / len;
    let masked = -uz1 >= cosBase || (o.keepTop && uz1 >= cosBase);
    if (!masked && o.mask?.length) for (const m of o.mask) {
      const dot = ux1 * m.n[0] + uy1 * m.n[1] + uz1 * m.n[2];
      if (m.kind === 'angle' ? dot >= m.cos : dot > 0.999 && Math.abs(m.n[0] * P[a * 3] + m.n[1] * P[a * 3 + 1] + m.n[2] * P[a * 3 + 2] - m.d) < m.tol) { masked = true; break; }
    }
    for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; if (masked) keep[v] = 1; }
  }
  const rot = (o.rotation || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot); const s = o.size;
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  // unfolded: the sides are mapped by distance around the outline (convex hull of the footprint), so the
  // pattern runs on across the vertical edges; top and bottom use top-down coordinates
  let hull = null; if (o.projection === 'unfold') hull = perimeterMap(P, nV0(P), cx0(lo, hi), cy0(lo, hi));
  let circ = 1; if (o.projection === 'cylinder') { let rsum = 0; for (let i = 0; i < nV; i++) rsum += Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy); const R = rsum / nV; circ = Math.max(1, Math.round(2 * Math.PI * R / s)) / (2 * Math.PI); }
  const out = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (keep[i]) { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; continue; }
    let u, w;
    if (o.projection === 'cylinder') { u = Math.atan2(y - cy, x - cx) * circ; w = z / s; }
    else if (o.projection === 'unfold') { if (Math.abs(nz) > 0.7) { u = x / s; w = y / s; } else { u = hull(x, y) / s; w = z / s; } }
    else if (o.projection === 'top') { u = x / s; w = y / s; }
    else { const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); if (az >= ax && az >= ay) { u = x / s; w = y / s; } else if (ax >= ay) { u = y / s; w = z / s; } else { u = x / s; w = z / s; } }
    const ru = u * cr - w * sr, rw = u * sr + w * cr;
    let val = clamp01(fn(ru, rw));
    let amt = o.engrave ? -val * o.depth : o.symmetric ? (val - 0.5) * o.depth : val * o.depth;
    let dx = nx * amt, dy = ny * amt, dz = nz * amt;
    if (o.overhang && dz < 0) dz = 0;
    out[i * 3] = x + dx; out[i * 3 + 1] = y + dy; out[i * 3 + 2] = z + dz;
  }
  return { v: out, t: new Uint32Array(T), tris: nT };
}
const nV0 = (P) => P.length / 3; const cx0 = (lo, hi) => (lo[0] + hi[0]) / 2; const cy0 = (lo, hi) => (lo[1] + hi[1]) / 2;
/** Distance around the convex hull of the footprint for a point, measured from the hull's first corner. */
function perimeterMap(P, nV, cx, cy) {
  const pts = []; for (let i = 0; i < nV; i++) pts.push([P[i * 3], P[i * 3 + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = []; for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1)); const cum = [0]; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return (x, y) => { // nearest point on the hull outline → arc length
    let best = Infinity, at = 0;
    for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); if (d < best) { best = d; at = cum[i] + t * Math.sqrt(L2); } }
    return at;
  };
}
function imageSampler(img) { const { g, gw, gh } = img; return (u, v) => { const x = fr(u) * gw, y = (1 - fr(v)) * gh; const i = Math.min(gw - 1, Math.floor(x)), j = Math.min(gh - 1, Math.floor(y)); return g[j * gw + i] / 255; }; }

// ---------------------------------------------------------------- the tool panel
export function install(app) {
  const st = { texture: 'honeycomb', image: null, size: 10, depth: 0.8, rotation: 0, engrave: false, symmetric: false, overhang: false, projection: 'box', baseAngle: 5, keepTop: false, mask: [], keep: false, maskMode: 'off', bucket: 20 };
  let target = null, timer = 0, result = null, busy = false, info = '', stats = '';
  const thumbs = {};
  const thumb = (key, f) => { if (thumbs[key]) return thumbs[key]; const c = document.createElement('canvas'); c.width = c.height = 44; const x = c.getContext('2d'); const im = x.createImageData(44, 44); for (let j = 0; j < 44; j++) for (let i = 0; i < 44; i++) { const v = Math.round(clamp01(f(i / 22, 1 - j / 22)) * 255); const k = (j * 44 + i) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; } x.putImageData(im, 0, 0); thumbs[key] = c.toDataURL(); return thumbs[key]; };
  const release = () => { if (result?.item) app.view.r.release(result.item.rd); if (result?.man) free(result.man); result = null; app.view.preview = null; };
  const close = () => { if (!app.texTool) return; app.texTool = false; app.toolPanel = null; app.view.facePick = null; release(); target = null; app.refresh(); app.view.redraw(); };
  const compute = () => {
    if (!target) return; busy = true; app.refresh();
    setTimeout(() => {
      try {
        release(); const t0 = performance.now();
        const wm = worldManifold(target); const mesh = wm.getMesh();
        const parts = wm.decompose(); stats = `${parts.length} shell${parts.length === 1 ? '' : 's'} · 0 open edges · ${(mesh.triVerts.length / 3).toLocaleString()} triangles before`; parts.forEach(free); free(wm);
        const np = mesh.numProp, vp = mesh.vertProperties; const P = []; for (let i = 0; i < vp.length; i += np) P.push(vp[i], vp[i + 1], vp[i + 2]);
        const res = textureMesh({ P, T: Array.from(mesh.triVerts) }, st);
        const man = manifoldFromMesh({ v: res.v, t: res.t });
        const rd = renderData({ man, render: null });
        const item = { rd, model: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), normalMat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), rgb: hex(target.color), hole: false, selected: false, centre: [0, 0, 0] };
        result = { man, item, v: res.v, t: res.t };
        app.view.preview = { items: [item], ghost: new Map([[target.id, 'A']]) };
        info = `${res.tris.toLocaleString()} triangles after · ${Math.round(performance.now() - t0)} ms`;
      } catch (e) { info = `Couldn’t texture this part: ${e.message}`; }
      busy = false; app.refresh(); app.view.redraw();
    }, 20);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(compute, 350); };
  const retarget = (o) => { target = o; st.mask = []; app.scene.selection = new Set([o.id]); app.scene.emit('select'); compute(); };
  const open = () => {
    app.setMode('design'); app.closeBoolean?.();
    let sel = app.scene.selected().filter((o) => !o.hole);
    if (sel.length !== 1) {
      // nothing chosen: try the textures on a 50 mm demo cube, like usestl
      const cube = app.addShape('box', { w: 50, d: 50, h: 50, r: 0 }, { name: 'Demo cube (50 mm)' }); sel = [cube];
    }
    target = sel[0]; st.mask = []; app.texTool = true; app.toolPanel = panel;
    document.getElementById('app').classList.add('show-right');
    app.view.facePick = null; st.maskMode = 'off'; compute();
  };
  const apply = () => {
    if (!result) return; const s = app.scene; const src = target; let made;
    s.edit('texture', () => {
      made = app.addMesh(`${src.name} textured`, result.v, result.t, src.color);
      const i = s.objects.indexOf(src); if (st.keep) { src.visible = false; s.objects.splice(i + 1, 0, made); } else s.objects.splice(i, 1, made);
      s.selection = new Set([made.id]);
    });
    close(); s.emit('select'); app.toast('Texture applied. Export as STL or 3MF to slice it.');
  };
  // clicking faces in the view: paint (that flat face), bucket (every face within an angle), erase
  const sameMask = (q, n, d) => q.n[0] * n[0] + q.n[1] * n[1] + q.n[2] * n[2] > 0.999 && (q.kind === 'angle' || Math.abs(q.d - d) < 0.05);
  const onFace = (f) => {
    const it = f.it; const P = it.rd.P, T = it.rd.T; const v = T[f.tris[0] * 3] * 3; const m = it.model;
    const wp = [m[0] * P[v] + m[4] * P[v + 1] + m[8] * P[v + 2] + m[12], m[1] * P[v] + m[5] * P[v + 1] + m[9] * P[v + 2] + m[13], m[2] * P[v] + m[6] * P[v + 1] + m[10] * P[v + 2] + m[14]];
    const n = f.normal; const d = n[0] * wp[0] + n[1] * wp[1] + n[2] * wp[2];
    if (st.maskMode === 'erase') st.mask = st.mask.filter((q) => !sameMask(q, n, d));
    else if (st.maskMode === 'bucket') st.mask.push({ kind: 'angle', n, cos: Math.cos(st.bucket * Math.PI / 180) });
    else { const i = st.mask.findIndex((q) => q.kind !== 'angle' && sameMask(q, n, d)); if (i >= 0) st.mask.splice(i, 1); else st.mask.push({ kind: 'plane', n, d, tol: 0.05 }); }
    schedule(); app.refresh();
  };
  const placeOnFace = (f) => { app.view.facePick = null; app.layOnFace(f.obj, f.normal); st.maskMode = 'off'; schedule(); app.refresh(); };
  const setMaskMode = (m) => { st.maskMode = m; app.view.facePick = m === 'off' ? null : onFace; app.refresh(); if (m !== 'off') app.toast(m === 'erase' ? 'Click a smooth face to texture it again.' : m === 'bucket' ? `Click a face: every face within ${st.bucket}° of it stays smooth.` : 'Click flat faces to keep them smooth.'); };
  const saveSettings = () => { const { image, ...rest } = st; const blob = new Blob([JSON.stringify({ printforgeTexture: 1, ...rest }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(target?.name || 'texture').replace(/\W+/g, '-')}.texture.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const openSettings = async (file) => { try { const j = JSON.parse(await file.text()); if (!j.printforgeTexture) throw new Error('This is not a PrintForge texture file.'); for (const k of Object.keys(st)) if (k in j && k !== 'image') st[k] = j[k]; setMaskMode('off'); schedule(); app.refresh(); } catch (e) { app.toast(e.message); } };
  const importFile = async (file) => { const before = new Set(app.scene.objects.map((o) => o.id)); await app.importFiles([file]); const added = app.scene.objects.filter((o) => !before.has(o.id) && o.type !== 'shape' || (!before.has(o.id))); if (added[0]) retarget(added[0]); };
  function panel() {
    const num = (label, key, opts, unit) => row(label, numField(st[key], (v) => { st[key] = v; schedule(); }, opts), unit);
    const chk = (label, key, note) => h('label', { class: 'check', title: note || '' }, h('input', { type: 'checkbox', checked: st[key], onchange: (e) => { st[key] = e.target.checked; schedule(); } }), label);
    const grid = h('div', { class: 'tex-grid' }, ...Object.entries(TEXTURES).map(([k, t]) => h('button', { class: 'tex' + (!st.image && st.texture === k ? ' on' : ''), title: t.label, 'aria-label': t.label, onclick: () => { st.texture = k; st.image = null; schedule(); app.refresh(); } }, h('img', { src: thumb(k, t.f), alt: '' }))));
    const o = target; const tb = o ? app.scene.worldBox(o) : null;
    const modeBtn = (m, l) => h('button', { 'aria-pressed': String(st.maskMode === m), onclick: () => setMaskMode(m) }, l);
    return [
      h('div', { class: 'tool-head' }, h('h3', {}, 'Texture'), h('button', { class: 'btn', onclick: close }, 'Close')),
      h('fieldset', {}, h('legend', {}, 'File'), h('p', { class: 'note', style: { margin: 0 } }, h('b', {}, o?.name || ''), tb ? ` · ${tb.max.map((v, i) => (v - tb.min[i]).toFixed(1)).join(' × ')} mm` : ''),
        h('p', { class: 'note', style: { margin: '2px 0 6px' } }, busy ? 'Working…' : [stats, info].filter(Boolean).join(' · ')),
        h('label', { class: 'btn', style: { width: '100%', textAlign: 'center' } }, 'Choose an STL / 3MF…', h('input', { type: 'file', accept: '.stl,.3mf,.obj,.glb', hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) importFile(f); } }))),
      h('fieldset', {}, h('legend', {}, `Texture: ${st.image ? 'your image' : TEXTURES[st.texture].label} (${Object.keys(TEXTURES).length})`), grid,
        h('label', { class: 'btn', style: { width: '100%', textAlign: 'center' } }, 'Upload my image…', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const g = await grayFromFile(f, 256); st.image = { g: g.g, gw: g.gw, gh: g.gh }; schedule(); app.refresh(); } catch (err) { app.toast(err.message); } } })),
        h('p', { class: 'note' }, 'Black-and-white PNG or JPEG: white is high, black is low. A seamless tile looks best.')),
      h('fieldset', {}, h('legend', {}, 'Relief'), num('Pattern size', 'size', { min: 1, max: 200, step: 0.5 }), num('Depth', 'depth', { min: 0.1, max: 10, step: 0.1 }), num('Rotation', 'rotation', { min: -180, max: 180, step: 5 }, '°'),
        chk('Engrave (inward)', 'engrave'), chk('Symmetric relief (half inward)', 'symmetric'), chk('Overhang protection (never pushes down)', 'overhang')),
      h('fieldset', {}, h('legend', {}, 'Projection'), row('Mode', h('select', { onchange: (e) => { st.projection = e.target.value; schedule(); app.refresh(); } }, ...[['unfold', 'Unfolded (continuous around the sides)'], ['box', 'Box (by face direction)'], ['cylinder', 'Cylinder (wraps around Z)'], ['top', 'Top-down']].map(([v, l]) => h('option', { value: v, selected: st.projection === v }, l)))),
        h('p', { class: 'note' }, st.projection === 'unfold' ? 'The pattern runs on around the sides with one seam; top and bottom are mapped from above.' : st.projection === 'box' ? 'Each side gets the pattern facing it; there are seams at the edges.' : st.projection === 'cylinder' ? 'Best for round parts like vases and cups.' : 'Straight down from above, for flat or dome-shaped tops.'),
        num('Base angle (kept flat)', 'baseAngle', { min: 0, max: 60, step: 1 }, '°'), chk('Keep the top flat too', 'keepTop')),
      h('fieldset', {}, h('legend', {}, 'Smooth faces (mask)'), h('div', { class: 'seg mask-seg' }, modeBtn('off', 'Off'), modeBtn('paint', 'Paint face'), modeBtn('bucket', 'Bucket by angle'), modeBtn('erase', 'Erase')),
        st.maskMode === 'bucket' ? num('Angle', 'bucket', { min: 1, max: 89, step: 1 }, '°') : null,
        h('p', { class: 'note' }, st.mask.length ? `${st.mask.length} smooth area${st.mask.length === 1 ? '' : 's'}. ` : 'Turn on a mode and click the part to mark faces that stay untextured: joints, threads, mating sides. ', st.mask.length ? h('button', { class: 'btn', onclick: () => { st.mask = []; schedule(); app.refresh(); } }, 'Clear all') : null)),
      h('fieldset', {}, h('legend', {}, 'Orientation'), h('button', { class: 'btn', style: { width: '100%' }, onclick: () => { st.maskMode = 'off'; app.view.facePick = placeOnFace; app.refresh(); app.toast('Click the face that should rest on the plate.'); } }, 'Place on face'),
        o ? xyzRot(o) : null, h('p', { class: 'note' }, 'The part is turned before texturing: the face at the bottom is the one kept flat.')),
      h('fieldset', {}, h('legend', {}, 'Settings'), h('div', { class: 'mini-btns' }, h('button', { class: 'btn', onclick: saveSettings }, 'Save settings'), h('label', { class: 'btn' }, 'Open settings', h('input', { type: 'file', accept: '.json', hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) openSettings(f); } }))),
        h('p', { class: 'note' }, 'Ctrl+Z undoes. Settings files keep the pattern, relief and projection, not the mesh.')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.keep, onchange: (e) => { st.keep = e.target.checked; } }), 'Keep the original (hidden)'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary wide', disabled: !result || busy, onclick: apply }, 'Apply texture'), h('button', { class: 'btn wide', onclick: close }, 'Cancel')),
    ];
  }
  const xyzRot = (o) => h('div', {}, ...['X', 'Y', 'Z'].map((a, i) => row(`Rotate ${a}`, numField(o.rot[i], (v) => { app.rotateTo(o, i, v); schedule(); }, { min: -360, max: 360, step: 5 }), '°')));
  app.openTexture = open; app.closeTexture = close;
  app.on('mode', () => { if (app.mode !== 'design') close(); });
  app.addAction({ label: 'Texture an STL', group: 'Tools', run: open });
}
