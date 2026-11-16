// Edge fillets and chamfers on any solid (Manifold has no fillet operation, so we make one).
// 1. Find the sharp edges of the mesh and join them into edges a person would recognise: straight runs, arcs and
//    full circles (a cylinder rim or a hole), split wherever the edge turns a corner.
// 2. For each chosen edge, build a strip whose cross-section is the sliver between the corner and the rounding arc
//    (or the chamfer line): extruded along straight edges, revolved around round ones.
// 3. Outside (convex) edges: cut the strips away. Inside (concave) corners: add them, which fills the corner.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const SHARP = Math.cos(25 * Math.PI / 180); // faces meeting at more than 25° make an edge
const TURN = Math.cos(25 * Math.PI / 180);  // an edge that turns more than 25° becomes two edges

/** Sharp edges of a Manifold (in its own coordinates), joined into lines, arcs and circles. */
export function findEdges(man) {
  const m = man.getMesh(); const np = m.numProp, vp = m.vertProperties, tv = m.triVerts;
  // weld vertices that share a position (property splits duplicate them)
  const key = new Map(), P = [], remap = new Int32Array(vp.length / np);
  for (let i = 0; i < remap.length; i++) {
    const x = vp[i * np], y = vp[i * np + 1], z = vp[i * np + 2]; const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = key.get(k); if (j === undefined) { j = P.length; P.push([x, y, z]); key.set(k, j); } remap[i] = j;
  }
  const nT = tv.length / 3, TN = [], TC = [];
  for (let t = 0; t < nT; t++) {
    const a = P[remap[tv[t * 3]]], b = P[remap[tv[t * 3 + 1]]], c = P[remap[tv[t * 3 + 2]]];
    TN.push(norm(cross(sub(b, a), sub(c, a)))); TC.push(mul(add(add(a, b), c), 1 / 3));
  }
  const em = new Map(); // "i,j" -> [tri, tri]
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const i = remap[tv[t * 3 + k]], j = remap[tv[t * 3 + (k + 1) % 3]]; if (i === j) continue;
    const ek = i < j ? `${i},${j}` : `${j},${i}`; (em.get(ek) || em.set(ek, []).get(ek)).push(t);
  }
  const segs = []; // { i, j, t1, t2 }
  for (const [ek, ts] of em) {
    if (ts.length !== 2) continue; if (dot(TN[ts[0]], TN[ts[1]]) > SHARP) continue;
    const [i, j] = ek.split(',').map(Number); segs.push({ i, j, t1: ts[0], t2: ts[1] });
  }
  // walk the sharp edges into chains, stopping where three or more meet
  const at = new Map(); segs.forEach((s, n) => { for (const v of [s.i, s.j]) (at.get(v) || at.set(v, []).get(v)).push(n); });
  const used = new Uint8Array(segs.length), chains = [];
  const walk = (start, sIdx) => { const vs = [start], ss = []; let v = start, s = sIdx;
    for (;;) { used[s] = 1; ss.push(s); const nv = segs[s].i === v ? segs[s].j : segs[s].i; vs.push(nv); v = nv;
      const nx = (at.get(v) || []).filter((q) => !used[q]); if (at.get(v).length !== 2 || !nx.length) break; s = nx[0]; }
    return { vs, ss, closed: vs[0] === vs[vs.length - 1] && vs.length > 2 }; };
  for (const [v, list] of at) if (list.length !== 2) for (const s of list) if (!used[s]) chains.push(walk(v, s));
  for (let s = 0; s < segs.length; s++) if (!used[s]) chains.push(walk(segs[s].i, s));
  // split at corners, then classify each piece
  const out = [];
  let chainNo = 0;
  for (const ch of chains) {
    const first = out.length;
    try { split(ch); } finally { for (let i = first; i < out.length; i++) out[i].chain = chainNo; chainNo++; }
  }
  function split(ch) {
    const pts = ch.vs.map((i) => P[i]); const n = ch.ss.length; const dir = (k) => norm(sub(pts[k + 1], pts[k]));
    const cuts = [];
    for (let k = 1; k < n; k++) if (dot(dir(k - 1), dir(k)) < TURN) cuts.push(k);
    let closed = ch.closed;
    if (closed && dot(dir(n - 1), dir(0)) < TURN) { cuts.unshift(0); closed = false; } // the loop has a corner where it starts
    else if (closed && cuts.length) { // rotate the loop so it starts at a corner
      const r = cuts[0]; const vs = [...ch.vs.slice(r, -1), ...ch.vs.slice(0, r + 1)], ss = [...ch.ss.slice(r), ...ch.ss.slice(0, r)];
      const c2 = cuts.map((k) => k - r); out.push(...pieces(vs, ss, [0, ...c2.slice(1)])); return;
    }
    if (closed) { out.push(...smooth(ch.vs, ch.ss, true)); return; }
    out.push(...pieces(ch.vs, ch.ss, [0, ...cuts.filter((k) => k > 0)]));
  }
  function pieces(vs, ss, starts) {
    const res = []; const bounds = [...new Set([...starts, ss.length])].sort((a, b) => a - b);
    for (let b = 0; b + 1 < bounds.length; b++) { const s0 = bounds[b], s1 = bounds[b + 1]; if (s1 > s0) res.push(...smooth(vs.slice(s0, s1 + 1), ss.slice(s0, s1), false)); }
    return res;
  }
  // A corner-free edge that isn't one line or one circle (a rounded rectangle's outline): split it into its straight
  // and curved stretches. They stay one "chain", so a click can select the whole tangent outline.
  function smooth(vs, ss, closed) {
    const whole = classify(vs, ss, closed); if (whole.kind !== 'poly') return [whole];
    const pts = vs.map((i) => P[i]); const n = ss.length; const dir = (k) => norm(sub(pts[(k + 1) % pts.length], pts[k % pts.length]));
    const bent = (k) => dot(dir((k - 1 + n) % n), dir(k)) < Math.cos(0.4 * Math.PI / 180); // vertex k: does the edge bend here?
    // straight: much longer than a typical facet, or running on in line with a neighbour
    const sl = (k) => len(sub(pts[(k + 1) % pts.length], pts[k % pts.length]));
    const lens = Array.from({ length: n }, (_, k) => sl(k)).sort((a, b) => a - b); const med = lens[Math.floor(n / 2)];
    const straightSeg = (k) => sl(k) > 2.5 * med || (k > 0 || closed ? !bent(k) : false) || (k < n - 1 || closed ? !bent((k + 1) % n) : false);
    const kindOf = (k) => (n > 1 && straightSeg(k) ? 'S' : 'C');
    let start = 0;
    if (closed) { for (let k = 0; k < n; k++) if (kindOf(k) !== kindOf((k - 1 + n) % n)) { start = k; break; } }
    const order = Array.from({ length: n }, (_, i) => (start + i) % n); const res = []; let run = [order[0]];
    const flush = () => { const k0 = run[0]; const vv = [...run.map((k) => vs[k]), vs[(run[run.length - 1] + 1) % (closed ? n : vs.length)]]; const piece = classify(vv, run.map((k) => ss[k]), false); res.push(piece); };
    for (let i = 1; i < n; i++) { const k = order[i]; if (kindOf(k) === kindOf(run[run.length - 1])) run.push(k); else { flush(); run = [k]; } }
    flush();
    return res;
  }
  function side(sIdx) { const s = segs[sIdx]; return { a: P[s.i], b: P[s.j], n1: TN[s.t1], n2: TN[s.t2], c1: TC[s.t1], c2: TC[s.t2] }; }
  function classify(vs, ss, closed) {
    const pts = vs.map((i) => P[i]); const A = pts[0], B = pts[pts.length - 1]; const L = len(sub(B, A));
    const mid = side(ss[Math.floor(ss.length / 2)]);
    const base = { pts, closed, faces: mid, segs: ss.map(side) };
    if (!closed) { // straight?
      const e = norm(sub(B, A)); let dev = 0; for (const p of pts) { const q = sub(p, A); dev = Math.max(dev, len(sub(q, mul(e, dot(q, e))))); }
      if (dev < 1e-3 + L * 1e-4) return { ...base, kind: 'line', a: A, b: B };
    }
    if (pts.length >= 4) { // arc or circle through three spread-out points
      const p1 = pts[0], p2 = pts[Math.floor((pts.length - (closed ? 1 : 0)) / 3)], p3 = pts[Math.floor(2 * (pts.length - (closed ? 1 : 0)) / 3)];
      const c = circle3(p1, p2, p3);
      if (c) {
        const tol = Math.max(0.02, c.r * 0.02); let ok = true;
        for (const p of pts) { const q = sub(p, c.c); if (Math.abs(len(sub(q, mul(c.n, dot(q, c.n)))) - c.r) > tol || Math.abs(dot(q, c.n)) > tol) { ok = false; break; } }
        if (ok) return { ...base, kind: closed ? 'circle' : 'arc', center: c.c, axis: c.n, radius: c.r };
      }
    }
    return { ...base, kind: 'poly' };
  }
  out.forEach((f, i) => { f.id = i; f.length = f.pts.slice(1).reduce((t, p, k) => t + len(sub(p, f.pts[k])), 0); });
  return out;
}
function circle3(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a); const n = cross(ab, ac); const nn = dot(n, n); if (nn < 1e-12) return null;
  const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
  const cc = add(a, mul(t, 1 / (2 * nn))); return { c: cc, n: norm(n), r: len(sub(a, cc)) };
}

