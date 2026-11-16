// Local-first storage: the current design and a few recovery versions live in IndexedDB, which holds
// far more than localStorage (imported meshes included). Falls back to localStorage, then reports failure.
const DB = 'printforge', STORE = 'docs', KEEP = 6;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error || new Error('IndexedDB unavailable'));
      req.onblocked = () => rej(new Error('IndexedDB is blocked by another tab'));
    } catch (e) { rej(e); }
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const st = t.objectStore(STORE); let out; Promise.resolve(fn(st)).then((v) => { out = v; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage is full')); }); };
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Save the current design. Resolves to 'idb' or 'local'; rejects when nothing could store it. */
export async function saveCurrent(doc) {
  const rec = { doc, time: Date.now(), name: doc.name, objects: doc.objects?.length || 0 };
  try { await tx('readwrite', (st) => { st.put(rec, 'current'); }); return 'idb'; }
  catch (e) {
    try { localStorage.setItem('printforge.autosave.v1', JSON.stringify(doc)); return 'local'; } catch { throw new Error(`Couldn’t save in this browser (${e.message || 'storage unavailable'}).`); }
  }
}
export async function loadCurrent() {
  try { const r = await tx('readonly', (st) => req(st.get('current'))); if (r?.doc) return r.doc; } catch { /* fall back */ }
  try { const s = localStorage.getItem('printforge.autosave.v1'); return s ? JSON.parse(s) : null; } catch { return null; }
}
/** Keep a recovery version (oldest ones are dropped). */
export async function snapshot(doc, reason = 'auto') {
  const id = `v${Date.now()}`;
  await tx('readwrite', (st) => { st.put({ doc, time: Date.now(), name: doc.name, objects: doc.objects?.length || 0, reason }, id); });
  const list = await listVersions(); for (const v of list.slice(KEEP)) await tx('readwrite', (st) => { st.delete(v.id); });
}
export async function listVersions() {
  const all = await tx('readonly', async (st) => { const [keys, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]); return keys.map((k, i) => ({ id: k, ...vals[i] })); });
  return all.filter((v) => String(v.id).startsWith('v')).sort((a, b) => b.time - a.time).map(({ id, time, name, objects, reason }) => ({ id, time, name, objects, reason }));
}
export async function loadVersion(id) { const r = await tx('readonly', (st) => req(st.get(id))); return r?.doc || null; }
