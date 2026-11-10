// File import/export: STL (binary + ASCII), OBJ, 3MF (with per-object colours). Zero dependencies.

// ---------------------------------------------------------------- ZIP (store or deflate via CompressionStream)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); } catch { return null; }
}
async function inflateRaw(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function zip(files) { // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    let data = f.data, method = 0; const comp = f.data.length > 256 ? await deflateRaw(f.data) : null;
    if (comp && comp.length < f.data.length) { data = comp; method = 8; }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, f.data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

export async function unzip(buf) {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf); const out = {};
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid ZIP/3MF archive.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lxl = dv.getUint16(lo + 28, true); const start = lo + 30 + lnl + lxl;
    const raw = u8.subarray(start, start + csize);
    out[name] = { method, raw };
    p += 46 + nl + xl + cl;
  }
  return { names: Object.keys(out), read: async (name) => { const f = out[name]; if (!f) return null; return f.method === 8 ? inflateRaw(f.raw) : f.raw; } };
}

// ---------------------------------------------------------------- export
/** parts: [{name, color:'#rrggbb', v: Float32Array (xyz), t: Uint32Array}] in world mm, Z up. */
export function toSTL(parts, name = 'model') {
  const nT = parts.reduce((s, p) => s + p.t.length / 3, 0);
  const buf = new ArrayBuffer(84 + nT * 50); const dv = new DataView(buf);
  const header = `PrintForge binary STL: ${name}`.slice(0, 79);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, nT, true); let o = 84;
  for (const p of parts) {
    const v = p.v, t = p.t;
    for (let f = 0; f < t.length; f += 3) {
      const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const k of [a, b, c]) { dv.setFloat32(o, v[k], true); dv.setFloat32(o + 4, v[k + 1], true); dv.setFloat32(o + 8, v[k + 2], true); o += 12; }
      o += 2;
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

export function toOBJ(parts, name = 'model') {
  const lines = [`# PrintForge OBJ: ${name}`, `mtllib ${name}.mtl`]; const mtl = []; let base = 1;
  parts.forEach((p, i) => {
    const mat = `m${i}`; const [r, g, b] = hexRgb(p.color || '#cccccc');
    mtl.push(`newmtl ${mat}`, `Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`, '');
    lines.push(`o ${safe(p.name || 'part' + i)}`, `usemtl ${mat}`);
    for (let k = 0; k < p.v.length; k += 3) lines.push(`v ${fx(p.v[k])} ${fx(p.v[k + 1])} ${fx(p.v[k + 2])}`);
    for (let k = 0; k < p.t.length; k += 3) lines.push(`f ${p.t[k] + base} ${p.t[k + 1] + base} ${p.t[k + 2] + base}`);
    base += p.v.length / 3;
  });
  return { obj: new Blob([lines.join('\n')], { type: 'text/plain' }), mtl: new Blob([mtl.join('\n')], { type: 'text/plain' }) };
}

export async function to3MF(parts, meta = {}) {
  const enc = new TextEncoder(); const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const colors = [...new Set(parts.map((p) => (p.color || '#cccccc').toUpperCase()))];
  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n`;
  x += ` <metadata name="Title">${esc(meta.title || 'PrintForge design')}</metadata>\n <metadata name="Application">PrintForge</metadata>\n <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>\n`;
  x += ` <resources>\n  <basematerials id="1">\n${colors.map((c) => `   <base name="${c}" displaycolor="${c}FF" />`).join('\n')}\n  </basematerials>\n`;
  const sb = [];
  parts.forEach((p, i) => {
    const pid = colors.indexOf((p.color || '#cccccc').toUpperCase());
    sb.push(`  <object id="${i + 2}" name="${esc(p.name || 'Part ' + (i + 1))}" type="model" pid="1" pindex="${pid}">\n   <mesh>\n    <vertices>\n`);
    const v = p.v; const vs = [];
    for (let k = 0; k < v.length; k += 3) vs.push(`     <vertex x="${fx(v[k])}" y="${fx(v[k + 1])}" z="${fx(v[k + 2])}" />`);
    sb.push(vs.join('\n'), '\n    </vertices>\n    <triangles>\n');
    const t = p.t; const ts = [];
    for (let k = 0; k < t.length; k += 3) ts.push(`     <triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}" />`);
    sb.push(ts.join('\n'), '\n    </triangles>\n   </mesh>\n  </object>\n');
  });
  x += sb.join('') + ' </resources>\n <build>\n' + parts.map((p, i) => `  <item objectid="${i + 2}" />`).join('\n') + '\n </build>\n</model>\n';
  const ct = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const blob = await zip([{ name: '[Content_Types].xml', data: enc.encode(ct) }, { name: '_rels/.rels', data: enc.encode(rels) }, { name: '3D/3dmodel.model', data: enc.encode(x) }]);
  return new Blob([blob], { type: 'model/3mf' });
}