/** In-face directions at an edge (pointing away from it, into each face) and whether it's an outside edge. */
function faceDirs(f, e) {
  const mid = mul(add(f.a, f.b), 0.5);
  let d1 = norm(cross(f.n1, e)); if (dot(sub(f.c1, mid), d1) < 0) d1 = mul(d1, -1);
  let d2 = norm(cross(f.n2, e)); if (dot(sub(f.c2, mid), d2) < 0) d2 = mul(d2, -1);
  return { d1, d2, convex: dot(f.n1, d2) < 0 };
}
/** 2D cross-section: the sliver between a corner at C and the rounding (or chamfer), with a little overlap. */
function profile(C, D1, D2, r, type) {
  const cs = D1[0] * D2[0] + D1[1] * D2[1]; const th = Math.acos(Math.max(-1, Math.min(1, cs)));
  if (th < 0.09 || th > Math.PI - 0.03) return null; // nearly flat or folded: nothing to round
  const n2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const o1 = n2([-(D2[0] - cs * D1[0]), -(D2[1] - cs * D1[1])]), o2 = n2([-(D1[0] - cs * D2[0]), -(D1[1] - cs * D2[1])]);
  const eps = Math.max(0.02, r * 0.03);
  const P = (v) => [C[0] + v[0], C[1] + v[1]];
  const k = type === 'chamfer' ? r : r / Math.tan(th / 2);
  const t1 = [D1[0] * k, D1[1] * k], t2 = [D2[0] * k, D2[1] * k];
  const pts = [P([(o1[0] + o2[0]) * eps, (o1[1] + o2[1]) * eps]), P([t1[0] + o1[0] * eps, t1[1] + o1[1] * eps]), P(t1)];
  if (type !== 'chamfer') {
    const bis = n2([D1[0] + D2[0], D1[1] + D2[1]]); const q = r / Math.sin(th / 2); const Q = [bis[0] * q, bis[1] * q];
    const a1 = Math.atan2(t1[1] - Q[1], t1[0] - Q[0]), a2 = Math.atan2(t2[1] - Q[1], t2[0] - Q[0]);
    let dl = a2 - a1; while (dl > Math.PI) dl -= 2 * Math.PI; while (dl <= -Math.PI) dl += 2 * Math.PI;
    const am = a1 + dl / 2, toward = Math.atan2(-bis[1], -bis[0]); // the arc must bulge toward the corner
    if (Math.cos(am - toward) < 0) dl = dl > 0 ? dl - 2 * Math.PI : dl + 2 * Math.PI;
    const n = Math.max(6, Math.ceil(Math.abs(dl) / (2 * Math.PI) * 72));
    for (let i = 1; i < n; i++) { const a = a1 + dl * i / n; pts.push(P([Q[0] + Math.cos(a) * r, Q[1] + Math.sin(a) * r])); }
  }
  pts.push(P(t2), P([t2[0] + o2[0] * eps, t2[1] + o2[1] * eps]));
  let A = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; A += x1 * y2 - x2 * y1; }
  return A < 0 ? pts.reverse() : pts;
}
const frame = (x, y, z, o) => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];

