// Background geometry worker: booleans, fillets and wall-thickness checks run here so the page never freezes.
// It loads its own copy of the geometry engine on the first job that needs it.
import Module from '../vendor/manifold.js';
import { booleanOp, filletOp, thicknessOp } from './geoops.js';

let K = null;
async function kernel() {
  if (K) return K;
  const wasm = await Module({ locateFile: (f) => new URL(`../vendor/${f}`, import.meta.url).href });
  wasm.setup(); K = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, Mesh: wasm.Mesh };
  return K;
}
const transfers = (o, out = []) => { if (!o || typeof o !== 'object') return out; if (ArrayBuffer.isView(o)) { out.push(o.buffer); return out; } for (const v of Object.values(o)) transfers(v, out); return out; };

self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  try {
    let result;
    if (op === 'thickness') result = thicknessOp(payload);
    else if (op === 'boolean') result = booleanOp(await kernel(), payload);
    else if (op === 'fillet') result = filletOp(await kernel(), payload);
    else if (op === 'ping') result = { ok: true };
    else throw new Error(`unknown job ${op}`);
    self.postMessage({ id, result }, [...new Set(transfers(result))]);
  } catch (err) { self.postMessage({ id, error: err?.message || String(err) }); }
};
