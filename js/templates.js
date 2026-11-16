// Templates (in the spirit of ParamaCraft Lite): everyday printable objects you shape with sliders.
// Pick a template, move the sliders, check the preview, export. All geometry written for PrintForge (MIT).
import { registerKind, K } from './kernel.js';
import { h } from './ui.js';
import { addModel } from './models.js';

const n = (key, label, def, min, max, step = 0.5, unit = 'mm') => ({ key, label, type: 'num', def, min, max, step, unit });
const int = (key, label, def, min, max) => ({ key, label, type: 'int', def, min, max, step: 1, unit: '' });
const sel = (key, label, def, options) => ({ key, label, type: 'select', def, options });
const bool = (key, label, def) => ({ key, label, type: 'bool', def });
const rr = (w, d, r) => { r = Math.max(0.01, Math.min(r, w / 2 - 0.01, d / 2 - 0.01)); return K.CrossSection.square([w - 2 * r, d - 2 * r], true).offset(r, 'Round', 2, 32); };
const cyl = (hgt, r1, r2 = r1, seg = 64) => K.Manifold.cylinder(hgt, r1, r2, seg);

// ---------------------------------------------------------------- divided tray
registerKind('tpl_tray', {
  label: 'Divided tray',
  params: [n('w', 'Width', 160, 20, 400, 1), n('d', 'Depth', 100, 20, 400, 1), n('h', 'Height', 30, 5, 150, 1), n('wall', 'Wall', 1.6, 0.8, 6, 0.1), n('floor', 'Floor', 1.6, 0.8, 6, 0.1),
    int('cols', 'Compartments across', 3, 1, 12), int('rows', 'Compartments deep', 2, 1, 12), n('div', 'Divider thickness', 1.2, 0.6, 5, 0.1), n('r', 'Corner radius', 6, 0, 30, 0.5), n('scoop', 'Inner rounding', 4, 0, 20, 0.5)],
  build: (p) => {
    const M = K.Manifold; let tray = rr(p.w, p.d, p.r).extrude(p.h);
    const iw = p.w - 2 * p.wall, id = p.d - 2 * p.wall; const cw = (iw - (p.cols - 1) * p.div) / p.cols, cd = (id - (p.rows - 1) * p.div) / p.rows;
    if (cw < 2 || cd < 2) throw new Error('Too many compartments for this size.');
    const pockets = [];
    for (let i = 0; i < p.cols; i++) for (let j = 0; j < p.rows; j++) {
      const x = -iw / 2 + cw / 2 + i * (cw + p.div), y = -id / 2 + cd / 2 + j * (cd + p.div); const rad = Math.min(p.scoop, cw / 2 - 0.1, cd / 2 - 0.1);
      // rounded bottom edges make small parts easy to scoop out
      let pk = rad > 0.2 ? M.hull([rr(cw - 2 * rad, cd - 2 * rad, Math.max(0.01, Math.min(p.r, 3) - rad)).extrude(0.01).translate([0, 0, p.floor]), rr(cw, cd, Math.min(p.r, 3)).extrude(p.h).translate([0, 0, p.floor + rad])]) : rr(cw, cd, Math.min(p.r, 3)).extrude(p.h).translate([0, 0, p.floor]);
      pockets.push(pk.translate([x, y, 0]));
    }
    tray = tray.subtract(M.union(pockets));
    return tray;
  },
});

