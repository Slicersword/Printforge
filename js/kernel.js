// Geometry kernel: wraps the Manifold WASM CSG library (Apache-2.0, vendored in /vendor).
// Every object in a document turns into a Manifold centred on its own origin; the object's
// transform places it in the world. Results are cached by a geometry key so editing a
// position never rebuilds geometry.
import Module from '../vendor/manifold.js';
import { trs } from './math.js';
import { rebuildSolid } from './repair.js';
let onRepair = null;
export function setRepairHandler(f) { onRepair = f; }

export let K = null; // { Manifold, CrossSection, Mesh }
const builders = new Map(); // kind -> { build(params, ctx) => Manifold, label }

export async function initKernel() {
  const wasm = await Module({ locateFile: (f) => new URL(`../vendor/${f}`, import.meta.url).href });
  wasm.setup();
  K = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, Mesh: wasm.Mesh, wasm };
  return K;
}

export function registerKind(kind, def) { builders.set(kind, def); }
export function kindDef(kind) { return builders.get(kind); }
export function allKinds() { return [...builders.entries()]; }

/** Manifold.transform takes a column-major 4x4 as a plain array. */
export function toMat43(m) { return Array.from(m); }

export function centred(man) {
  if (man.isEmpty()) return man;
  const b = man.boundingBox();
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  if (Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]) < 1e-9) return man;
  return man.translate([-c[0], -c[1], -c[2]]);
}

// ---------------------------------------------------------------- cache
// Manifolds live in WASM memory and must be freed; keep a bounded LRU.
const cache = new Map(); // key -> { man, render }
const CACHE_MAX = 400;
function cacheGet(key) { const e = cache.get(key); if (e) { cache.delete(key); cache.set(key, e); } return e; }
function cacheSet(key, e) {
  cache.set(key, e);
  while (cache.size > CACHE_MAX) {
    const [k, old] = cache.entries().next().value; cache.delete(k);
    // A manifold might still be referenced by a just-built parent's operation; deleting after union is safe.
    try { old.man.delete(); } catch { /* ignore */ }
  }
}

const keyMemo = new WeakMap();
export function geomKey(obj, doc) {
  let k;
  if (obj.type === 'group') {
    k = 'G[' + obj.children.map((c) => `${geomKey(c, doc)}@${c.pos.join(',')}|${c.rot.join(',')}|${c.scale.join(',')}|${c.hole ? 1 : 0}|${c.visible === false ? 0 : 1}`).join(';') + ']';
  } else if (obj.type === 'mesh') {
    k = 'M:' + obj.meshId;
  } else {
    k = keyMemo.get(obj.params);
    if (!k) { k = obj.kind + ':' + JSON.stringify(obj.params); keyMemo.set(obj.params, k); }
    else if (!k.startsWith(obj.kind + ':')) k = obj.kind + ':' + JSON.stringify(obj.params);
  }
  return k;
}

let meshStore = null; // set by scene: id -> {v: Float32Array, t: Uint32Array}
export function setMeshStore(store) { meshStore = store; }

/** Build (or fetch) the centred local Manifold for an object. Throws on invalid geometry. */
export function localGeometry(obj) {
  const key = geomKey(obj);
  const hit = cacheGet(key);
  if (hit) return hit;
  let man;
  if (obj.type === 'group') man = buildGroup(obj);
  else if (obj.type === 'mesh') {
    const data = meshStore.get(obj.meshId);
    try { man = manifoldFromMesh(data); }
    catch (e) {
      // Leaky mesh (common from AI generators and scans): rebuild it as a watertight solid once, and keep the result.
      man = rebuildSolid(K, data);
      const m = man.getMesh(); const np = m.numProp; const vv = new Float32Array(m.vertProperties.length / np * 3);
      for (let i = 0, j = 0; i < m.vertProperties.length; i += np, j += 3) { vv[j] = m.vertProperties[i]; vv[j + 1] = m.vertProperties[i + 1]; vv[j + 2] = m.vertProperties[i + 2]; }
      meshStore.set(obj.meshId, { v: vv, t: new Uint32Array(m.triVerts), repaired: true });
      onRepair?.(obj, e);
    }
  }
  else {
    const def = builders.get(obj.kind);
    if (!def) throw new Error(`Unknown shape “${obj.kind}”`);
    man = def.build(obj.params, K);
  }
  if (!man || man.isEmpty()) throw new Error('This shape came out empty. Check its sizes.');
  if (obj.type !== 'group') man = centred(man);
  const entry = { man, render: null, key };
  cacheSet(key, entry);
  return entry;
}

