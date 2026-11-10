// Small linear-algebra helpers. Matrices are column-major Float32/Float64 arrays of 16 (WebGL convention).
export const deg = Math.PI / 180;

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

export function identity() { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function translation(x, y, z) { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
export function scaling(x, y, z) { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; }
export function rotX(a) { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
export function rotY(a) { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
export function rotZ(a) { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }

/** Rotation applied X first, then Y, then Z (same order as Manifold.rotate). Degrees. */
export function eulerMatrix(r) { return mul(rotZ(r[2] * deg), mul(rotY(r[1] * deg), rotX(r[0] * deg))); }

/** World matrix of an object: T(pos) * R(rot) * S(scale). Geometry is centred on its own origin. */
export function trs(pos, rot, scl) { return mul(translation(pos[0], pos[1], pos[2]), mul(eulerMatrix(rot), scaling(scl[0], scl[1], scl[2]))); }

export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
export function transformDir(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

export function invert(m) {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-14) return identity();
  det = 1 / det; for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

/** Decompose an affine matrix (no shear assumed) into pos, euler XYZ degrees and scale. Returns null when sheared. */
export function decompose(m) {
  const pos = [m[12], m[13], m[14]];
  let c0 = [m[0], m[1], m[2]], c1 = [m[4], m[5], m[6]], c2 = [m[8], m[9], m[10]];
  let sx = v3.len(c0), sy = v3.len(c1), sz = v3.len(c2);
  if (v3.dot(v3.cross(c0, c1), c2) < 0) sx = -sx;
  c0 = v3.scale(c0, 1 / sx); c1 = v3.scale(c1, 1 / sy); c2 = v3.scale(c2, 1 / sz);
  const shear = Math.abs(v3.dot(c0, c1)) + Math.abs(v3.dot(c0, c2)) + Math.abs(v3.dot(c1, c2));
  if (shear > 1e-4) return null;
  // R = Rz*Ry*Rx ; R[col][row]
  const r20 = c0[2];
  let rx, ry, rz;
  ry = Math.asin(Math.max(-1, Math.min(1, -r20)));
  if (Math.abs(r20) < 0.99999) { rx = Math.atan2(c1[2], c2[2]); rz = Math.atan2(c0[1], c0[0]); }
  else { rx = Math.atan2(-c2[1], c1[1]); rz = 0; }
  const clean = (a) => { const d = a / deg; const r = Math.round(d * 1e4) / 1e4; return Object.is(r, -0) ? 0 : r; };
  return { pos, rot: [clean(rx), clean(ry), clean(rz)], scale: [sx, sy, sz] };
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float64Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf; return m;
}
export function ortho(l, r, b, t, n, f) {
  const m = identity(); m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); return m;
}
export function lookAt(eye, target, up) {
  const z = v3.norm(v3.sub(eye, target)); let x = v3.cross(up, z);
  if (v3.len(x) < 1e-9) x = v3.cross([0, 1, 0], z);
  x = v3.norm(x); const y = v3.cross(z, x); const m = identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -v3.dot(x, eye); m[13] = -v3.dot(y, eye); m[14] = -v3.dot(z, eye); return m;
}

/** Möller–Trumbore. Returns t or -1. */
export function rayTri(o, d, a, b, c) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-6 ? t : -1;
}

export function rayAabb(o, d, min, max) {
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < min[i] || o[i] > max[i]) return false; continue; }
    let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return t1 > 0;
}

/** Euler XYZ (degrees, same order as eulerMatrix) from a pure rotation matrix. */
export function eulerFromMatrix(m) {
  const r20 = m[2]; const ry = Math.asin(Math.max(-1, Math.min(1, -r20))); let rx, rz;
  if (Math.abs(r20) < 0.99999) { rx = Math.atan2(m[6], m[10]); rz = Math.atan2(m[1], m[0]); } else { rx = Math.atan2(-m[9], m[5]); rz = 0; }
  const c = (a) => { const d = Math.round(a * 180 / Math.PI * 1e4) / 1e4; return Object.is(d, -0) ? 0 : d; };
  return [c(rx), c(ry), c(rz)];
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const round = (x, step = 0.01) => Math.round(x / step) * step;
export function fmt(x, d = 2) { const r = Number(x.toFixed(d)); return Object.is(r, -0) ? '0' : String(r); }