// ---------------------------------------------------------------- box with lid (two linked parts)
registerKind('tpl_box', {
  label: 'Box with lid', keepOrigin: true,
  params: [n('w', 'Width', 80, 15, 300, 1), n('d', 'Depth', 60, 15, 300, 1), n('h', 'Height', 40, 8, 300, 1), n('wall', 'Wall', 1.8, 0.8, 6, 0.1), n('r', 'Corner radius', 4, 0, 30, 0.5),
    sel('lid', 'Lid', 'press', [['press', 'Press-fit with a lip'], ['slide', 'Sliding']]), n('lidH', 'Lid height', 8, 2, 60, 0.5), n('clr', 'Fit clearance', 0.25, 0.05, 1, 0.05),
    sel('layout', 'Show', 'separate', [['assembled', 'Assembled'], ['separate', 'Separate parts (to print)']]), sel('part', 'This object is the', 'box', [['box', 'Box'], ['lid', 'Lid']])],
  build: (p) => {
    const M = K.Manifold; const { w, d, h: H, wall, r, clr } = p; const sep = p.layout === 'separate';
    if (p.lid === 'press') {
      const lip = Math.max(wall / 2, 0.8), lipH = Math.min(6, p.lidH - 1);
      if (p.part === 'box') {
        const body = rr(w, d, r).extrude(H - p.lidH).subtract(rr(w - 2 * wall, d - 2 * wall, Math.max(0.01, r - wall)).extrude(H).translate([0, 0, wall]));
        const lipRing = rr(w - 2 * (wall - lip), d - 2 * (wall - lip), Math.max(0.01, r - wall + lip)).subtract(rr(w - 2 * wall, d - 2 * wall, Math.max(0.01, r - wall))).extrude(lipH).translate([0, 0, H - p.lidH - 0.01]);
        return body.add(lipRing);
      }
      const lid = rr(w, d, r).extrude(p.lidH).subtract(rr(w - 2 * (wall - lip) + 2 * clr, d - 2 * (wall - lip) + 2 * clr, Math.max(0.01, r - wall + lip)).extrude(lipH + clr).translate([0, 0, -0.01]))
        .subtract(rr(w - 2 * wall, d - 2 * wall, Math.max(0.01, r - wall)).extrude(p.lidH - wall).translate([0, 0, -0.02]));
      return sep ? lid.rotate([180, 0, 0]).translate([w + 10, 0, p.lidH]) : lid.translate([0, 0, H - p.lidH]);
    }
    // sliding lid: grooves along the top of the long walls, lid slides in from the front
    const gD = Math.min(wall * 0.6, 1.2), lidT = 1.6;
    if (p.part === 'box') {
      let body = rr(w, d, r).extrude(H).subtract(rr(w - 2 * wall, d - 2 * wall, Math.max(0.01, r - wall)).extrude(H).translate([0, 0, wall]));
      const groove = M.hull([M.cube([w - 2 * wall + 2 * gD, d - wall + 1, 0.01]).translate([-(w - 2 * wall + 2 * gD) / 2, -d / 2 - 1, H - 1.2 - lidT]), M.cube([w - 2 * wall, d - wall + 1, 0.01]).translate([-(w - 2 * wall) / 2, -d / 2 - 1, H - 1.2])]);
      body = body.subtract(groove).subtract(M.cube([w - 2 * wall, wall + 2, 2]).translate([-(w - 2 * wall) / 2, -d / 2 - 1, H - 1.2 - 0.01]));
      return body;
    }
    const lw = w - 2 * wall + 2 * gD - 2 * clr, ld = d - wall - clr;
    const lid = M.hull([M.cube([lw, ld, 0.01]).translate([-lw / 2, -ld / 2, 0]), M.cube([lw - 2 * gD, ld, 0.01]).translate([-(lw - 2 * gD) / 2, -ld / 2, lidT - 0.01])])
      .add(M.cube([lw * 0.3, 1.2, 1]).translate([-lw * 0.15, -ld / 2 + 3, lidT - 0.01])); // finger ridge
    return sep ? lid.translate([w + 10, 0, 0]) : lid.translate([0, wall / 2 - clr / 2, H - 1.2 - lidT]);
  },
  note: 'Press-fit: the lip on the box holds the lid. Sliding: the lid slides into grooves from the open front.',
});

// ---------------------------------------------------------------- spacer / washer
registerKind('tpl_spacer', {
  label: 'Spacer / washer',
  params: [sel('shape', 'Shape', 'round', [['round', 'Round'], ['hex', 'Hexagonal'], ['square', 'Square']]), n('od', 'Outside size', 12, 3, 200, 0.5), n('id', 'Hole', 5.3, 0, 190, 0.1), n('t', 'Thickness', 5, 0.4, 200, 0.2),
    n('chamfer', 'Chamfer', 0.4, 0, 3, 0.1), int('count', 'How many', 1, 1, 64)],
  build: (p) => {
    if (p.id >= p.od - 0.8) throw new Error('The hole is too big for the outside size.');
    const seg = p.shape === 'hex' ? 6 : p.shape === 'square' ? 4 : 96; const R = p.shape === 'square' ? p.od / Math.SQRT2 : p.od / 2;
    const c = Math.min(p.chamfer, p.t / 3); const M = K.Manifold;
    let one = c > 0 ? M.union([cyl(c, R - c, R, seg).rotate([0, 0, seg === 4 ? 45 : 0]), cyl(p.t - 2 * c, R, R, seg).translate([0, 0, c]).rotate([0, 0, seg === 4 ? 45 : 0]), cyl(c, R, R - c, seg).translate([0, 0, p.t - c]).rotate([0, 0, seg === 4 ? 45 : 0])]) : cyl(p.t, R, R, seg).rotate([0, 0, seg === 4 ? 45 : 0]);
    if (p.id > 0) one = one.subtract(cyl(p.t + 2, p.id / 2, p.id / 2, 64).translate([0, 0, -1]));
    const k = Math.ceil(Math.sqrt(p.count)); const step = p.od + 4; const list = [];
    for (let i = 0; i < p.count; i++) list.push(one.translate([(i % k) * step, Math.floor(i / k) * step, 0]));
    return M.union(list);
  },
});

