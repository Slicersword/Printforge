// Mold generator (after usestl's mold tool): turn any part into a printable mold.
//  - Two-part rigid mold: block split at the widest point, alignment pins, pour spout, air vents and clamp ears.
//  - Silicone mold box: walls and floor around the part (a "mold box" you pour silicone into); optionally splits in two.
//  - Multi-cavity tray: N × M copies of the part sunk into a tray, for ice, chocolate, soap or resin.
// Plus the full cost calculator (filament, electricity, printer wear, labour, failures and margin).
import { K, worldManifold, free } from './kernel.js';
import { h, row, numField } from './ui.js';
import { MATERIALS } from './printers.js';

function xyzOnly(m) { const np = m.numProp, vp = m.vertProperties; if (np === 3) return new Float32Array(vp); const n = vp.length / np, out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { out[i * 3] = vp[i * np]; out[i * 3 + 1] = vp[i * np + 1]; out[i * 3 + 2] = vp[i * np + 2]; } return out; }

/** Height where the part is widest (largest cross-section): the natural parting line. */
export function widestZ(man) {
  const b = man.boundingBox(); let best = (b.min[2] + b.max[2]) / 2, bestA = -1;
  for (let i = 1; i < 40; i++) { const z = b.min[2] + (b.max[2] - b.min[2]) * i / 40; const a = man.slice(z).area(); if (a > bestA + 1e-6) { bestA = a; best = z; } }
  return best;
}

export function makeMold(part, o) {
  const M = K.Manifold; const b = part.boundingBox();
  const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const m = o.margin; const out = [];
  if (o.type === 'two-part') {
    const zp = o.parting === 'auto' ? widestZ(part) : b.min[2] + sz * (o.partPct / 100);
    const bw = sx + 2 * m, bd = sy + 2 * m, z0 = b.min[2] - m, z1 = b.max[2] + m;
    const block = M.cube([bw, bd, z1 - z0]).translate([cx - bw / 2, cy - bd / 2, z0]);
    const below = M.cube([bw + 2, bd + 2, zp - z0 + 1]).translate([cx - bw / 2 - 1, cy - bd / 2 - 1, z0 - 1]);
    let bottom = block.intersect(below).subtract(part);
    let top = block.subtract(below).subtract(part);
    // alignment pins: half-spheres on the bottom half, matching sockets (with clearance) in the top half
    const pr = Math.min(3, m * 0.35), px = bw / 2 - m / 2, py = bd / 2 - m / 2;
    const pins = [[-1, -1], [1, 1], [1, -1], [-1, 1]].slice(0, o.pins).map(([a, c]) => [cx + a * px, cy + c * py]);
    for (const [x, y] of pins) {
      const ball = M.sphere(pr, 24).translate([x, y, zp]);
      bottom = bottom.add(ball.intersect(M.cube([pr * 2, pr * 2, pr], false).translate([x - pr, y - pr, zp])));
      top = top.subtract(M.sphere(pr + o.clr, 24).translate([x, y, zp]));
    }
    // pour spout above the highest point, plus vents at the two ends
    const sp = o.spout / 2; const topC = [cx, cy];
    top = top.subtract(M.cylinder(z1 - b.max[2] + 2, sp * 0.6, sp * 1.4, 32).translate([topC[0], topC[1], b.max[2] - 1]));
    if (o.vents) for (const s of [-1, 1]) top = top.subtract(M.cylinder(z1 - zp + 2, 0.9, 0.9, 16).translate([cx + s * (sx / 2 - Math.min(2, sx / 6)), cy, zp - 0.5]));
    // clamp ears with bolt holes (M4) on both halves
    if (o.ears) {
      const ew = 12, et = Math.min(6, (zp - z0) * 0.8, (z1 - zp) * 0.8);
      const ear = (z, up) => M.union([-1, 1].map((s) => M.cube([ew, Math.min(24, bd * 0.5), et]).translate([s > 0 ? cx + bw / 2 - 0.01 : cx - bw / 2 - ew + 0.01, cy - Math.min(24, bd * 0.5) / 2, up ? z : z - et])
        .subtract(M.cylinder(et + 2, 2.2, 2.2, 24).translate([cx + s * (bw / 2 + ew / 2), cy, (up ? z : z - et) - 1]))));
      bottom = bottom.add(ear(zp, false)); top = top.add(ear(zp, true));
    }
    // print each half with its parting face down: bottom half flipped, top half as is; lay side by side
    const bh = bottom.rotate([180, 0, 0]); const bb = bh.boundingBox(), tb = top.boundingBox();
    out.push({ name: 'Mold bottom half', man: bh.translate([-bb.min[0], -bb.min[1], -bb.min[2]]) });
    out.push({ name: 'Mold top half (with spout)', man: top.translate([-tb.min[0] + (bb.max[0] - bb.min[0]) + 10, -tb.min[1], -tb.min[2]]) });
  } else if (o.type === 'box') {
    const w = o.wall; const bw = sx + 2 * m + 2 * w, bd = sy + 2 * m + 2 * w, H = sz + m + w;
    const outer = M.cube([bw, bd, H]).translate([cx - bw / 2, cy - bd / 2, b.min[2] - w]);
    const inner = M.cube([bw - 2 * w, bd - 2 * w, H]).translate([cx - bw / 2 + w, cy - bd / 2 + w, b.min[2]]);
    let box = outer.subtract(inner);
    if (o.splitBox) {
      // two L-shaped halves held with screws: easier to get the cured silicone out
      const half = M.cube([bw / 2 + 1, bd + 2, H + 2]).translate([cx - bw / 2 - 1, cy - bd / 2 - 1, b.min[2] - w - 1]);
      const a = box.intersect(half), c = box.subtract(half);
      const ab = a.boundingBox(); const cb = c.boundingBox();
      out.push({ name: 'Mold box half A', man: a.translate([-ab.min[0], -ab.min[1], -ab.min[2]]) });
      out.push({ name: 'Mold box half B', man: c.translate([-cb.min[0] + (ab.max[0] - ab.min[0]) + 10, -cb.min[1], -cb.min[2]]) });
    } else { const bb = box.boundingBox(); out.push({ name: 'Silicone mold box', man: box.translate([-bb.min[0], -bb.min[1], -bb.min[2]]) }); }
  } else {
    const gx = Math.max(1, o.cols | 0), gy = Math.max(1, o.rows | 0), gap = o.gap;
    const tw = gx * sx + (gx - 1) * gap + 2 * m, td = gy * sy + (gy - 1) * gap + 2 * m, th = sz * o.depthPct / 100 + o.floor;
    const tray = M.cube([tw, td, th]);
    const cav = [];
    // part sunk so its top sits at the tray surface: the cavity opens upward
    const sink = part.translate([-b.min[0], -b.min[1], th - b.max[2] + 0.01]);
    for (let i = 0; i < gx; i++) for (let j = 0; j < gy; j++) cav.push(sink.translate([m + i * (sx + gap), m + j * (sy + gap), 0]));
    out.push({ name: `Mold tray ${gx}×${gy}`, man: tray.subtract(M.union(cav)) });
  }
  return out;
}

