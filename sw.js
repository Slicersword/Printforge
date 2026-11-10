// Offline support. Network first, so a new upload shows up on the next reload; the cache is used when offline.
const CACHE = 'printforge-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'assets/icon.svg', 'vendor/manifold.js', 'vendor/manifold.wasm',
  'js/main.js', 'js/kernel.js', 'js/math.js', 'js/scene.js', 'js/shapes.js', 'js/renderer.js', 'js/viewport.js', 'js/ui.js', 'js/io.js',
  'js/printers.js', 'js/generators.js', 'js/sketch.js', 'js/script.js', 'js/printprep.js', 'js/textshape.js', 'js/gcode.js', 'js/palette.js', 'js/makers.js', 'js/ai.js', 'js/repair.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); const sameOrigin = url.origin === self.location.origin; const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !font) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: sameOrigin });
      if (hit) return hit;
      throw err;
    }
  })());
});