// ---------------------------------------------------------------- phone / tablet stand
registerKind('tpl_stand', {
  label: 'Phone or tablet stand',
  params: [n('dev', 'Device thickness (with case)', 11, 4, 40, 0.5), n('angle', 'Lean angle', 65, 45, 85, 1, '°'), n('w', 'Width', 70, 30, 300, 1), n('back', 'Back height', 90, 40, 250, 1),
    n('depth', 'Base depth', 90, 40, 250, 1), n('lip', 'Front lip', 14, 4, 40, 0.5), n('t', 'Thickness', 5, 2.5, 12, 0.5), bool('cable', 'Charging cable hole', true)],
  build: (p) => {
    const CS = K.CrossSection; const a = p.angle * Math.PI / 180; const t = p.t;
    // side profile in (y, z): base, front lip, slot and the leaning back
    const sx = p.depth * 0.32; const bx = sx + p.dev + t; const tx = bx + Math.cos(a) * p.back, tz = Math.sin(a) * p.back;
    const base = CS.square([p.depth, t]);
    const lip = CS.square([t, p.lip]).translate([sx - t, 0]);
    const thick = (x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), nx = -dz / L * t, nz = dx / L * t; return CS.ofPolygons([[[x0, z0], [x1, z1], [x1 + nx, z1 + nz], [x0 + nx, z0 + nz]]]); };
    const backC = thick(bx + t, 0, tx + t, tz);
    const brace = thick(p.depth - t, t, bx + t + Math.cos(a) * p.back * 0.55, Math.sin(a) * p.back * 0.55);
    let prof = CS.union([base, lip, backC, brace]).offset(-0.6, 'Round', 2, 12).offset(0.6, 'Round', 2, 12);
    let m = prof.extrude(p.w).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([-p.w / 2, -p.depth / 2, 0]);
    if (p.cable) m = m.subtract(K.Manifold.cube([12, p.dev + t * 2 + 4, t * 3]).translate([-6, -p.depth / 2 + sx - t - 2, -t]));
    return m;
  },
  note: 'Prints on its side with no supports. Measure your phone with its case for the slot.',
});

// ---------------------------------------------------------------- drawer dividers (slotted, interlocking)
registerKind('tpl_divider', {
  label: 'Drawer dividers',
  params: [n('lx', 'Long divider length', 300, 40, 600, 1), n('ly', 'Cross divider length', 200, 40, 600, 1), n('h', 'Height', 50, 10, 200, 1), n('t', 'Thickness', 2, 1, 6, 0.2),
    int('nx', 'Long dividers', 1, 0, 8), int('ny', 'Cross dividers', 2, 0, 8), n('clr', 'Slot clearance', 0.3, 0.05, 1, 0.05)],
  build: (p) => {
    const M = K.Manifold; const pieces = []; const sw = p.t + p.clr;
    // long dividers get slots from the top, cross dividers from the bottom, so they slide together
    const slotsX = Array.from({ length: p.ny }, (_, i) => -p.lx / 2 + p.lx * (i + 1) / (p.ny + 1)); const slotsY = Array.from({ length: p.nx }, (_, i) => -p.ly / 2 + p.ly * (i + 1) / (p.nx + 1));
    const plate = (L, slots, fromTop) => { let m = M.cube([L, p.h, p.t]).translate([-L / 2, 0, 0]); for (const s of slots) m = m.subtract(M.cube([sw, p.h / 2 + p.clr, p.t + 2]).translate([s - sw / 2, fromTop ? p.h / 2 - p.clr : -0.01, -1])); return m; };
    let y = 0;
    for (let i = 0; i < p.nx; i++) { pieces.push(plate(p.lx, slotsX, true).translate([0, y, 0])); y += p.h + 6; }
    for (let i = 0; i < p.ny; i++) { pieces.push(plate(p.ly, slotsY, false).translate([0, y, 0])); y += p.h + 6; }
    if (!pieces.length) throw new Error('Set at least one divider.');
    return M.union(pieces).translate([0, -y / 2, 0]);
  },
  note: 'Printed flat. Long dividers have slots from the top, cross dividers from the bottom: slide them together into a grid. Split long ones at your bed size.',
});

