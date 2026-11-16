// Share links: the whole design, compressed, in the part of the address after "#". Browsers never send that part to a
// server, so a link works on any static host (GitHub Pages included) and the design stays between you and whoever
// you send the link to. Opening a link loads the design ready to edit; what was on screen is kept in Recover.
const PREFIX = '#d=';
const toB64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = (str) => { const b = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function makeShareLink(doc) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  return `${location.origin}${location.pathname}${PREFIX}${toB64url(packed)}`;
}
export function hasSharedDesign() { return location.hash.startsWith(PREFIX); }
export async function readSharedDesign() {
  const data = fromB64url(location.hash.slice(PREFIX.length));
  const json = await pipe(data, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(json));
}
/** Drop the design from the address once it's open, so a reload doesn't open the link again over your edits. */
export function clearSharedHash() { history.replaceState(null, '', location.pathname + location.search); }