// ---------------------------------------------------------------- import
/** Returns [{name, v: Float32Array, t: Uint32Array, color?}] */
export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase(); const base = file.name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  if (ext === 'stl') return [{ name: base, ...parseSTL(buf) }];
  if (ext === 'obj') return parseOBJ(new TextDecoder().decode(buf), base);
  if (ext === '3mf') return parse3MF(buf, base);
  if (ext === 'glb') { const parts = parseGLB(buf, base); return toMillimetres(parts); }
  throw new Error(`“.${ext}” files can't be imported. Use STL, OBJ, 3MF or GLB.`);
}

export function parseSTL(buf) {
  const dv = new DataView(buf); const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(512, buf.byteLength)));
  const nBin = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const isBin = buf.byteLength === 84 + nBin * 50 || !/^\s*solid[\s\S]*facet/i.test(head);
  const pts = [];
  if (isBin) {
    for (let f = 0, o = 84; f < nBin; f++, o += 50) for (let k = 0; k < 3; k++) { const q = o + 12 + k * 12; pts.push(dv.getFloat32(q, true), dv.getFloat32(q + 4, true), dv.getFloat32(q + 8, true)); }
  } else {
    const re = /vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g; const s = new TextDecoder().decode(buf); let m;
    while ((m = re.exec(s))) pts.push(+m[1], +m[2], +m[3]);
  }
  return weld(pts);
}
/** Merge identical vertices of a triangle soup. */
export function weld(pts) {
  const map = new Map(); const v = []; const t = new Uint32Array(pts.length / 3);
  for (let i = 0; i < pts.length; i += 3) {
    const k = `${Math.round(pts[i] * 1e4)},${Math.round(pts[i + 1] * 1e4)},${Math.round(pts[i + 2] * 1e4)}`;
    let id = map.get(k); if (id === undefined) { id = v.length / 3; map.set(k, id); v.push(pts[i], pts[i + 1], pts[i + 2]); }
    t[i / 3] = id;
  }
  // drop degenerate triangles
  const keep = []; for (let i = 0; i < t.length; i += 3) if (t[i] !== t[i + 1] && t[i + 1] !== t[i + 2] && t[i] !== t[i + 2]) keep.push(t[i], t[i + 1], t[i + 2]);
  return { v: new Float32Array(v), t: new Uint32Array(keep) };
}
function parseOBJ(text, base) {
  const V = []; const groups = []; let cur = { name: base, f: [] }; groups.push(cur);
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l[0] === '#') continue; const s = l.split(/\s+/);
    if (s[0] === 'v') V.push([+s[1], +s[2], +s[3]]);
    else if (s[0] === 'o' || s[0] === 'g') { cur = { name: s.slice(1).join(' ') || base, f: [] }; groups.push(cur); }
    else if (s[0] === 'f') { const idx = s.slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? V.length + i : i - 1; }); for (let k = 1; k < idx.length - 1; k++) cur.f.push(idx[0], idx[k], idx[k + 1]); }
  }
  const out = [];
  for (const g of groups) { if (!g.f.length) continue; const pts = []; for (const i of g.f) pts.push(...V[i]); out.push({ name: g.name, ...weld(pts) }); }
  return out;
}
async function parse3MF(buf, base) {
  const z = await unzip(buf); const models = z.names.filter((n) => /\.model$/i.test(n));
  const out = []; const dec = new TextDecoder();
  for (const mn of models) {
    const xml = new DOMParser().parseFromString(dec.decode(await z.read(mn)), 'application/xml');
    const colors = {}; xml.querySelectorAll('basematerials').forEach((bm) => { colors[bm.getAttribute('id')] = [...bm.querySelectorAll('base')].map((b) => (b.getAttribute('displaycolor') || '').slice(0, 7)); });
    xml.querySelectorAll('colorgroup').forEach((cg) => { colors[cg.getAttribute('id')] = [...cg.querySelectorAll('color')].map((b) => (b.getAttribute('color') || '').slice(0, 7)); });
    const objects = {};
    xml.querySelectorAll('object').forEach((o) => {
      const mesh = o.querySelector('mesh'); if (!mesh) return;
      const v = []; mesh.querySelectorAll('vertex').forEach((e) => v.push(+e.getAttribute('x'), +e.getAttribute('y'), +e.getAttribute('z')));
      const t = []; mesh.querySelectorAll('triangle').forEach((e) => t.push(+e.getAttribute('v1'), +e.getAttribute('v2'), +e.getAttribute('v3')));
      const pid = o.getAttribute('pid'), pin = +(o.getAttribute('pindex') || 0);
      objects[o.getAttribute('id')] = { name: o.getAttribute('name') || base, v: new Float32Array(v), t: new Uint32Array(t), color: pid && colors[pid] ? colors[pid][pin] : undefined };
    });
    const items = [...xml.querySelectorAll('build > item')];
    if (!items.length) Object.values(objects).forEach((o) => out.push(o));
    for (const it of items) {
      const o = objects[it.getAttribute('objectid')]; if (!o) continue;
      const tr = it.getAttribute('transform');
      if (tr) { const m = tr.trim().split(/\s+/).map(Number); const v = new Float32Array(o.v.length); for (let k = 0; k < v.length; k += 3) { const x = o.v[k], y = o.v[k + 1], zz = o.v[k + 2]; v[k] = m[0] * x + m[3] * y + m[6] * zz + m[9]; v[k + 1] = m[1] * x + m[4] * y + m[7] * zz + m[10]; v[k + 2] = m[2] * x + m[5] * y + m[8] * zz + m[11]; } out.push({ ...o, v }); }
      else out.push(o);
    }
  }
  if (!out.length) throw new Error('No meshes found in this 3MF. Component-only files are not supported yet.');
  return out;
}