function openMold(app) {
  const s = app.scene; const sel = s.selected().filter((x) => !x.hole);
  if (sel.length !== 1) { app.toast('Mold: select the one part you want to cast first.'); return; }
  const src = sel[0];
  const o = { type: 'two-part', margin: 10, parting: 'auto', partPct: 50, pins: 4, clr: 0.3, spout: 8, vents: true, ears: true, wall: 2, splitBox: false, cols: 3, rows: 2, gap: 6, floor: 3, depthPct: 100 };
  const body = h('div', { class: 'mold-form' }); const info = h('p', { class: 'note' });
  const typeSeg = h('div', { class: 'seg' }, ...[['two-part', 'Two-part rigid'], ['box', 'Silicone box'], ['tray', 'Multi-cavity tray']].map(([v, l]) => h('button', { 'aria-pressed': String(o.type === v), onclick: (e) => { o.type = v; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); render(); } }, l)));
  const num = (label, key, opts) => row(label, numField(o[key], (v) => { o[key] = v; }, opts));
  const chk = (label, key) => row(label, h('input', { type: 'checkbox', checked: o[key], style: { justifySelf: 'end' }, onchange: (e) => { o[key] = e.target.checked; } }));
  const render = () => {
    const f = [];
    if (o.type === 'two-part') {
      f.push(h('p', { class: 'note' }, 'For plaster, candle wax, soap or resin. Two halves with alignment pins, a pour spout and clamp ears.'),
        num('Wall around the part', 'margin', { min: 3, max: 60 }),
        row('Parting line', h('select', { onchange: (e) => { o.parting = e.target.value; render(); } }, h('option', { value: 'auto', selected: o.parting === 'auto' }, 'Widest point (auto)'), h('option', { value: 'pct', selected: o.parting === 'pct' }, 'Set height'))),
        o.parting === 'pct' ? num('Height (% of part)', 'partPct', { min: 5, max: 95 }) : null,
        num('Alignment pins', 'pins', { min: 0, max: 4, int: true }), num('Pin clearance', 'clr', { min: 0, max: 1, step: 0.05 }), num('Spout diameter', 'spout', { min: 3, max: 40 }), chk('Air vents', 'vents'), chk('Clamp ears (M4)', 'ears'));
    } else if (o.type === 'box') {
      f.push(h('p', { class: 'note' }, 'For silicone. Glue the master to the floor, pour silicone over it, then cast resin into the silicone.'),
        num('Space around the part', 'margin', { min: 3, max: 60 }), num('Box wall', 'wall', { min: 1, max: 6, step: 0.2 }), chk('Split the box in two', 'splitBox'));
    } else {
      f.push(h('p', { class: 'note' }, 'For ice, chocolate, soap or resin. The cavity opens at the top, so the part’s top should be its widest side.'),
        num('Columns', 'cols', { min: 1, max: 20, int: true }), num('Rows', 'rows', { min: 1, max: 20, int: true }), num('Gap between cavities', 'gap', { min: 1, max: 40 }),
        num('Border', 'margin', { min: 2, max: 40 }), num('Floor under cavities', 'floor', { min: 0.8, max: 20, step: 0.2 }), num('Cavity depth (% of part)', 'depthPct', { min: 10, max: 100 }));
    }
    body.replaceChildren(...f.filter(Boolean));
  };
  const make = () => {
    let part;
    try { part = worldManifold(src); } catch (e) { info.textContent = `This part can’t be used: ${e.message}`; return; }
    try {
      const res = makeMold(part, o); const made = [];
      const right = Math.max(...s.objects.map((x) => s.worldBox(x)?.max[0] ?? 0)) + 15;
      s.edit('make mold', () => {
        for (const r of res) {
          if (r.keepPos) continue; const mesh = r.man.getMesh();
          const obj = app.addMesh(`${src.name} · ${r.name}`, xyzOnly(mesh), mesh.triVerts, o.type === 'tray' ? '#7FB3D5' : '#D9D3C7');
          s.objects.push(obj); made.push(obj);
        }
        // find a free spot on the plate for each piece (beside the part when there is room)
        for (const obj of made) { s.objects.splice(s.objects.indexOf(obj), 1); const bb = s.worldBox(obj); const at = app.spawnPoint(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]); obj.pos = [obj.pos[0] + at[0] - (bb.min[0] + bb.max[0]) / 2, obj.pos[1] + at[1] - (bb.min[1] + bb.max[1]) / 2, obj.pos[2] - bb.min[2]]; s.objects.push(obj); }
        void right;
        s.selection = new Set(made.map((m) => m.id));
      });
      res.forEach((r) => { if (!r.keepPos) free(r.man); }); free(part);
      s.emit('select'); app.view.fit(); d.close();
      app.toast(`Made ${made.length} mold part${made.length === 1 ? '' : 's'} from ${src.name}.`);
    } catch (e) { info.textContent = `The mold couldn’t be made: ${e.message}`; free(part); }
  };
  const d = app.modal(`Mold from “${src.name}”`, h('div', { class: 'maker-side', style: { minWidth: '320px' } }, typeSeg, body, info),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: make }, 'Make mold')));
  render();
}

