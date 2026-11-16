// QR code encoder (ISO/IEC 18004), byte mode, versions 1-40, error correction L/M/Q/H.
// Written for PrintForge (MIT). Follows the structure of Project Nayuki's reference
// QR generator (MIT licence): data -> codewords -> Reed-Solomon -> interleave -> modules -> best mask.

const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

// GF(256) with polynomial 0x11D
function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function rsDivisor(deg) {
  const res = new Array(deg).fill(0); res[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < res.length; j++) { res[j] = gfMul(res[j], root); if (j + 1 < res.length) res[j] ^= res[j + 1]; } root = gfMul(root, 2); }
  return res;
}
function rsRemainder(data, div) {
  const res = div.map(() => 0);
  for (const b of data) { const f = b ^ res.shift(); res.push(0); div.forEach((c, i) => { res[i] ^= gfMul(c, f); }); }
  return res;
}

/**
 * Encode text as a QR code. Returns { size, modules: boolean[][] (true = dark), version, ecc, mask }.
 * @param {string} text  UTF-8 text (URL, Wi-Fi string, vCard…)
 * @param {'L'|'M'|'Q'|'H'} ecl  error correction; the level is raised for free when it still fits the same version
 */
export function encodeQR(text, ecl = 'M', { minVersion = 1, maxVersion = 40, boostEcl = true } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  let e = ECC[ecl] ?? 1;
  let ver = -1, used = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    const ccBits = v <= 9 ? 8 : 16; const bits = 4 + ccBits + bytes.length * 8;
    if (bytes.length < (1 << ccBits) && bits <= dataCodewords(v, e) * 8) { ver = v; used = bits; break; }
  }
  if (ver < 0) throw new Error('This text is too long for a QR code. Shorten it or use a lower error correction.');
  if (boostEcl) for (let k = e + 1; k <= 3; k++) if (used <= dataCodewords(ver, k) * 8) e = k;
  const eName = Object.keys(ECC).find((k) => ECC[k] === e);

  // bit stream: mode 0100 (byte), char count, data, terminator, padding
  const bb = []; const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bb.length)); put(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bb.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bb[i + j]; data.push(b); }

  // split into blocks, add error correction, interleave
  const nb = NUM_BLOCKS[e][ver], eclen = ECC_PER_BLOCK[e][ver], raw = Math.floor(rawModules(ver) / 8);
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eclen); const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eclen + (i < nShort ? 0 : 1)); k += dat.length;
    const ecc = rsRemainder(dat, div); if (i < nShort) dat.push(0); blocks.push(dat.concat(ecc));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eclen || j >= nShort) all.push(b[i]); });

  // module grid
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignPositions(ver);
  align.forEach((ax, i) => align.forEach((ay, j) => { if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const drawFormat = (mask) => {
    const d = (FORMAT_BITS[eName] << 3) | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412; const b = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const bit = ((bits >>> i) & 1) !== 0; const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }
  // zigzag data placement
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j; const upward = ((right + 1) & 2) === 0; const y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && i < all.length * 8) { mod[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  // choose the mask with the lowest penalty
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (fn[y][x]) continue; let inv;
    switch (m) { case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
      case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
      case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break; default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
    if (inv) mod[y][x] = !mod[y][x]; } };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const pen = penalty(mod, size); if (pen < bestP) { bestP = pen; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { size, modules: mod, version: ver, ecc: eName, mask: best };
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2; const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6]; for (let pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

function penalty(m, size) {
  let r = 0;
  const runs = (get) => {
    for (let a = 0; a < size; a++) {
      let color = false, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      const push = (len) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
      const finderLike = () => { const n = hist[1]; const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n; return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0); };
      for (let b = 0; b < size; b++) {
        if (get(a, b) === color) { run++; if (run === 5) r += 3; else if (run > 5) r++; }
        else { push(run); if (!color) r += finderLike() * 40; color = get(a, b); run = 1; }
      }
      // terminate the line
      if (color) { push(run); run = 0; } run += size; push(run); r += finderLike() * 40;
    }
  };
  runs((y, x) => m[y][x]); runs((x, y) => m[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) r += 3; }
  let dark = 0; for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size; const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1; r += k * 10;
  return r;
}

/** Build the text for common QR payloads. */
export function qrPayload(kind, f) {
  const esc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
  switch (kind) {
    case 'wifi': return `WIFI:T:${f.security || 'WPA'};S:${esc(f.ssid)};${f.security === 'nopass' ? '' : `P:${esc(f.password)};`}${f.hidden ? 'H:true;' : ''};`;
    case 'contact': return ['BEGIN:VCARD', 'VERSION:3.0', `N:${f.last || ''};${f.first || ''}`, `FN:${[f.first, f.last].filter(Boolean).join(' ')}`, f.org ? `ORG:${f.org}` : '', f.phone ? `TEL:${f.phone}` : '', f.email ? `EMAIL:${f.email}` : '', f.url ? `URL:${f.url}` : '', 'END:VCARD'].filter(Boolean).join('\n');
    case 'email': return `mailto:${f.email || ''}${f.subject ? `?subject=${encodeURIComponent(f.subject)}` : ''}`;
    case 'phone': return `tel:${(f.phone || '').replace(/\s+/g, '')}`;
    case 'sms': return `SMSTO:${(f.phone || '').replace(/\s+/g, '')}:${f.message || ''}`;
    case 'url': { const u = (f.url || '').trim(); return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : u ? `https://${u}` : ''; }
    default: return f.text || '';
  }
}