// ---------------------------------------------------------------- helpers
export function download(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function fx(x) { return Number(x.toFixed(5)).toString(); }
function safe(s) { return String(s).replace(/\s+/g, '_'); }

// ---------------------------------------------------------------- GLB (binary glTF 2.0)
const MUL = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0], [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  return [(1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0, tx, ty, tz, 1];
}
/** Triangles from every mesh in the default scene, converted from glTF's Y-up to Z-up. Units unchanged (glTF uses metres). */
export function parseGLB(buf, base = 'model') {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('This is not a binary glTF (.glb) file.');
  let off = 12; let json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004E4942) bin = new Uint8Array(buf, off + 8, len);
    off += 8 + len;
  }
  if (!json) throw new Error('This GLB file has no scene data.');
  if ((json.extensionsRequired || []).some((e) => /draco|meshopt/i.test(e))) throw new Error('This GLB uses mesh compression (Draco or Meshopt), which PrintForge can’t read yet. Export it as STL or uncompressed GLB.');
  const acc = (i) => {
    const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView]; const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0); const C = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const stride = bv.byteStride || comps * C.BYTES_PER_ELEMENT; const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * comps);
    const view = new DataView(bin.buffer, bin.byteOffset + start);
    const get = { 5126: (o) => view.getFloat32(o, true), 5125: (o) => view.getUint32(o, true), 5123: (o) => view.getUint16(o, true), 5121: (o) => view.getUint8(o) }[a.componentType];
    for (let e = 0; e < a.count; e++) for (let c = 0; c < comps; c++) out[e * comps + c] = get(e * stride + c * C.BYTES_PER_ELEMENT);
    return out;
  };
  const pts = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni]; const M = MUL(parent, nodeMatrix(node));
    if (node.mesh !== undefined) for (const prim of json.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
      const P = acc(prim.attributes.POSITION); const I = prim.indices !== undefined ? acc(prim.indices) : Uint32Array.from({ length: P.length / 3 }, (_, k) => k);
      for (const k of I) { const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2]; const wx = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz = M[2] * x + M[6] * y + M[10] * z + M[14]; pts.push(wx, -wz, wy); }
    }
    for (const c of node.children || []) visit(c, M);
  };
  const scene = json.scenes?.[json.scene ?? 0]; const roots = scene ? scene.nodes : json.nodes.map((_, i) => i);
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; for (const r of roots) visit(r, I4);
  if (!pts.length) throw new Error('This GLB file has no triangles.');
  return [{ name: base, ...weld(pts) }];
}
/** glTF files are in metres; small models are scaled up to millimetres. */
function toMillimetres(parts) {
  let m = 0; for (const p of parts) for (const x of p.v) m = Math.max(m, Math.abs(x));
  if (m > 0 && m < 10) for (const p of parts) for (let i = 0; i < p.v.length; i++) p.v[i] *= 1000;
  return parts;
}
/** Scale parts so the largest side is `size` mm. */
export function scaleToSize(parts, size) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.v[i + k]); hi[k] = Math.max(hi[k], p.v[i + k]); }
  const s = size / Math.max(...hi.map((x, i) => x - lo[i])); if (!isFinite(s) || s <= 0) return parts;
  for (const p of parts) for (let i = 0; i < p.v.length; i++) p.v[i] *= s;
  return parts;
}