function buildGroup(g) {
  const solids = [], holes = [];
  for (const c of g.children) {
    if (c.visible === false) continue;
    const loc = localGeometry(c).man;
    const placed = loc.transform(toMat43(trs(c.pos, c.rot, c.scale)));
    (c.hole ? holes : solids).push(placed);
  }
  if (!solids.length) throw new Error('A group needs at least one solid.');
  let out = solids.length === 1 ? solids[0] : K.Manifold.union(solids);
  if (solids.length > 1) solids.forEach(free);
  if (holes.length) {
    const cut = holes.length === 1 ? holes[0] : K.Manifold.union(holes);
    const res = out.subtract(cut);
    free(out); free(cut); if (holes.length > 1) holes.forEach(free);
    out = res;
  }
  return out;
}

export function free(m) { try { m && m.delete(); } catch { /* already freed */ } }

export function worldManifold(obj) {
  return localGeometry(obj).man.transform(toMat43(trs(obj.pos, obj.rot, obj.scale)));
}

export function manifoldFromMesh(data) {
  const mesh = new K.Mesh({ numProp: 3, vertProperties: data.v, triVerts: data.t });
  mesh.merge();
  const man = new K.Manifold(mesh);
  const st = man.status && man.status();
  if (man.isEmpty()) throw new Error(`The mesh is not watertight (${st}). Repair it in your slicer or mesh tool and import again.`);
  return man;
}

// ---------------------------------------------------------------- render data
const CREASE = Math.cos(32 * Math.PI / 180);
const EDGE = Math.cos(28 * Math.PI / 180);

export function renderData(entry) {
  if (entry.render) return entry.render;
  const m = entry.man.getMesh();
  const np = m.numProp, vp = m.vertProperties, tv = m.triVerts;
  const nV = vp.length / np, nT = tv.length / 3;
  const P = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) { P[i * 3] = vp[i * np]; P[i * 3 + 1] = vp[i * np + 1]; P[i * 3 + 2] = vp[i * np + 2]; }
  const T = new Uint32Array(tv);
  const FN = new Float32Array(nT * 3), FA = new Float32Array(nT);
  for (let f = 0; f < nT; f++) {
    const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; FA[f] = l / 2;
    FN[f * 3] = nx / l; FN[f * 3 + 1] = ny / l; FN[f * 3 + 2] = nz / l;
  }
  // vertex -> faces
  const cnt = new Uint32Array(nV + 1);
  for (let i = 0; i < T.length; i++) cnt[T[i] + 1]++;
  for (let i = 0; i < nV; i++) cnt[i + 1] += cnt[i];
  const fill = cnt.slice(0, nV), adj = new Uint32Array(T.length);
  for (let f = 0; f < nT; f++) for (let k = 0; k < 3; k++) adj[fill[T[f * 3 + k]]++] = f;
  const pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9);
  for (let f = 0; f < nT; f++) {
    const fx = FN[f * 3], fy = FN[f * 3 + 1], fz = FN[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = T[f * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      for (let j = cnt[v]; j < cnt[v + 1]; j++) {
        const g = adj[j];
        const gx = FN[g * 3], gy = FN[g * 3 + 1], gz = FN[g * 3 + 2];
        if (gx * fx + gy * fy + gz * fz >= CREASE) { sx += gx * FA[g]; sy += gy * FA[g]; sz += gz * FA[g]; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      const o = f * 9 + k * 3;
      pos[o] = P[v * 3]; pos[o + 1] = P[v * 3 + 1]; pos[o + 2] = P[v * 3 + 2];
      nor[o] = sx / l; nor[o + 1] = sy / l; nor[o + 2] = sz / l;
    }
  }
  // feature edges
  const edgeMap = new Map(); const lines = [];
  for (let f = 0; f < nT; f++) for (let k = 0; k < 3; k++) {
    const a = T[f * 3 + k], b = T[f * 3 + (k + 1) % 3];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const other = edgeMap.get(key);
    if (other === undefined) edgeMap.set(key, f);
    else {
      edgeMap.delete(key);
      const d = FN[f * 3] * FN[other * 3] + FN[f * 3 + 1] * FN[other * 3 + 1] + FN[f * 3 + 2] * FN[other * 3 + 2];
      if (d < EDGE) lines.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    }
  }
  const bb = entry.man.boundingBox();
  entry.render = { pos, nor, edges: new Float32Array(lines), P, T, FN, nT, bbox: { min: bb.min, max: bb.max } };
  return entry.render;
}

export function stats(man) {
  return { volume: man.volume(), area: man.surfaceArea(), tris: man.numTri(), genus: man.genus() };
}
