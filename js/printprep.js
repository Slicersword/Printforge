// Prepare to print: checks, orientation, arrangement, layer preview and estimates.
import { worldManifold, free, geomKey } from './kernel.js';
import { h, numField, row } from './ui.js';
import { PRINTERS, MATERIALS, printerById } from './printers.js';
import { mul, fmt, eulerMatrix, eulerFromMatrix } from './math.js';

const LINE_W = 0.42;

/** Rotation matrix taking unit vector a onto unit vector b. */
function rotBetween(a, b) {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; const m = new Float64Array(16); m[15] = 1;
  let ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; let s = Math.hypot(...ax);
  if (s < 1e-9) { if (c > 0) { m[0] = m[5] = m[10] = 1; return m; } ax = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]]; s = Math.hypot(...ax); ax = ax.map((v) => v / s); const [x, y, z] = ax; // 180°
    m[0] = 2 * x * x - 1; m[1] = 2 * x * y; m[2] = 2 * x * z; m[4] = 2 * x * y; m[5] = 2 * y * y - 1; m[6] = 2 * y * z; m[8] = 2 * x * z; m[9] = 2 * y * z; m[10] = 2 * z * z - 1; return m; }
  const [x, y, z] = ax.map((v) => v / s); const t = 1 - c;
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}
function applyR(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; }

/** Faces of a mesh grouped by normal direction: [{n, area}] sorted by area. */
function flatFaces(man, max = 10) {
  const m = man.getMesh(); const P = m.vertProperties, np = m.numProp, T = m.triVerts; const groups = new Map();
  for (let f = 0; f < T.length; f += 3) {
    const a = T[f] * np, b = T[f + 1] * np, c = T[f + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); if (L < 1e-9) continue;
    const n = [nx / L, ny / L, nz / L]; const key = n.map((x) => Math.round(x * 200)).join(',');
    const g = groups.get(key); if (g) g.area += L / 2; else groups.set(key, { n, area: L / 2 });
  }
  return [...groups.values()].sort((a, b) => b.area - a.area).slice(0, max);
}
function overhangOf(P, np, T, R, cosLimit) {
  // returns overhang area and lowest z after rotation R
  let minZ = Infinity; for (let i = 0; i < P.length; i += np) { const z = R[2] * P[i] + R[6] * P[i + 1] + R[10] * P[i + 2]; if (z < minZ) minZ = z; }
  let area = 0, contact = 0, maxZ = -Infinity;
  for (let f = 0; f < T.length; f += 3) {
    const pa = applyR(R, [P[T[f] * np], P[T[f] * np + 1], P[T[f] * np + 2]]), pb = applyR(R, [P[T[f + 1] * np], P[T[f + 1] * np + 1], P[T[f + 1] * np + 2]]), pc = applyR(R, [P[T[f + 2] * np], P[T[f + 2] * np + 1], P[T[f + 2] * np + 2]]);
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); if (L < 1e-12) continue;
    maxZ = Math.max(maxZ, pa[2], pb[2], pc[2]);
    const lowest = Math.max(pa[2], pb[2], pc[2]) - minZ;
    if (lowest < 0.15) { if (nz / L < -0.99) contact += L / 2; continue; }
    if (-nz / L > cosLimit) area += L / 2;
  }
  return { area, contact, height: maxZ - minZ };
}