function lineStrip(K, a, b, f, r, type) {
  const e = norm(sub(b, a)); const L = len(sub(b, a)); if (L < 1e-6) return null;
  const { d1, d2, convex } = faceDirs({ ...f, a, b }, e);
  const u = d1; const w = norm(sub(d2, mul(u, dot(d2, u))));
  const pr = profile([0, 0], [1, 0], [dot(d2, u), dot(d2, w)], r, type); if (!pr) return null;
  let z = cross(u, w), o = a; if (dot(z, e) < 0) o = b; // keep the frame right-handed: extrude from whichever end
  const ext = 0.01;
  const m = K.CrossSection.ofPolygons([pr]).extrude(L + 2 * ext).translate([0, 0, -ext]).transform(frame(u, w, z, o));
  return { man: m, add: !convex };
}
function roundStrip(K, f, r, type) {
  let a = f.axis; const c = f.center; const pts = f.pts;
  const e1 = norm(sub(sub(pts[0], c), mul(a, dot(sub(pts[0], c), a))));
  let y = cross(a, e1);
  if (dot(sub(pts[1], c), y) < 0) { a = mul(a, -1); y = cross(a, e1); } // go round the same way as the edge
  // sweep and facet count
  const ang = (p) => { const q = sub(p, c); return Math.atan2(dot(q, y), dot(q, e1)); };
  let sweep = 360; const nSeg = pts.length - 1;
  if (!f.closed) { let s = 0; for (let k = 1; k < pts.length; k++) { let d = ang(pts[k]) - ang(pts[k - 1]); while (d < -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI; s += d; } sweep = s * 180 / Math.PI; }
  const segs = f.closed ? nSeg : Math.max(8, Math.round(nSeg * 360 / Math.max(1, sweep)));
  // the cross-section at the first point, in (distance from the axis, height along the axis)
  const s0 = f.segs[0]; const tng = norm(sub(pts[1], pts[0]));
  const { d1, d2, convex } = faceDirs({ ...s0, a: pts[0], b: pts[1] }, tng);
  const rho = e1; const to2 = (d) => { const v = [dot(d, rho), dot(d, a)]; const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const p0 = sub(pts[0], c); const C = [dot(p0, rho), dot(p0, a)];
  const pr = profile(C, to2(d1), to2(d2), r, type); if (!pr) return null;
  if (pr.some((p) => p[0] < 0)) throw new Error(`A ${fmtR(r)} mm rounding is too big for a ${fmtR(f.radius * 2)} mm round edge.`);
  const ext = f.closed ? 0 : 0.3;
  let m = K.CrossSection.ofPolygons([pr]).revolve(segs, f.closed ? 360 : sweep + 2 * ext);
  if (!f.closed) m = m.rotate([0, 0, -ext]);
  return { man: m.transform(frame(e1, y, a, c)), add: !convex };
}
const fmtR = (v) => String(Math.round(v * 100) / 100);

/** Strips for one edge (several for a free-form polyline). */
export function edgeStrips(K, f, r, type) {
  if (f.kind === 'line') return [lineStrip(K, f.a, f.b, f.faces, r, type)].filter(Boolean);
  if (f.kind === 'circle' || f.kind === 'arc') return [roundStrip(K, f, r, type)].filter(Boolean);
  return f.segs.map((s) => lineStrip(K, s.a, s.b, s, r, type)).filter(Boolean);
}
/** Round (or chamfer) the given edges of a solid. Returns a new Manifold; the input is not changed. */
export function filletEdges(K, man, edges, r, type = 'fillet') {
  const cut = [], fill = [];
  for (const f of edges) for (const s of edgeStrips(K, f, r, type)) (s.add ? fill : cut).push(s.man);
  let out = man;
  if (cut.length) { const u = K.Manifold.union(cut); out = out.subtract(u); }
  if (fill.length) { const u = K.Manifold.union(fill); out = out.add(u); }
  return out;
}
/** Human label for an edge. */
export function edgeLabel(f) {
  const r1 = (v) => Math.round(v * 10) / 10;
  if (f.kind === 'circle') return `Round edge, Ø${r1(f.radius * 2)} mm`;
  if (f.kind === 'arc') return `Curved edge, R${r1(f.radius)} mm`;
  if (f.kind === 'line') return `Straight edge, ${r1(f.length)} mm`;
  return `Edge, ${r1(f.length)} mm`;
}
