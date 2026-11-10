// Make a watertight solid from a leaky or messy triangle mesh (typical of AI-generated models).
// Voxelises the mesh with rays along X, Y and Z (majority vote, so a few holes don't matter),
// then rebuilds a clean surface with Manifold's level-set mesher.

/** Occupancy grid via ray parity along one axis. Returns Uint8Array of 0/1 (n0*n1*n2, x fastest). */
function parityAxis(v, t, lo, step, n, axis) {
  const [a, b] = axis === 2 ? [0, 1] : axis === 1 ? [0, 2] : [1, 2]; // ray runs along `axis`, columns over (a, b)
  const na = n[a], nb = n[b], nc = n[axis];
  const occ = new Uint8Array(n[0] * n[1] * n[2]);
  // bin triangles by column cells
  const bins = new Array(na * nb);
  const tri = t.length / 3;
  for (let f = 0; f < tri; f++) {
    const i0 = t[f * 3] * 3, i1 = t[f * 3 + 1] * 3, i2 = t[f * 3 + 2] * 3;
    const amin = Math.min(v[i0 + a], v[i1 + a], v[i2 + a]), amax = Math.max(v[i0 + a], v[i1 + a], v[i2 + a]);
    const bmin = Math.min(v[i0 + b], v[i1 + b], v[i2 + b]), bmax = Math.max(v[i0 + b], v[i1 + b], v[i2 + b]);
    const ca0 = Math.max(0, Math.ceil((amin - lo[a]) / step[a] - 0.5)), ca1 = Math.min(na - 1, Math.floor((amax - lo[a]) / step[a] - 0.5));
    const cb0 = Math.max(0, Math.ceil((bmin - lo[b]) / step[b] - 0.5)), cb1 = Math.min(nb - 1, Math.floor((bmax - lo[b]) / step[b] - 0.5));
    for (let ca = ca0; ca <= ca1; ca++) for (let cb = cb0; cb <= cb1; cb++) { const k = cb * na + ca; (bins[k] ||= []).push(f); }
  }
  const hits = [];
  for (let cb = 0; cb < nb; cb++) for (let ca = 0; ca < na; ca++) {
    const list = bins[cb * na + ca]; if (!list) continue;
    // tiny jitter avoids rays passing exactly through vertices or edges
    const pa = lo[a] + (ca + 0.5) * step[a] + step[a] * 1.3e-4, pb = lo[b] + (cb + 0.5) * step[b] + step[b] * 0.7e-4;
    hits.length = 0;
    for (const f of list) {
      const i0 = t[f * 3] * 3, i1 = t[f * 3 + 1] * 3, i2 = t[f * 3 + 2] * 3;
      const ax = v[i0 + a], ay = v[i0 + b], bx = v[i1 + a], by = v[i1 + b], cx = v[i2 + a], cy = v[i2 + b];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-12) continue;
      const w0 = ((by - cy) * (pa - cx) + (cx - bx) * (pb - cy)) / d, w1 = ((cy - ay) * (pa - cx) + (ax - cx) * (pb - cy)) / d, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      hits.push(w0 * v[i0 + axis] + w1 * v[i1 + axis] + w2 * v[i2 + axis]);
    }
    if (hits.length < 2) continue;
    hits.sort((p, q) => p - q);
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const c0 = Math.max(0, Math.ceil((hits[h] - lo[axis]) / step[axis] - 0.5)), c1 = Math.min(nc - 1, Math.floor((hits[h + 1] - lo[axis]) / step[axis] - 0.5));
      for (let c = c0; c <= c1; c++) {
        const idx = [0, 0, 0]; idx[a] = ca; idx[b] = cb; idx[axis] = c;
        occ[(idx[2] * n[1] + idx[1]) * n[0] + idx[0]] = 1;
      }
    }
  }
  return occ;
}

/** Returns a watertight Manifold rebuilt from mesh {v, t}. `res` = cells along the longest side. */
export function rebuildSolid(K, mesh, res = 110) {
  const { v, t } = mesh;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]); }
  const size = hi.map((x, i) => x - lo[i]); const cell = Math.max(...size) / res;
  if (!(cell > 0)) throw new Error('The mesh is empty.');
  // one empty cell of padding on every side
  const pad = cell * 1.5; const L = lo.map((x) => x - pad); const n = size.map((s) => Math.max(2, Math.ceil((s + 2 * pad) / cell))); const step = [cell, cell, cell];
  const ox = parityAxis(v, t, L, step, n, 0), oy = parityAxis(v, t, L, step, n, 1), oz = parityAxis(v, t, L, step, n, 2);
  const occ = new Float32Array(ox.length); let any = 0;
  for (let i = 0; i < occ.length; i++) { const s = ox[i] + oy[i] + oz[i]; occ[i] = s >= 2 ? 1 : 0; any += occ[i]; }
  if (!any) throw new Error('Could not find the inside of this mesh, so it can’t be repaired automatically.');
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2] ? 0 : occ[(k * n[1] + j) * n[0] + i]);
  // trilinear occupancy - 0.5 → positive inside
  const sdf = (p) => {
    const x = (p[0] ?? p.x), y = (p[1] ?? p.y), z = (p[2] ?? p.z);
    const fx = (x - L[0]) / cell - 0.5, fy = (y - L[1]) / cell - 0.5, fz = (z - L[2]) / cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz); const u = fx - i, w = fy - j, s = fz - k;
    const c00 = at(i, j, k) * (1 - u) + at(i + 1, j, k) * u, c10 = at(i, j + 1, k) * (1 - u) + at(i + 1, j + 1, k) * u;
    const c01 = at(i, j, k + 1) * (1 - u) + at(i + 1, j, k + 1) * u, c11 = at(i, j + 1, k + 1) * (1 - u) + at(i + 1, j + 1, k + 1) * u;
    return ((c00 * (1 - w) + c10 * w) * (1 - s) + (c01 * (1 - w) + c11 * w) * s - 0.5) * cell;
  };
  const man = K.Manifold.levelSet(sdf, { min: L, max: L.map((x, i) => x + n[i] * cell) }, cell);
  if (man.isEmpty()) throw new Error('The repaired model came out empty.');
  return man;
}
