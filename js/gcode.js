// G-code preview: open a file from any slicer and inspect its toolpaths layer by layer.
import { h } from './ui.js';
import { fmt } from './math.js';
import { hex } from './renderer.js';
import { unzip } from './io.js';

// Feature categories, in legend order. `re` is tested against the slicer's ;TYPE: / ;FEATURE: comment.
export const FEATURES = [
  { id: 'outer', label: 'Outer wall', color: '#F2A23A', re: /outer|external|wall-outer/ },
  { id: 'overhang', label: 'Overhang wall', color: '#3B66D8', re: /overhang/ },
  { id: 'inner', label: 'Inner wall', color: '#F5D547', re: /inner|perimeter|wall/ },
  { id: 'top', label: 'Top & bottom', color: '#E2463F', re: /top|bottom|skin/ },
  { id: 'bridge', label: 'Bridge', color: '#6CA6E0', re: /bridge/ },
  { id: 'solid', label: 'Solid infill', color: '#B4407A', re: /solid/ },
  { id: 'gap', label: 'Gap fill', color: '#FFFFFF', re: /gap/ },
  { id: 'infill', label: 'Sparse infill', color: '#B8343F', re: /infill|fill/ },
  { id: 'iface', label: 'Support interface', color: '#2F8F7A', re: /interface/ },
  { id: 'support', label: 'Support', color: '#5FB85A', re: /support/ },
  { id: 'skirt', label: 'Skirt & brim', color: '#43B2A8', re: /skirt|brim/ },
  { id: 'prime', label: 'Prime tower', color: '#9C7BD8', re: /prime|wipe/ },
  { id: 'iron', label: 'Ironing', color: '#E88FB8', re: /iron/ },
  { id: 'other', label: 'Other', color: '#9AA3AD', re: /.*/ },
];
const FIDX = Object.fromEntries(FEATURES.map((f, i) => [f.id, i]));
const typeCache = new Map();
function classify(name) {
  let c = typeCache.get(name); if (c !== undefined) return c;
  const n = name.toLowerCase(); c = FEATURES.findIndex((f) => f.re.test(n)); typeCache.set(name, c); return c;
}

