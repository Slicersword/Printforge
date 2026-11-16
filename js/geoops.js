// Heavy geometry jobs, written once and run either in the background worker (worker.js) or, if a browser can't start
// module workers, right here on the page (geo.js decides). Inputs and outputs are plain typed arrays so they can be
// handed between threads without copying.
import { filletEdges } from './fillet.js';

export function toMan(K, { v, t }) {
  const mesh = new K.Mesh({ numProp: 3, vertProperties: v, triVerts: t }); mesh.merge();
  return new K.Manifold(mesh);
}
export function fromMan(m) {
  const g = m.getMesh(); const np = g.numProp, vp = g.vertProperties; const n = vp.length / np;
  const v = new Float32Array(n * 3); for (let i = 0; i < n; i++) { v[i * 3] = vp[i * np]; v[i * 3 + 1] = vp[i * np + 1]; v[i * 3 + 2] = vp[i * np + 2]; }
  return { v, t: new Uint32Array(g.triVerts) };
}
const free = (m) => { try { m?.delete(); } catch { /* freed */ } };

/** op: union | intersect | subtract; meshes in world space; roles: 'A' keep / 'B' cut (subtract). */
export function booleanOp(K, { op, meshes, roles }) {
  const mans = meshes.map((m) => toMan(K, m)); let out = [];
  try {
    if (op === 'union') out = [K.Manifold.union(mans)];
    else if (op === 'intersect') out = [K.Manifold.intersection(mans)];
    else {
      const cutters = mans.filter((_, i) => roles[i] === 'B'); const tool = cutters.length > 1 ? K.Manifold.union(cutters) : cutters[0];
      out = mans.filter((_, i) => roles[i] === 'A').map((m) => (tool ? m.subtract(tool) : m.translate([0, 0, 0])));
      if (cutters.length > 1) free(tool);
    }
    const res = out.map((m) => ({ empty: m.isEmpty(), vol: m.volume(), tris: m.numTri(), parts: m.isEmpty() ? 0 : m.decompose().map((p) => (free(p), 1)).length, mesh: m.isEmpty() ? null : fromMan(m) }));
    return res;
  } finally { mans.forEach(free); out.forEach(free); }
}

export function filletOp(K, { mesh, edges, r, type }) {
  const m = toMan(K, mesh); let res = null;
  try {
    res = filletEdges(K, m, edges, r, type);
    if (res.isEmpty()) throw new Error('nothing is left');
    const parts = res.decompose(); const n = parts.length; parts.forEach(free);
    return { mesh: fromMan(res), parts: n, dv: res.volume() - m.volume() };
  } finally { free(m); if (res !== m) free(res); }
}

/**
 * Wall thickness: from points all over the surface, look straight into the part for the far side of the wall. Big
 * triangles are split into small ones first (about 1 mm, coarser on huge parts) so a face that is thick in one place
 * and thin in another is marked only where it's thin. Only walls thinner than maxD matter, so each look stays short:
 * a sparse grid of cells finds the nearby triangles fast.
 * Returns the thin bits as triangles (positions and normals in the object's own coordinates) to draw on top.
 */