export function install(app) {
  const st = { layer: null, results: null, busy: false };
  const settings = () => app.scene.settings;

  // ---------------------------------------------------------- analysis
  function analyse() {
    const s = app.scene; const set = settings(); const bed = app.view.r.bed; const res = { parts: [], checks: [], volume: 0, area: 0, maxZ: 0 };
    const cosLimit = Math.cos((90 - set.overhang) * Math.PI / 180);
    for (const o of s.objects) {
      if (o.visible === false || o.hole) continue;
      if (o._error) { res.checks.push({ level: 'bad', text: `${o.name}: ${o._error}` }); continue; }
      let man; try { man = worldManifold(o); } catch (e) { res.checks.push({ level: 'bad', text: `${o.name}: ${e.message}` }); continue; }
      const b = man.boundingBox(); const vol = man.volume(), area = man.surfaceArea();
      const m = man.getMesh(); const I = new Float64Array(16); I[0] = I[5] = I[10] = I[15] = 1;
      const oh = overhangOf(m.vertProperties, m.numProp, m.triVerts, I, cosLimit);
      let contact = 0; try { const cs = man.slice(Math.min(b.max[2] - 0.01, b.min[2] + 0.1)); contact = cs.area(); free(cs); } catch { /* ignore */ }
      let thin = false;
      try {
        for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const z = b.min[2] + (b.max[2] - b.min[2]) * f; const cs = man.slice(z); const a0 = cs.area(); if (a0 <= 0) { free(cs); continue; }
          const op = cs.offset(-LINE_W / 2, 'Round').offset(LINE_W / 2, 'Round'); const lost = 1 - op.area() / a0; free(cs); free(op);
          if (lost > 0.04) { thin = true; break; }
        }
      } catch { /* offset may fail on degenerate slices */ }
      res.parts.push({ o, b, vol, area, overhang: oh.area, contact, thin, genus: man.genus() });
      res.volume += vol; res.area += area; res.maxZ = Math.max(res.maxZ, b.max[2]);
      free(man);
    }
    const half = [bed.w / 2, bed.d / 2];
    const out = res.parts.filter(({ b }) => b.min[0] < -half[0] - 0.01 || b.max[0] > half[0] + 0.01 || b.min[1] < -half[1] - 0.01 || b.max[1] > half[1] + 0.01 || b.max[2] > bed.h + 0.01);
    if (!res.parts.length && !res.checks.length) res.checks.push({ level: 'warn', text: 'Nothing solid on the plate yet.' });
    if (out.length) res.checks.push({ level: 'bad', text: `${names(out)} ${out.length > 1 ? 'are' : 'is'} outside the build volume. Use Auto-arrange or scale down.` });
    const floating = res.parts.filter(({ b }) => b.min[2] > 0.05); if (floating.length) res.checks.push({ level: 'bad', text: `${names(floating)} ${floating.length > 1 ? 'start' : 'starts'} above the plate. Use Drop to plate.`, fix: 'drop' });
    const below = res.parts.filter(({ b }) => b.min[2] < -0.05); if (below.length) res.checks.push({ level: 'warn', text: `${names(below)} ${below.length > 1 ? 'go' : 'goes'} below the plate; the slicer will cut that part off.`, fix: 'drop' });
    const weak = res.parts.filter((p) => p.b.min[2] <= 0.05 && p.contact < Math.max(20, 0.04 * (p.b.max[0] - p.b.min[0]) * (p.b.max[1] - p.b.min[1])));
    if (weak.length) res.checks.push({ level: 'warn', text: `${names(weak)}: small first-layer contact (${fmt(Math.min(...weak.map((p) => p.contact)), 0)} mm²). Lay it flat or add a brim.`, fix: 'flat' });
    const oh = res.parts.filter((p) => p.overhang > 25); if (oh.length) res.checks.push({ level: 'warn', text: `${names(oh)}: ${fmt(oh.reduce((a, p) => a + p.overhang, 0), 0)} mm² steeper than ${set.overhang}°. Turn on supports in your slicer or try Auto-orient.`, fix: 'orient' });
    const thin = res.parts.filter((p) => p.thin); if (thin.length) res.checks.push({ level: 'warn', text: `${names(thin)}: some walls are thinner than one ${LINE_W} mm line and may not print.` });
    const tall = res.parts.filter((p) => { const H = p.b.max[2] - p.b.min[2]; const B = Math.min(p.b.max[0] - p.b.min[0], p.b.max[1] - p.b.min[1]); return H > 6 * B && H > 40; });
    if (tall.length) res.checks.push({ level: 'warn', text: `${names(tall)} ${tall.length > 1 ? 'are' : 'is'} tall and narrow and may wobble. Consider laying it down.` });
    const loose = s.objects.filter((o) => o.hole && o.visible !== false).length;
    if (loose) res.checks.push({ level: 'warn', text: `${loose} hole${loose > 1 ? 's are' : ' is'} not grouped with a solid, so nothing is cut. Group them in Design.` });
    const many = res.parts.filter((p) => p.genus < 0); void many;
    if (!res.checks.length) res.checks.push({ level: 'ok', text: 'Everything fits, sits on the plate and has no steep overhangs.' });
    // estimate
    const mat = MATERIALS[set.material] || MATERIALS.pla; const shellT = set.walls * LINE_W;
    const shell = Math.min(res.volume, res.area * shellT * 0.85); const infill = Math.max(0, res.volume - shell) * (set.infill / 100);
    const used = shell + infill; const grams = used / 1000 * mat.density; const meters = used / (Math.PI * 0.875 * 0.875) / 1000;
    const layers = Math.ceil(res.maxZ / set.layer); const flow = 11 * mat.speed * (set.layer / 0.2);
    const seconds = used / Math.max(1, flow) + layers * 4 + (res.parts.length ? 180 : 0);
    res.est = { grams, meters, seconds, cost: grams / 1000 * mat.price, layers };
    st.results = res; return res;
  }
  const names = (list) => { const n = list.map((p) => `“${p.o.name}”`); return n.length > 2 ? `${n.slice(0, 2).join(', ')} and ${n.length - 2} more` : n.join(' and '); };
  let timer = null;
  function schedule() { if (app.mode !== 'prepare') return; clearTimeout(timer); timer = setTimeout(() => { analyse(); render(); updateLayerBar(); }, 120); }

  // ---------------------------------------------------------- actions
  function rotateWorld(o, R) {
    const s = app.scene;
    o.rot = eulerFromMatrix(mul(R, eulerMatrix(o.rot)));
    const nb = s.worldBox(o); o.pos = [o.pos[0], o.pos[1], o.pos[2] - nb.min[2]];
  }
  function layFlat(list) {
    const s = app.scene; if (!list.length) return;
    s.edit('lay flat', () => { for (const o of list) { const man = worldManifold(o); const hull = man.hull(); const faces = flatFaces(hull, 1); free(hull); free(man); if (!faces.length) continue; rotateWorld(o, rotBetween(faces[0].n, [0, 0, -1])); } });
    app.toast(`Laid ${list.length} part${list.length > 1 ? 's' : ''} on ${list.length > 1 ? 'their' : 'its'} largest flat face`);
  }
  function autoOrient(list) {
    const s = app.scene; if (!list.length) return; const cosLimit = Math.cos((90 - settings().overhang) * Math.PI / 180); let changed = 0;
    s.edit('auto-orient', () => {
      for (const o of list) {
        const man = worldManifold(o); const hull = man.hull(); const cands = flatFaces(hull, 10).map((f) => f.n); free(hull);
        for (const d of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) cands.push(d);
        const m = man.getMesh(); free(man); let best = null;
        for (const n of cands) {
          const R = rotBetween(n, [0, 0, -1]); const r = overhangOf(m.vertProperties, m.numProp, m.triVerts, R, cosLimit);
          const score = r.area + r.height * 1.5 - Math.min(r.contact, 400) * 0.6;
          if (!best || score < best.score - 1e-6) best = { R, score, n };
        }
        const cur = overhangOf(m.vertProperties, m.numProp, m.triVerts, rotBetween([0, 0, -1], [0, 0, -1]), cosLimit);
        const curScore = cur.area + cur.height * 1.5 - Math.min(cur.contact, 400) * 0.6;
        if (best && best.score < curScore - 1) { rotateWorld(o, best.R); changed++; }
      }
    });
    app.toast(changed ? `Re-oriented ${changed} part${changed > 1 ? 's' : ''} for fewer overhangs` : 'Already in the best orientation found');
  }
  function arrange() {
    const s = app.scene; const bed = app.view.r.bed; const gap = 6; const list = s.objects.filter((o) => o.visible !== false && !o.hole);
    const items = list.map((o) => ({ o, b: s.worldBox(o) })).filter((x) => x.b).map((x) => ({ ...x, w: x.b.max[0] - x.b.min[0], d: x.b.max[1] - x.b.min[1] })).sort((a, b) => b.d - a.d || b.w - a.w);
    if (!items.length) return;
    let x = 0, y = 0, rowD = 0; const rows = [[]]; const maxW = bed.w - 2 * gap;
    for (const it of items) { if (x > 0 && x + it.w > maxW) { y += rowD + gap; x = 0; rowD = 0; rows.push([]); } it.px = x; it.py = y; x += it.w + gap; rowD = Math.max(rowD, it.d); rows[rows.length - 1].push(it); }
    const totalD = y + rowD; const totalW = Math.max(...items.map((i) => i.px + i.w));
    s.edit('auto-arrange', () => { for (const it of items) { const tx = -totalW / 2 + it.px + it.w / 2, ty = totalD / 2 - it.py - it.d / 2; const cx = (it.b.min[0] + it.b.max[0]) / 2, cy = (it.b.min[1] + it.b.max[1]) / 2; it.o.pos = [it.o.pos[0] + tx - cx, it.o.pos[1] + ty - cy, it.o.pos[2] - it.b.min[2]]; } });
    app.toast(totalD > bed.d ? 'Arranged, but it does not all fit on one plate. Export in batches.' : `Arranged ${items.length} part${items.length > 1 ? 's' : ''}`);
    app.view.fit();
  }

  // ---------------------------------------------------------- panel
  function render() { if (app.mode === 'prepare') app.refresh(); }
  app.prepPanel = () => {
    const s = app.scene; const set = settings(); const r = st.results || analyse(); const e = r.est;
    const time = e.seconds >= 3600 ? `${Math.floor(e.seconds / 3600)} h ${String(Math.round((e.seconds % 3600) / 60)).padStart(2, '0')} m` : `${Math.max(1, Math.round(e.seconds / 60))} min`;
    const target = s.selection.size ? s.selected().filter((o) => !o.hole) : s.objects.filter((o) => o.visible !== false && !o.hole);
    const upd = (k, v) => { s.edit('print settings', () => { set[k] = v; }); };
    const printerSel = h('select', { 'aria-label': 'Printer', onchange: (ev) => { s.edit('printer', () => { set.printer = ev.target.value; }); app.applyPrinter(); app.view.fit(); } },
      ...[...new Set(PRINTERS.map((p) => p.vendor))].map((v) => h('optgroup', { label: v }, ...PRINTERS.filter((p) => p.vendor === v).map((p) => h('option', { value: p.id, selected: p.id === set.printer }, p.model)))));
    const fixBtn = (c) => c.fix && h('button', { class: 'btn', style: { marginTop: '4px', padding: '2px 8px' }, onclick: () => { const all = r.parts.map((p) => p.o); if (c.fix === 'drop') s.dropToPlate(all); if (c.fix === 'flat') layFlat(all); if (c.fix === 'orient') autoOrient(all); } }, { drop: 'Drop to plate', flat: 'Lay flat', orient: 'Auto-orient' }[c.fix]);
    return [
      h('h3', {}, 'Prepare to print'),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', {}, `${fmt(e.grams, 0)} g`), h('span', {}, `${MATERIALS[set.material].label}, ${fmt(e.meters, 1)} m`)),
        h('div', { class: 'stat' }, h('b', {}, `≈ ${time}`), h('span', {}, `${e.layers} layers`)),
        h('div', { class: 'stat' }, h('b', {}, `${fmt(e.cost, 2)}`), h('span', {}, `filament cost at ${MATERIALS[set.material].price}/kg`)),
        h('div', { class: 'stat' }, h('b', {}, String(r.parts.length)), h('span', {}, r.parts.length === 1 ? 'part' : 'parts'))),
      h('p', { class: 'note' }, 'A rough estimate from volume, walls and infill. Your slicer gives the final numbers.'),
      h('fieldset', {}, h('legend', {}, 'Print check'), h('ul', { class: 'check-list' }, ...r.checks.map((c) => h('li', { class: c.level }, h('span', { class: 'dot' }), h('span', {}, c.text, h('br'), fixBtn(c)))))),
      h('fieldset', {}, h('legend', {}, s.selection.size ? `Selected (${target.length})` : 'All parts'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => layFlat(target), title: 'Turn each part so its largest flat face sits on the plate' }, 'Lay flat'),
          h('button', { class: 'btn', onclick: () => autoOrient(target), title: 'Try many orientations and keep the one with the least overhang' }, 'Auto-orient'),
          h('button', { class: 'btn', onclick: arrange, title: 'Pack all parts on the plate with 6 mm gaps' }, 'Auto-arrange'),
          h('button', { class: 'btn', onclick: () => s.dropToPlate(target) }, 'Drop to plate'))),
      h('fieldset', {}, h('legend', {}, 'Overhangs'),
        h('label', { class: 'row' }, h('span', {}, 'Show in red'), h('input', { type: 'checkbox', checked: app.view.showOverhang, style: { justifySelf: 'end' }, onchange: (ev) => { app.view.showOverhang = ev.target.checked; app.view.redraw(); } })),
        row('Limit from vertical', numField(set.overhang, (v) => { upd('overhang', v); app.view.redraw(); }, { min: 10, max: 80, step: 5, int: true }), '°')),
      h('fieldset', {}, h('legend', {}, 'Printer and settings'), printerSel,
        row('Material', h('select', { onchange: (ev) => upd('material', ev.target.value) }, ...Object.entries(MATERIALS).map(([k, m]) => h('option', { value: k, selected: k === set.material }, m.label)))),
        row('Layer height', h('select', { onchange: (ev) => upd('layer', +ev.target.value) }, ...[0.08, 0.12, 0.16, 0.2, 0.24, 0.28].map((v) => h('option', { value: v, selected: v === set.layer }, `${v} mm`)))),
        row('Walls', numField(set.walls, (v) => upd('walls', v), { min: 1, max: 10, int: true })),
        row('Infill', numField(set.infill, (v) => upd('infill', v), { min: 0, max: 100, step: 5, int: true }), '%')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary wide', onclick: () => app.export('3mf') }, 'Export 3MF for your slicer'),
        h('button', { class: 'btn', onclick: () => app.export('stl') }, 'Export STL'),
        h('button', { class: 'btn', onclick: () => app.export('parts') }, 'Parts as STLs')),
      h('p', { class: 'note' }, 'The 3MF opens in Bambu Studio, OrcaSlicer, PrusaSlicer and Cura with each part and colour kept separate.'),
    ];
  };

  // ---------------------------------------------------------- layer slider
  const slider = document.getElementById('layerSlider'); const out = document.getElementById('layerOut');
  function updateLayerBar() {
    const r = st.results; if (!r) return; const n = Math.max(1, r.est.layers); slider.max = String(n);
    if (st.layer == null || st.layer > n) { st.layer = n; slider.value = String(n); }
    setLayer(+slider.value);
  }
  function setLayer(i) {
    const n = +slider.max; const set = settings(); st.layer = i;
    if (i >= n) { app.view.r.clipZ = 1e9; out.textContent = 'all layers'; }
    else { const z = i * set.layer; app.view.r.clipZ = z; out.textContent = `${i} / ${n} · ${fmt(z, 2)} mm`; }
    app.view.redraw();
  }
  slider.addEventListener('input', () => setLayer(+slider.value));
  app.on('mode', (m) => { if (m === 'prepare') { st.results = null; analyse(); updateLayerBar(); } else { app.view.r.clipZ = 1e9; } });
  app.on('change', schedule);
  app.prepAnalyse = analyse; app.layFlat = layFlat; app.autoOrient = autoOrient; app.arrange = arrange;
  void geomKey;
}