/** Parse G-code text into segments. Returns typed arrays plus header info. */
export function parseGcode(text) {
  let x = 0, y = 0, z = 0, e = 0, f = 1500; let absXYZ = true, absE = true, unit = 1;
  let type = FIDX.other; let layerZ = null;
  // Segments: x0 y0 z0 x1 y1 z1, plus type, layer, feed, extrude flag.
  let cap = 1 << 16; let seg = new Float32Array(cap * 6); let meta = new Float32Array(cap * 3); let ext = new Uint8Array(cap); let n = 0;
  const layers = []; // z per layer
  const info = { slicer: '', time: 0, filamentMm: 0, filamentG: 0, eTotal: 0, timeEst: 0, typesSeen: new Set() };
  const grow = () => { cap *= 2; const s2 = new Float32Array(cap * 6); s2.set(seg); seg = s2; const m2 = new Float32Array(cap * 3); m2.set(meta); meta = m2; const e2 = new Uint8Array(cap); e2.set(ext); ext = e2; };
  const push = (x0, y0, z0, x1, y1, z1, extr) => {
    if (n >= cap) grow();
    const o = n * 6; seg[o] = x0; seg[o + 1] = y0; seg[o + 2] = z0; seg[o + 3] = x1; seg[o + 4] = y1; seg[o + 5] = z1;
    if (extr) {
      if (layerZ === null || Math.abs(z1 - layerZ) > 1e-4) { layerZ = z1; layers.push(z1); }
      info.typesSeen.add(type);
    }
    meta[n * 3] = type; meta[n * 3 + 1] = Math.max(0, layers.length - 1); meta[n * 3 + 2] = f; ext[n] = extr ? 1 : 0;
    info.timeEst += Math.hypot(x1 - x0, y1 - y0, z1 - z0) / Math.max(f / 60, 1); n++;
  };
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li]; const sc = line.indexOf(';');
    if (sc >= 0) {
      const c = line.slice(sc + 1).trim();
      if (c) {
        const m = /^(?:TYPE|FEATURE)\s*:\s*(.+)$/i.exec(c);
        if (m) type = classify(m[1].trim());
        else if (li < 400 || lines.length - li < 2000) header(c, info);
      }
      line = line.slice(0, sc);
    }
    line = line.trim(); if (!line) continue;
    const cmd = line.split(/\s+/)[0].toUpperCase();
    if (cmd === 'G90') { absXYZ = true; absE = true; continue; }
    if (cmd === 'G91') { absXYZ = false; absE = false; continue; }
    if (cmd === 'M82') { absE = true; continue; }
    if (cmd === 'M83') { absE = false; continue; }
    if (cmd === 'G20') { unit = 25.4; continue; }
    if (cmd === 'G21') { unit = 1; continue; }
    const p = params(line);
    if (cmd === 'G92') { if (p.E !== undefined) e = p.E * unit; if (p.X !== undefined) x = p.X * unit; if (p.Y !== undefined) y = p.Y * unit; if (p.Z !== undefined) z = p.Z * unit; continue; }
    if (cmd === 'G28') { if (p.X !== undefined || (!('Y' in p) && !('Z' in p))) x = 0; if (p.Y !== undefined || (!('X' in p) && !('Z' in p))) y = 0; continue; }
    const g = cmd === 'G0' || cmd === 'G00' ? 0 : cmd === 'G1' || cmd === 'G01' ? 1 : cmd === 'G2' || cmd === 'G02' ? 2 : cmd === 'G3' || cmd === 'G03' ? 3 : -1;
    if (g < 0) continue;
    if (p.F !== undefined) f = p.F * unit;
    const nx = p.X === undefined ? x : (absXYZ ? p.X * unit : x + p.X * unit);
    const ny = p.Y === undefined ? y : (absXYZ ? p.Y * unit : y + p.Y * unit);
    const nz = p.Z === undefined ? z : (absXYZ ? p.Z * unit : z + p.Z * unit);
    let de = 0; if (p.E !== undefined) { const ne = absE ? p.E * unit : e + p.E * unit; de = ne - e; e = ne; }
    const moved = nx !== x || ny !== y || nz !== z;
    if (!moved) continue;
    const extr = de > 1e-6 && (nx !== x || ny !== y);
    if (extr) info.eTotal += de;
    if (g >= 2 && (p.I !== undefined || p.J !== undefined)) {
      // Arc around (x+I, y+J); split into short chords.
      const cx = x + (p.I || 0) * unit, cy = y + (p.J || 0) * unit; const r = Math.hypot(x - cx, y - cy);
      let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
      if (g === 2) { while (a1 >= a0) a1 -= Math.PI * 2; } else { while (a1 <= a0) a1 += Math.PI * 2; }
      const steps = Math.max(4, Math.min(128, Math.ceil(Math.abs(a1 - a0) * r / 0.8)));
      let px = x, py = y, pz = z;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const a = a0 + (a1 - a0) * t;
        const qx = i === steps ? nx : cx + Math.cos(a) * r, qy = i === steps ? ny : cy + Math.sin(a) * r, qz = z + (nz - z) * t;
        push(px, py, pz, qx, qy, qz, extr); px = qx; py = qy; pz = qz;
      }
    } else push(x, y, z, nx, ny, nz, extr);
    x = nx; y = ny; z = nz;
  }
  return { seg: seg.subarray(0, n * 6), meta: meta.subarray(0, n * 3), ext: ext.subarray(0, n), count: n, layers, info };
}
function params(line) {
  const out = {}; const re = /([A-Za-z])\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g; let m; let first = true;
  while ((m = re.exec(line))) { if (first) { first = false; continue; } out[m[1].toUpperCase()] = parseFloat(m[2]); }
  return out;
}
function header(c, info) {
  const lc = c.toLowerCase();
  if (!info.slicer) {
    const m = /(generated (?:by|with)|^)\s*(prusaslicer|orcaslicer|bambustudio|superslicer|cura_steamengine|cura|simplify3d|kiri:moto|ideamaker|slic3r|creality print|elegooslicer|anycubic slicer)[^\n]*/i.exec(c);
    if (m) info.slicer = m[0].replace(/^generated (by|with)\s*/i, '').replace(/_SteamEngine/i, '').replace(/\s+on\s+\d{4}-.*$/i, '').replace(/\+\w+$/, '').trim().slice(0, 40);
  }
  let m;
  if ((m = /^time:\s*(\d+)/i.exec(c))) info.time = +m[1];
  else if ((m = /(estimated printing time(?: \(normal mode\))?|total estimated time|print time)\s*[:=]\s*([\dhmsd :]+)/i.exec(c))) { const t = dur(m[2]); if (t) info.time = t; }
  if ((m = /filament used \[mm\]\s*=\s*([\d.]+)/i.exec(c))) info.filamentMm = +m[1];
  else if ((m = /filament used:\s*([\d.]+)\s*m\b/i.exec(c))) info.filamentMm = +m[1] * 1000;
  else if ((m = /total filament length \[mm\]\s*[:=]\s*([\d.]+)/i.exec(c))) info.filamentMm = +m[1];
  if ((m = /(?:total )?filament (?:used \[g\]|weight \[g\])\s*[:=]\s*([\d.]+)/i.exec(c))) info.filamentG = +m[1];
  void lc;
}
function dur(s) { let t = 0; const re = /(\d+)\s*([dhms])/g; let m; let any = false; while ((m = re.exec(s))) { any = true; t += +m[1] * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]]; } if (!any && /^\s*\d+\s*$/.test(s)) t = +s; return t; }
export function fmtTime(t) { if (!t) return '–'; const hh = Math.floor(t / 3600), mm = Math.round((t % 3600) / 60); return hh ? `${hh} h ${mm} min` : `${Math.max(1, mm)} min`; }