// ---------------------------------------------------------------- test tube rack
registerKind('tpl_rack', {
  label: 'Test tube rack',
  params: [n('tube', 'Tube diameter', 16, 4, 50, 0.5), int('cols', 'Columns', 6, 1, 20), int('rows', 'Rows', 2, 1, 10), n('gap', 'Space between tubes', 6, 2, 30, 0.5),
    n('h', 'Rack height', 60, 20, 200, 1), n('t', 'Plate thickness', 3, 1.6, 8, 0.2), n('clr', 'Tube clearance', 0.6, 0, 3, 0.1)],
  build: (p) => {
    const M = K.Manifold; const pitch = p.tube + p.gap; const W = p.cols * pitch + p.gap, D = p.rows * pitch + p.gap; const r = p.tube / 2 + p.clr;
    const holes = (depth, z, rr2 = r) => { const l = []; for (let i = 0; i < p.cols; i++) for (let j = 0; j < p.rows; j++) l.push(cyl(depth, rr2, rr2, 48).translate([-W / 2 + p.gap + pitch * (i + 0.5) - p.gap / 2, -D / 2 + p.gap + pitch * (j + 0.5) - p.gap / 2, z])); return M.union(l); };
    const plate = (z) => rr(W, D, 4).extrude(p.t).translate([0, 0, z]);
    let rack = plate(0).subtract(holes(p.t, p.t * 0.45, r * 0.9)); // shallow cups in the bottom plate
    rack = rack.add(plate(p.h - p.t).subtract(holes(p.t + 2, p.h - p.t - 1)));
    rack = rack.add(plate(p.h * 0.5).subtract(holes(p.t + 2, p.h * 0.5 - 1)));
    const post = (x, y) => K.CrossSection.square([4, 4], true).extrude(p.h).translate([x, y, 0]);
    rack = rack.add(M.union([post(-W / 2 + 3, -D / 2 + 3), post(W / 2 - 3, -D / 2 + 3), post(-W / 2 + 3, D / 2 - 3), post(W / 2 - 3, D / 2 - 3)]));
    return rack;
  },
  note: 'Three plates on four posts: holes at the top and middle, cups in the base. Bridges over the holes print fine without supports.',
});

// ---------------------------------------------------------------- cable guide
registerKind('tpl_cable', {
  label: 'Cable guide',
  params: [int('n', 'Cables', 4, 1, 20), n('d', 'Cable diameter', 6, 2, 25, 0.5), n('t', 'Wall', 2, 1.2, 5, 0.2), n('w', 'Depth', 14, 6, 60, 1), n('open', 'Snap opening', 0.75, 0.5, 0.95, 0.05, '× diameter'),
    sel('mount', 'Mount', 'screw', [['screw', 'Screw holes'], ['tape', 'Flat back for tape']])],
  build: (p) => {
    const CS = K.CrossSection; const M = K.Manifold; const r = p.d / 2, pitch = p.d + p.t, L = p.n * pitch + p.t + (p.mount === 'screw' ? 20 : 0);
    let prof = CS.square([L, r * 2 + p.t]).translate([-L / 2, 0]); // profile in (x, z), extruded along y
    for (let i = 0; i < p.n; i++) {
      const x = -p.n * pitch / 2 + pitch * (i + 0.5); const c = CS.circle(r, 48).translate([x, p.t + r]);
      prof = prof.subtract(c).subtract(CS.square([p.d * p.open, r * 2]).translate([x - p.d * p.open / 2, p.t + r]));
    }
    let m = prof.extrude(p.w).rotate([90, 0, 0]).translate([0, p.w / 2, 0]);
    if (p.mount === 'screw') for (const s of [-1, 1]) m = m.subtract(cyl(p.t + 2, 1.8, 1.8, 24).translate([s * (L / 2 - 5), 0, -1])).subtract(cyl(1.8, 1.8, 3.6, 24).translate([s * (L / 2 - 5), 0, p.t - 1.79]));
    return m;
  },
  note: 'Cables push in through the opening and snap in place. Make the opening smaller for a firmer grip.',
});

