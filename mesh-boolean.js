// mesh-boolean.js — Bambu Studio-style mesh booleans for PrintForge, using Manifold.
// MIT. Works with manifold-3d v2/v3 and three.js r150+.
//
// Usage:
//   import Module from 'manifold-3d';           // PrintForge already loads this
//   import { meshBoolean } from './mesh-boolean.js';
//   const wasm = await Module(); wasm.setup();
//   const result = meshBoolean(wasm, meshA, meshB, 'difference');   // 'union' | 'difference' | 'intersection'
//   if (result) { scene.add(result); }                               // result.position is its bbox centre
//
// A is the object kept (its material/name carry over); B is the tool.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** three.js mesh (with its world transform baked in) -> Manifold */
export function meshToManifold(wasm, mesh) {
  mesh.updateMatrixWorld(true);
  let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  // Keep position only so shared corners merge into one vertex (Manifold needs a closed, indexed mesh).
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-4);

  // A mirrored object (negative scale) flips triangle winding; flip it back.
  const tri = new Uint32Array(g.index.array);
  if (mesh.matrixWorld.determinant() < 0) {
    for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
  }

  const m = new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.attributes.position.array),
    triVerts: tri,
  });
  m.merge();            // closes tiny gaps Manifold can fix itself
  g.dispose();
  return new wasm.Manifold(m);   // throws if the mesh is not watertight
}

/** Manifold -> three.js BufferGeometry (flat-shaded, non-indexed) */
export function manifoldToGeometry(manifold) {
  const m = manifold.getMesh();
  const n = m.numProp;
  const pos = new Float32Array((m.vertProperties.length / n) * 3);
  for (let i = 0, j = 0; i < m.vertProperties.length; i += n, j += 3) {
    pos[j] = m.vertProperties[i]; pos[j + 1] = m.vertProperties[i + 1]; pos[j + 2] = m.vertProperties[i + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Boolean of two meshes. Returns a new THREE.Mesh, or null if the result is empty.
 * The result's geometry is centred on its bounding box and placed with .position,
 * so the move/rotate/scale gizmo pivots around its middle (as in Bambu Studio).
 */
export function meshBoolean(wasm, meshA, meshB, op = 'union') {
  let a, b, r;
  try {
    a = meshToManifold(wasm, meshA);
    b = meshToManifold(wasm, meshB);
    r = op === 'union' ? a.add(b)
      : op === 'difference' ? a.subtract(b)
      : op === 'intersection' ? a.intersect(b)
      : null;
    if (!r) throw new Error(`Unknown boolean operation: ${op}`);
    if (r.isEmpty()) return null;

    const g = manifoldToGeometry(r);
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);

    const out = new THREE.Mesh(g, Array.isArray(meshA.material) ? meshA.material[0].clone() : meshA.material.clone());
    out.position.copy(c);
    out.name = `${meshA.name || 'A'} ${{ union: '+', difference: '−', intersection: '∩' }[op]} ${meshB.name || 'B'}`;
    return out;
  } finally {
    // Manifold objects live in WASM memory and must be freed by hand.
    a?.delete(); b?.delete(); r?.delete();
  }
}