export function thicknessOp({ P, T, scale = [1, 1, 1], maxD }) {
  const nT = T.length / 3; const S = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { S[i] = P[i] * scale[0]; S[i + 1] = P[i + 1] * scale[1]; S[i + 2] = P[i + 2] * scale[2]; }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < S.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], S[i + k]); hi[k] = Math.max(hi[k], S[i + k]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1; const cs = Math.max(maxD, diag / 160); // grid cell size
  const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  const cell = (v, k) => Math.floor((v - lo[k]) / cs);
  const grid = new Map(); const N = new Float32Array(nT * 3);
  for (let f = 0; f < nT; f++) {
    const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const ux = S[b] - S[a], uy = S[b + 1] - S[a + 1], uz = S[b + 2] - S[a + 2], vx = S[c] - S[a], vy = S[c + 1] - S[a + 1], vz = S[c + 2] - S[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; N[f * 3] = nx / l; N[f * 3 + 1] = ny / l; N[f * 3 + 2] = nz / l;
    const x0 = cell(Math.min(S[a], S[b], S[c]), 0), x1 = cell(Math.max(S[a], S[b], S[c]), 0), y0 = cell(Math.min(S[a + 1], S[b + 1], S[c + 1]), 1), y1 = cell(Math.max(S[a + 1], S[b + 1], S[c + 1]), 1), z0 = cell(Math.min(S[a + 2], S[b + 2], S[c + 2]), 2), z1 = cell(Math.max(S[a + 2], S[b + 2], S[c + 2]), 2);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const k = key(x, y, z); let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(f); }
  }
  const eps = 1e-4;
  const thickAt = (ox, oy, oz, f) => { // distance to the far side of the wall, looking in from a point on triangle f
    const dx = -N[f * 3], dy = -N[f * 3 + 1], dz = -N[f * 3 + 2]; const ex = ox + dx * maxD, ey = oy + dy * maxD, ez = oz + dz * maxD; let best = Infinity; const seen = new Set();
    for (let x = cell(Math.min(ox, ex), 0); x <= cell(Math.max(ox, ex), 0); x++) for (let y = cell(Math.min(oy, ey), 1); y <= cell(Math.max(oy, ey), 1); y++) for (let z = cell(Math.min(oz, ez), 2); z <= cell(Math.max(oz, ez), 2); z++) {
      const L = grid.get(key(x, y, z)); if (!L) continue;
      for (const g of L) {
        if (g === f || seen.has(g)) continue; seen.add(g);
        if (N[g * 3] * dx + N[g * 3 + 1] * dy + N[g * 3 + 2] * dz <= 0.2) continue; // only the far side of the wall (facing away from us)
        const a = T[g * 3] * 3, b = T[g * 3 + 1] * 3, c = T[g * 3 + 2] * 3; // Möller–Trumbore
        const e1x = S[b] - S[a], e1y = S[b + 1] - S[a + 1], e1z = S[b + 2] - S[a + 2], e2x = S[c] - S[a], e2y = S[c + 1] - S[a + 1], e2z = S[c + 2] - S[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x; const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det; const tx = ox - S[a], ty = oy - S[a + 1], tz = oz - S[a + 2]; const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x; const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > eps && t < best) best = t;
      }
    }
    return best;
  };
  // split each triangle into pieces no longer than `seg`, test each piece's middle, keep the thin pieces
  let seg = Math.max(0.6, diag / 250); const budget = 600000; let est = 0;
  for (let f = 0; f < nT; f++) { const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3; const e = Math.max(Math.hypot(S[b] - S[a], S[b + 1] - S[a + 1], S[b + 2] - S[a + 2]), Math.hypot(S[c] - S[b], S[c + 1] - S[b + 1], S[c + 2] - S[b + 2]), Math.hypot(S[a] - S[c], S[a + 1] - S[c + 1], S[a + 2] - S[c + 2])); const k = Math.ceil(e / seg); est += k * k; }
  if (est > budget) seg *= Math.sqrt(est / budget);
  const out = []; let area = 0;
  for (let f = 0; f < nT; f++) {
    const A = [S[T[f * 3] * 3], S[T[f * 3] * 3 + 1], S[T[f * 3] * 3 + 2]], B = [S[T[f * 3 + 1] * 3], S[T[f * 3 + 1] * 3 + 1], S[T[f * 3 + 1] * 3 + 2]], C = [S[T[f * 3 + 2] * 3], S[T[f * 3 + 2] * 3 + 1], S[T[f * 3 + 2] * 3 + 2]];
    const e = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]));
    const k = Math.max(1, Math.ceil(e / seg)); const at = (i, j) => { const u = i / k, v = j / k, w = 1 - u - v; return [A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v]; };
    const triA = 0.5 * Math.hypot(...(() => { const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; })()) / (k * k);
    const test = (p, q, r) => { const m = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3]; if (thickAt(m[0], m[1], m[2], f) < maxD) { out.push(p, q, r, f); area += triA; } };
    for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) { test(at(i, j), at(i + 1, j), at(i, j + 1)); if (i + j < k - 1) test(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)); }
  }
  const n = out.length / 4; const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) { const f = out[i * 4 + 3]; for (let k = 0; k < 3; k++) { const p = out[i * 4 + k]; for (let j = 0; j < 3; j++) { pos[i * 9 + k * 3 + j] = p[j] / (scale[j] || 1); nor[i * 9 + k * 3 + j] = N[f * 3 + j]; } } }
  return { pos, nor, tris: n, area };
}
