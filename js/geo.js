// Runs heavy geometry jobs in the background worker (worker.js). If a browser can't start module workers, or the
// worker fails to start, the same code (geoops.js) runs on the page instead, so results are identical either way.
import { K } from './kernel.js';
import { booleanOp, filletOp, thicknessOp } from './geoops.js';

let worker = null, failed = false, seq = 0; const waiting = new Map();
function start() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.result); };
    worker.onerror = (e) => { e.preventDefault?.(); failed = true; worker?.terminate(); worker = null; for (const [, w] of waiting) w.fallback(); waiting.clear(); };
  } catch { failed = true; worker = null; }
  return worker;
}
const local = (op, payload) => {
  if (op === 'thickness') return thicknessOp(payload);
  if (op === 'boolean') return booleanOp(K, payload);
  if (op === 'fillet') return filletOp(K, payload);
  throw new Error(`unknown job ${op}`);
};
/** Run a job off the main thread. Typed arrays in the payload are copied, so the caller keeps its own. */
export function geo(op, payload) {
  const w = start();
  if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(local(op, payload)); } catch (e) { rej(e); } }, 0));
  return new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, { resolve, reject, fallback: () => { try { resolve(local(op, payload)); } catch (e) { reject(e); } } });
    w.postMessage({ id, op, payload });
  });
}
export const geoInWorker = () => !!start() && !failed;