// ---------------------------------------------------------------- viewer state and UI
export function install(app) {
  const st = { data: null, name: '', show: new Set(FEATURES.map((f) => f.id)), travel: false, colorBy: 'feature', top: Infinity, only: false, progress: 1, offset: [0, 0] };
  app.gcode = st;
  const bar = document.getElementById('gcodebar'); const slider = document.getElementById('gcLayer'); const out = document.getElementById('gcLayerOut');
  const moves = document.getElementById('gcMoves'); const onlyBox = document.getElementById('gcOnly');

  app.openGcode = () => document.getElementById('fileGcode').click();
  document.getElementById('fileGcode').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) load(f); e.target.value = ''; });
  app.loadGcode = load;

  async function load(file) {
    app.toast(`Reading ${file.name}…`, 1500);
    try {
      let text;
      if (/\.3mf$/i.test(file.name)) {
        const z = await unzip(await file.arrayBuffer()); const g = z.names.find((nm) => /\.gcode$/i.test(nm));
        if (!g) throw new Error('this 3MF has no sliced G-code inside. In your slicer, use “Export plate sliced file”, or import it as a model instead.');
        text = new TextDecoder().decode(await z.read(g));
      } else text = await file.text();
      const t0 = performance.now();
      const data = parseGcode(text);
      if (!data.layers.length) { app.toast('No extrusion moves found in this file. Is it G-code from a slicer?', 4500); return; }
      st.data = data; st.name = file.name; st.top = data.layers.length - 1; st.only = false; st.progress = 1;
      // Most firmware puts 0,0 at the plate's front-left corner; the view's plate is centred.
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (let i = 0; i < data.count; i++) if (data.ext[i]) { const o = i * 6; for (const k of [0, 3]) { lo[0] = Math.min(lo[0], data.seg[o + k]); hi[0] = Math.max(hi[0], data.seg[o + k]); lo[1] = Math.min(lo[1], data.seg[o + k + 1]); hi[1] = Math.max(hi[1], data.seg[o + k + 1]); } }
      const bed = app.view.r.bed; st.offset = lo[0] > -5 && lo[1] > -5 ? [-bed.w / 2, -bed.d / 2] : [0, 0];
      st.bounds = { lo, hi };
      build();
      bar.hidden = false;
      if (app.mode !== 'preview') app.setMode('preview'); else app.refresh();
      const z = data.layers[data.layers.length - 1];
      app.view.r.frame({ min: [lo[0] + st.offset[0], lo[1] + st.offset[1], 0], max: [hi[0] + st.offset[0], hi[1] + st.offset[1], z] }, true); app.view.redraw();
      app.toast(`Loaded ${data.layers.length} layers in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { console.error(e); app.toast(`${file.name}: ${e.message}`, 5000); }
  }

  // Build the vertex buffers for the visible features, ordered so each layer is one contiguous range.
  function build() {
    const d = st.data; if (!d) return;
    const showIdx = new Set([...st.show].map((id) => FIDX[id]));
    const fmin = [], fmax = []; let fLo = Infinity, fHi = 0;
    if (st.colorBy === 'speed') for (let i = 0; i < d.count; i++) if (d.ext[i]) { const f = d.meta[i * 3 + 2]; fLo = Math.min(fLo, f); fHi = Math.max(fHi, f); }
    void fmin; void fmax;
    const rgb = FEATURES.map((f) => hex(f.color));
    const nL = d.layers.length; const ex = { pos: [], col: [], starts: new Int32Array(nL + 1) }; const tr = { pos: [], starts: new Int32Array(nL + 1) };
    // Count first so we can allocate once.
    let ce = 0, ct = 0; for (let i = 0; i < d.count; i++) { if (d.ext[i]) { if (showIdx.has(d.meta[i * 3])) ce++; } else if (st.travel) ct++; }
    const pe = new Float32Array(ce * 6), cc = new Float32Array(ce * 6), pt = new Float32Array(ct * 6), ctc = new Float32Array(ct * 6);
    let ie = 0, it = 0, lastL = -1, lastLT = -1; const [ox, oy] = st.offset;
    const travelCol = app.view.r.theme.dark ? [0.55, 0.62, 0.7] : [0.35, 0.42, 0.5];
    for (let i = 0; i < d.count; i++) {
      const L = d.meta[i * 3 + 1]; const o = i * 6;
      if (d.ext[i]) {
        const ti = d.meta[i * 3]; if (!showIdx.has(ti)) continue;
        while (lastL < L) { lastL++; ex.starts[lastL] = ie * 2; }
        let c;
        if (st.colorBy === 'speed') { const tt = fHi > fLo ? (d.meta[i * 3 + 2] - fLo) / (fHi - fLo) : 0.5; c = ramp(tt); }
        else c = rgb[ti];
        const shade = L % 2 ? 0.86 : 1; // alternate layers slightly so they read as layers
        for (let k = 0; k < 2; k++) { const q = ie * 6 + k * 3; pe[q] = d.seg[o + k * 3] + ox; pe[q + 1] = d.seg[o + k * 3 + 1] + oy; pe[q + 2] = d.seg[o + k * 3 + 2]; cc[q] = c[0] * shade; cc[q + 1] = c[1] * shade; cc[q + 2] = c[2] * shade; }
        ie++;
      } else if (st.travel) {
        while (lastLT < L) { lastLT++; tr.starts[lastLT] = it * 2; }
        for (let k = 0; k < 2; k++) { const q = it * 6 + k * 3; pt[q] = d.seg[o + k * 3] + ox; pt[q + 1] = d.seg[o + k * 3 + 1] + oy; pt[q + 2] = d.seg[o + k * 3 + 2]; ctc[q] = travelCol[0]; ctc[q + 1] = travelCol[1]; ctc[q + 2] = travelCol[2]; }
        it++;
      }
    }
    while (lastL < nL) { lastL++; ex.starts[lastL] = ie * 2; }
    while (lastLT < nL) { lastLT++; tr.starts[lastLT] = it * 2; }
    st.ext = { pos: pe, col: cc, starts: ex.starts }; st.trav = { pos: pt, col: ctc, starts: tr.starts };
    st.speedRange = [fLo, fHi];
    updateRanges();
  }
  function updateRanges() {
    const d = st.data; if (!d) return; const nL = d.layers.length; const top = Math.min(st.top, nL - 1);
    const range = (r) => {
      const a = st.only ? r.starts[top] : 0; const lEnd = r.starts[top + 1], lStart = r.starts[top];
      let b = lStart + Math.round((lEnd - lStart) * st.progress / 2) * 2; if (st.progress >= 1) b = lEnd;
      return [a, Math.max(0, b - a)];
    };
    const [ea, ec] = range(st.ext); const [ta, tc] = range(st.trav);
    const sets = [{ pos: st.ext.pos, col: st.ext.col, start: ea, count: ec, alpha: 1 }];
    if (st.travel) sets.push({ pos: st.trav.pos, col: st.trav.col, start: ta, count: tc, alpha: 0.45 });
    // keep GL buffers when only the range changed
    if (st.sets && st.sets[0].pos === sets[0].pos) { sets[0].buf = st.sets[0].buf; sets[0].bufFor = st.sets[0].bufFor; }
    if (st.sets?.[1] && sets[1] && st.sets[1].pos === sets[1].pos) { sets[1].buf = st.sets[1].buf; sets[1].bufFor = st.sets[1].bufFor; }
    st.sets = sets;
    // nozzle marker at the last drawn point
    st.nozzle = null;
    if (ec > 0) { const q = (ea + ec - 1) * 3; st.nozzle = [st.ext.pos[q], st.ext.pos[q + 1], st.ext.pos[q + 2]]; }
    slider.max = String(nL - 1); slider.value = String(top); onlyBox.checked = st.only; moves.value = String(Math.round(st.progress * 100));
    out.textContent = `${top + 1} / ${nL} · ${fmt(d.layers[top], 2)} mm`;
    app.view.redraw();
  }
  slider.addEventListener('input', () => { st.top = +slider.value; st.progress = 1; updateRanges(); });
  moves.addEventListener('input', () => { st.progress = +moves.value / 100; updateRanges(); });
  onlyBox.addEventListener('change', () => { st.only = onlyBox.checked; updateRanges(); });
  let playing = null; const playBtn = document.getElementById('gcPlay');
  playBtn.addEventListener('click', () => {
    if (playing) { stop(); return; }
    if (!st.data) return; if (st.top >= st.data.layers.length - 1 && st.progress >= 1) { st.top = 0; st.progress = 0; }
    playBtn.textContent = 'Pause'; playBtn.setAttribute('aria-pressed', 'true');
    playing = setInterval(() => { st.progress += 0.12; if (st.progress >= 1) { if (st.top >= st.data.layers.length - 1) { st.progress = 1; updateRanges(); stop(); return; } st.top++; st.progress = 0; } updateRanges(); }, 60);
  });
  function stop() { clearInterval(playing); playing = null; playBtn.textContent = 'Play'; playBtn.setAttribute('aria-pressed', 'false'); }

  app.on('draw-extras', (extras) => {
    if (app.mode !== 'preview' || !st.sets) return;
    extras.gcode = { sets: st.sets };
    if (st.nozzle && (st.progress < 1 || playing)) { const [x, y, z] = st.nozzle; const s = 2.5; extras.lines.push({ data: new Float32Array([x - s, y, z, x + s, y, z, x, y - s, z, x, y + s, z, x, y, z, x, y, z + 6]), color: [1, 0.35, 0.1, 1], noDepth: true }); }
  });
  app.on('mode', (m) => { bar.hidden = m !== 'preview' || !st.data; if (m !== 'preview') stop(); if (m === 'preview' && st.data) { build(); } });
  app.on('theme', () => { if (st.data) build(); });

  app.previewPanel = () => {
    const d = st.data;
    const openBtn = h('button', { class: 'btn primary wide', onclick: app.openGcode }, d ? 'Open another G-code file…' : 'Open G-code file…');
    if (!d) {
      return [h('h3', {}, 'G-code preview'),
        h('p', { class: 'note' }, 'Check what your slicer made before you print. Open a .gcode file from Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Kiri:Moto or any other slicer, then step through it layer by layer.'),
        openBtn, h('p', { class: 'note' }, 'You can also drop a .gcode file anywhere on the view. Files are read in your browser and never uploaded.')];
    }
    const i = d.info; const z = d.layers[d.layers.length - 1];
    const fil = i.filamentMm || i.eTotal; const grams = i.filamentG || fil * Math.PI * (1.75 / 2) ** 2 / 1000 * 1.24;
    const time = i.time || i.timeEst * 1.15;
    const counts = new Map(); let total = 0;
    for (let k = 0; k < d.count; k++) if (d.ext[k]) { const o = k * 6; const len = Math.hypot(d.seg[o + 3] - d.seg[o], d.seg[o + 4] - d.seg[o + 1]); const t = d.meta[k * 3]; counts.set(t, (counts.get(t) || 0) + len); total += len; }
    const bed = app.view.r.bed; const b = st.bounds; const tooBig = (b.hi[0] - b.lo[0]) > bed.w + 1 || (b.hi[1] - b.lo[1]) > bed.d + 1 || z > bed.h + 0.5;
    const legend = FEATURES.map((f, idx) => ({ f, idx, len: counts.get(idx) || 0 })).filter((x) => x.len > 0);
    return [
      h('h3', {}, 'G-code preview'),
      h('p', { class: 'note', style: { marginTop: '-8px', wordBreak: 'break-all' } }, st.name, i.slicer ? ` · ${i.slicer}` : ''),
      h('div', { class: 'stat-grid' },
        stat(String(d.layers.length), 'layers'), stat(`${fmt(z, 2)} mm`, 'height'),
        stat(fmtTime(time), i.time ? 'print time (slicer)' : 'print time (rough)'), stat(`${fmt(fil / 1000, 2)} m`, `filament · about ${fmt(grams, grams < 10 ? 1 : 0)} g`)),
      tooBig ? h('div', { class: 'error-box' }, `This file is bigger than the ${bed.w}×${bed.d}×${bed.h} mm plate selected in Design. Check it was sliced for your printer.`) : null,
      h('fieldset', {}, h('legend', {}, 'Colour by'),
        h('div', { class: 'seg' }, ...[['feature', 'Feature'], ['speed', 'Speed']].map(([v, l]) => h('button', { 'aria-pressed': String(st.colorBy === v), onclick: () => { st.colorBy = v; build(); app.refresh(); } }, l)))),
      st.colorBy === 'feature'
        ? h('fieldset', {}, h('legend', {}, 'Features'), h('ul', { class: 'legend' }, ...legend.map(({ f, len }) => h('li', {},
          h('label', {}, h('input', { type: 'checkbox', checked: st.show.has(f.id), onchange: (e) => { if (e.target.checked) st.show.add(f.id); else st.show.delete(f.id); build(); } }),
            h('span', { class: 'chip', style: { background: f.color } }), h('span', { class: 'nm' }, f.label), h('span', { class: 'pct' }, `${Math.max(0.1, len / total * 100).toFixed(len / total < 0.1 ? 1 : 0)}%`))))))
        : h('fieldset', {}, h('legend', {}, 'Speed'), h('div', { class: 'ramp' }), h('div', { class: 'ramp-labels' }, h('span', {}, `${fmt(st.speedRange[0] / 60, 0)} mm/s`), h('span', {}, `${fmt(st.speedRange[1] / 60, 0)} mm/s`))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.travel, onchange: (e) => { st.travel = e.target.checked; build(); } }), 'Show travel moves'),
      openBtn,
      h('button', { class: 'btn wide', onclick: () => { st.data = null; st.sets = null; bar.hidden = true; app.refresh(); app.view.redraw(); } }, 'Close file'),
      h('p', { class: 'note' }, 'Drag the layer slider below, or press Play to watch the nozzle. The time and filament come from the slicer\'s notes in the file when it has them.'),
    ];
  };
  function stat(v, l) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)); }
}
function ramp(t) { // blue → green → yellow → red
  const stops = [[0.23, 0.4, 0.85], [0.25, 0.72, 0.45], [0.95, 0.8, 0.25], [0.88, 0.25, 0.22]];
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1); const i = Math.floor(x), f = x - i; const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
