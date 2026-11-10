// PrintForge relay: a tiny Cloudflare Worker that forwards PrintForge's AI requests to
// services that don't accept calls straight from a web page (Zoo, Tripo3D).
// It only forwards to the hosts listed below, and only for pages from your own site.
//
// Deploy (free): dash.cloudflare.com → Workers & Pages → Create → Worker → paste this file → Deploy.
// Then put the worker's address (https://<name>.<you>.workers.dev) in PrintForge → AI → More settings → Relay.

const ALLOWED_HOSTS = [/(^|\.)zoo\.dev$/, /(^|\.)tripo3d\.(com|ai)$/, /\.amazonaws\.com$/, /\.cloudfront\.net$/, /\.aliyuncs\.com$/];
// Put your site here so other sites can't use your relay, for example 'https://yourname.github.io'.
const ALLOWED_ORIGINS = ['https://slicersword.github.io', 'http://localhost:8000'];

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('This relay only works for its own PrintForge site.', { status: 403, headers: cors });
    const target = new URL(request.url).searchParams.get('url');
    let url; try { url = new URL(target); } catch { return new Response('Missing ?url=', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some((re) => re.test(url.hostname))) return new Response('That address is not allowed.', { status: 403, headers: cors });
    const headers = new Headers();
    for (const h of ['authorization', 'content-type']) { const v = request.headers.get(h); if (v) headers.set(h, v); }
    const res = await fetch(url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() });
    const out = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