// ---------------------------------------------------------------- pipe / hose adapter
registerKind('tpl_adapter', {
  label: 'Hose / pipe adapter',
  params: [n('d1', 'End A outside diameter', 32, 4, 150, 0.5), n('l1', 'End A length', 25, 5, 100, 1), n('d2', 'End B outside diameter', 20, 4, 150, 0.5), n('l2', 'End B length', 25, 5, 100, 1),
    n('wall', 'Wall', 2, 1, 8, 0.2), n('trans', 'Taper length', 15, 3, 100, 1), bool('barbs', 'Barbs (for hoses)', true), bool('inside', 'End A fits inside a pipe (otherwise over it)', false)],
  build: (p) => {
    const M = K.Manifold; const r1 = p.d1 / 2, r2 = p.d2 / 2, w = p.wall;
    let outer = M.union([cyl(p.l1, r1, r1, 96), cyl(p.trans, r1, r2, 96).translate([0, 0, p.l1 - 0.01]), cyl(p.l2, r2, r2, 96).translate([0, 0, p.l1 + p.trans - 0.02])]);
    if (p.barbs) for (const [r, z0, L] of [[r1, 0, p.l1], [r2, p.l1 + p.trans, p.l2]]) for (let z = z0 + 3; z < z0 + L - 4; z += 6) outer = outer.add(cyl(4, r + 1, r, 96).translate([0, 0, z]));
    const inner = M.union([cyl(p.l1 + 0.02, r1 - w, r1 - w, 96).translate([0, 0, -0.01]), cyl(p.trans + 0.02, r1 - w, r2 - w, 96).translate([0, 0, p.l1 - 0.01]), cyl(p.l2 + 0.02, r2 - w, r2 - w, 96).translate([0, 0, p.l1 + p.trans - 0.01])]);
    if (r1 - w < 0.5 || r2 - w < 0.5) throw new Error('The wall is too thick for these diameters.');
    return outer.subtract(inner);
  },
  note: 'Print standing up. Keep the taper under 45° (Taper length at least half the difference in diameters) so it prints without supports.',
});

export const TEMPLATES = [
  { kind: 'tpl_tray', label: 'Divided tray', blurb: 'Tray with compartments and rounded bottoms for small parts.', icon: '<svg viewBox="0 0 32 32"><rect x="3" y="8" width="26" height="16" rx="3"/><path d="M12 8v16M20 8v16M3 16h26"/></svg>' },
  { kind: 'tpl_box', label: 'Box with lid', blurb: 'Box and a press-fit or sliding lid, as two parts.', parts: [['box', 'Box', '#2F9C95'], ['lid', 'Lid', '#E8B15A']], icon: '<svg viewBox="0 0 32 32"><path d="M5 13h22v13H5z"/><path d="M4 8h24v5H4z"/></svg>' },
  { kind: 'tpl_spacer', label: 'Spacer / washer', blurb: 'Round, hex or square spacers in any size, as many as you need.', icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4.5"/></svg>' },
  { kind: 'tpl_stand', label: 'Phone or tablet stand', blurb: 'Leaning stand with a front lip, sized to your device, with a cable hole.', icon: '<svg viewBox="0 0 32 32"><path d="M5 27h22M9 27v-5M12 27l8-20"/><rect x="13" y="4" width="7" height="18" rx="1.5" transform="rotate(22 16 13)"/></svg>' },
  { kind: 'tpl_divider', label: 'Drawer dividers', blurb: 'Slotted dividers that slide together into a grid.', icon: '<svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="22" rx="2"/><path d="M16 5v22M3 16h26"/></svg>' },
  { kind: 'tpl_rack', label: 'Test tube rack', blurb: 'Three-level rack for tubes, pens or brushes.', icon: '<svg viewBox="0 0 32 32"><path d="M3 10h26M3 26h26M5 10v16M27 10v16"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><circle cx="22" cy="10" r="2"/></svg>' },
  { kind: 'tpl_cable', label: 'Cable guide', blurb: 'Snap-in cable holder with screw holes or a flat back for tape.', icon: '<svg viewBox="0 0 32 32"><path d="M3 22h26v-6M3 22v-6"/><circle cx="9" cy="14" r="3.5"/><circle cx="16" cy="14" r="3.5"/><circle cx="23" cy="14" r="3.5"/></svg>' },
  { kind: 'tpl_adapter', label: 'Hose / pipe adapter', blurb: 'Joins two diameters, with barbs for hoses.', icon: '<svg viewBox="0 0 32 32"><path d="M4 9h10l5 4h9v6h-9l-5 4H4z"/></svg>' },
];

export function install(app) {
  for (const t of TEMPLATES) app.addAction({ label: t.label, group: 'Templates', iconHtml: t.icon, run: () => addModel(app, t) });
  app.library.addTab('templates', 'Templates', (el) => {
    el.append(h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Pick a template, then shape it with the sliders on the right. Check the preview, then export.'));
    el.append(h('div', { class: 'tpl-grid' }, ...TEMPLATES.map((t) => h('button', { class: 'tpl', title: t.blurb, onclick: () => addModel(app, t) }, h('span', { html: t.icon }), h('b', {}, t.label), h('small', {}, t.blurb)))));
  });
}