// ---------------------------------------------------------------- cost calculator
const COST_KEY = 'printforge.cost';
export function costOf(c) {
  const filament = c.grams / 1000 * c.spool;
  const power = c.hours * c.watts / 1000 * c.kwh;
  const wear = c.hours * (c.printerPrice / Math.max(1, c.printerLife) + c.upkeep);
  const labour = c.labourMin / 60 * c.rate;
  const base = filament + power + wear + labour + c.extras;
  const withFail = base / Math.max(0.01, 1 - c.fail / 100);
  const price = withFail * (1 + c.margin / 100);
  return { filament, power, wear, labour, extras: c.extras, failures: withFail - base, cost: withFail, price, profit: price - withFail, perPiece: price / Math.max(1, c.qty) };
}
export function openCost(app, est) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(COST_KEY) || '{}'); } catch { /* private mode */ }
  const mat = MATERIALS[app.scene.settings.material] || MATERIALS.pla;
  const c = { currency: '$', spool: mat.price, watts: 120, kwh: 0.15, printerPrice: 600, printerLife: 5000, upkeep: 0.05, rate: 15, labourMin: 10, extras: 0, fail: 10, margin: 30, qty: 1, ...saved, grams: est?.grams ? +est.grams.toFixed(1) : (saved.grams || 50), hours: est?.seconds ? +(est.seconds / 3600).toFixed(2) : (saved.hours || 3) };
  const out = h('div', { class: 'cost-out' });
  const save = () => { try { const { grams, hours, ...rest } = c; localStorage.setItem(COST_KEY, JSON.stringify(rest)); } catch { /* ignore */ } };
  const money = (v) => `${c.currency}${v.toFixed(2)}`;
  const calc = () => {
    const r = costOf(c); save();
    out.replaceChildren(
      ...[['Filament', r.filament], ['Electricity', r.power], ['Printer wear and upkeep', r.wear], ['Your time', r.labour], ['Extras (magnets, inserts, packaging)', r.extras], [`Failed prints (${c.fail}%)`, r.failures]].map(([l, v]) => h('div', { class: 'cost-line' }, h('span', {}, l), h('b', {}, money(v)))),
      h('div', { class: 'cost-line total' }, h('span', {}, 'Cost to make'), h('b', {}, money(r.cost))),
      h('div', { class: 'cost-line price' }, h('span', {}, `Selling price (+${c.margin}%)`), h('b', {}, money(r.price))),
      ...(c.qty > 1 ? [h('div', { class: 'cost-line' }, h('span', {}, `Per piece (${c.qty} in this print)`), h('b', {}, money(r.perPiece)))] : []),
      h('div', { class: 'cost-line' }, h('span', {}, 'Profit'), h('b', {}, money(r.profit))));
  };
  const f = (label, key, opts = {}, unit = '') => row(label, numField(c[key], (v) => { c[key] = v; calc(); }, opts), unit);
  const sec = (title, ...kids) => h('fieldset', {}, h('legend', {}, title), ...kids);
  const cur = h('input', { type: 'text', value: c.currency, style: { width: '4em', justifySelf: 'end' }, onkeydown: (e) => e.stopPropagation(), oninput: (e) => { c.currency = e.target.value; calc(); } });
  const d = app.modal('Cost calculator', h('div', { class: 'cost' },
    h('div', { class: 'cost-in' },
      est ? h('p', { class: 'note' }, 'Weight and time come from the print estimate. Change them if your slicer says otherwise.') : h('p', { class: 'note' }, 'Enter the weight and time from your slicer.'),
      sec('This print', f('Filament used', 'grams', { min: 0, step: 1 }, 'g'), f('Print time', 'hours', { min: 0, step: 0.25 }, 'h'), f('Pieces in this print', 'qty', { min: 1, int: true })),
      sec('Costs', row('Currency', cur), f('Spool price per kg', 'spool', { min: 0 }), f('Printer power', 'watts', { min: 0 }, 'W'), f('Electricity per kWh', 'kwh', { min: 0, step: 0.01 }),
        f('Printer price', 'printerPrice', { min: 0 }), f('Printer lifetime', 'printerLife', { min: 100 }, 'h'), f('Upkeep per hour', 'upkeep', { min: 0, step: 0.01 })),
      sec('Selling', f('Your time', 'labourMin', { min: 0 }, 'min'), f('Hourly rate', 'rate', { min: 0 }), f('Extras', 'extras', { min: 0, step: 0.1 }), f('Failure rate', 'fail', { min: 0, max: 90 }, '%'), f('Profit margin', 'margin', { min: 0, max: 1000 }, '%'))),
    out), h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', onclick: () => d.close() }, 'Done')));
  d.classList.add('wide'); calc();
}

export function install(app) {
  app.openMold = () => openMold(app);
  app.openCost = (est) => openCost(app, est);
  app.addAction({ label: 'Mold generator', group: 'Tools', run: () => openMold(app) });
  app.addAction({ label: 'Cost calculator', group: 'Tools', run: () => openCost(app, app.lastEstimate) });
}
