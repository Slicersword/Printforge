// Ready-made parametric models (ideas from usestl.com's catalogue), all MIT and built from scratch:
// Lithophane letter, screw-lock carabiner, folding box, geometric planter and vent grille.
// Plus "Make many": the same model for a whole list of names at once.
import { registerKind, kindDef, K, dropCache } from './kernel.js';
import { h, row, numField } from './ui.js';
import { textLoops, traceImageFile } from './textshape.js';
import { heightField, encodeGray, decodeGray, grayFromFile } from './makers.js';
import { threadRod } from './generators.js';
import { clearDocCache } from './studio.js';
import { uid } from './scene.js';

const n = (key, label, def, min, max, step = 0.5, unit = 'mm') => ({ key, label, type: 'num', def, min, max, step, unit });
const int = (key, label, def, min, max) => ({ key, label, type: 'int', def, min, max, step: 1, unit: '' });
const sel = (key, label, def, options) => ({ key, label, type: 'select', def, options });
const bool = (key, label, def) => ({ key, label, type: 'bool', def });
const text = (key, label, def) => ({ key, label, type: 'text', def });
const LAYOUT = sel('layout', 'Show', 'assembled', [['assembled', 'Assembled'], ['separate', 'Separate parts (to print)']]);
const SCRIPT_FONTS = [['Pacifico, cursive', 'Pacifico (script)'], ['Great Vibes, cursive', 'Great Vibes (script)'], ['Lobster, cursive', 'Lobster'], ['Brush Script MT, cursive', 'Brush script']];
const BLOCK_FONTS = [['Bebas Neue, sans-serif', 'Bebas Neue'], ['Anton, sans-serif', 'Anton'], ['Arial Black, Arial, sans-serif', 'Arial Black'], ['Righteous, sans-serif', 'Righteous'], ['Impact, sans-serif', 'Impact']];
const isScript = (f) => /Pacifico|Vibes|Lobster|Brush/.test(f);
const DECOR_FAMS = ['Pacifico', 'Great Vibes', 'Lobster', 'Bebas Neue', 'Anton', 'Righteous'];
const DECOR_RE = /Pacifico|Great Vibes|Lobster|Bebas Neue|Anton|Righteous/;
const DECOR_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Pacifico&family=Bebas+Neue&family=Lobster&family=Great+Vibes&family=Anton&family=Righteous&display=swap';

/** Text as a 2D region, scaled so it is exactly `height` mm tall (or `width` wide if given), centred. */
function textRegion(str, font, { height, width, maxWidth } = {}) {
  const loops = textLoops({ text: str || ' ', font, size: 20, bold: !isScript(font), italic: false, spacing: 0, lineGap: 1.15, align: 'center' });
  if (!loops.length) throw new Error('Type some text.');
  let cs = K.CrossSection.ofPolygons(loops, 'EvenOdd'); const b = cs.bounds();
  const w = b.max[0] - b.min[0], hh = b.max[1] - b.min[1];
  let k = width ? width / w : height / hh; if (maxWidth && w * k > maxWidth) k = maxWidth / w;
  return cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale([k, k]);
}
const rr = (w, d, r) => { r = Math.max(0.01, Math.min(r, w / 2 - 0.01, d / 2 - 0.01)); return K.CrossSection.square([w - 2 * r, d - 2 * r], true).offset(r, 'Round', 2, 40); };
/** Extrude a 2D profile (u, v) along X, centred: u → Y, v → Z. */
const alongX = (cs, L) => cs.extrude(L).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([-L / 2, 0, 0]);
const drop = (m) => { const b = m.boundingBox(); return m.translate([0, 0, -b.min[2]]); };
const beside = (m, ref, gap = 8) => { const a = m.boundingBox(), b = ref; return m.translate([b.max[0] + gap - a.min[0], (b.min[1] + b.max[1]) / 2 - (a.min[1] + a.max[1]) / 2, -a.min[2]]); };

// ================================================================ Lithophane letter
// A hollow initial with a removable lithophane panel in the front, an LED cavity, a cable slot in the base
// and a script name across the front in a second colour. Built lying on its back (front up), shown standing.
function letterParts(p) {
  const L = textRegion(p.initial || 'A', p.initFont, { height: p.h });
  const inner = L.offset(-p.wall, 'Round', 2, 24);
  if (inner.isEmpty()) throw new Error('The letter strokes are too thin for this wall. Use a heavier font or a thinner wall.');
  const rebate = L.offset(-p.wall / 2, 'Round', 2, 24);
  return { L, inner, rebate, panel: L.offset(-p.wall / 2 - p.clr, 'Round', 2, 24) };
}
registerKind('litholetter', {
  label: 'Lithophane letter', keepOrigin: true, editor: true, editorLabel: 'Choose the photo…',
  params: [text('initial', 'Initial', 'R'), text('name', 'Name', 'Rafael'), sel('font', 'Name font', 'Pacifico, cursive', SCRIPT_FONTS), sel('initFont', 'Letter font', 'Arial Black, Arial, sans-serif', BLOCK_FONTS),
    n('h', 'Letter height', 140, 40, 300, 1), n('depth', 'Body depth', 24, 10, 80, 1), n('wall', 'Body wall', 2.4, 1.2, 6, 0.2), n('minT', 'Panel thinnest', 0.8, 0.4, 3, 0.1), n('maxT', 'Panel thickest', 3, 1, 6, 0.1),
    n('nameT', 'Name thickness', 8, 1, 20, 0.5), n('clr', 'Fit clearance', 0.3, 0, 1, 0.05), n('slot', 'Cable slot', 8, 0, 20, 0.5), bool('invert', 'Invert photo', false), LAYOUT,
    sel('part', 'This object is the', 'body', [['body', 'Letter body'], ['panel', 'Lithophane panel'], ['name', 'Name']])],
  build: (p, Kk) => {
    const M = Kk.Manifold; const { L, inner, rebate, panel } = letterParts(p); const D = p.depth; const sep = p.layout === 'separate';
    const stand = (m) => m.rotate([90, 0, 0]).translate([0, D, 0]); // front (z = D) faces −Y, letter stands up
    const lb = L.bounds();
    if (p.part === 'body') {
      let body = L.extrude(D).subtract(inner.extrude(D).translate([0, 0, p.wall])).subtract(rebate.extrude(p.maxT + 1).translate([0, 0, D - p.maxT]));
      if (p.slot > 0) {
        // cable slot through the bottom wall, under the lowest stroke
        const strip = L.intersect(K.CrossSection.square([lb.max[0] - lb.min[0] + 2, p.wall + 1]).translate([lb.min[0] - 1, lb.min[1] - 0.5])); const sb = strip.bounds();
        const cx = (sb.min[0] + sb.max[0]) / 2;
        body = body.subtract(M.cube([p.slot, p.wall * 2 + 2, Math.min(D - p.wall - p.maxT, p.slot * 0.75)]).translate([cx - p.slot / 2, lb.min[1] - 1, p.wall]));
      }
      return sep ? drop(body) : stand(body);
    }
    if (p.part === 'panel') {
      const pb = panel.bounds(); const W = pb.max[0] - pb.min[0], H = pb.max[1] - pb.min[1];
      let field;
      if (p.gray) {
        const g = decodeGray(p.gray); const gw = p.gw, gh = p.gh; const step = 0.5;
        const nx = Math.max(2, Math.round(W / step) + 1), ny = Math.max(2, Math.round(H / step) + 1); const Hh = new Float32Array(nx * ny);
        // cover-fit the photo to the panel, centred
        const scale = Math.max(nx / gw, ny / gh); const ox = (gw * scale - nx) / 2, oy = (gh * scale - ny) / 2;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const gx = Math.min(gw - 1, Math.max(0, Math.round((i + ox) / scale))), gy = Math.min(gh - 1, Math.max(0, Math.round((ny - 1 - j + oy) / scale)));
          let v = g[gy * gw + gx] / 255; if (p.invert) v = 1 - v; Hh[j * nx + i] = p.minT + (1 - v) * (p.maxT - p.minT);
        }
        field = heightField(Kk, Hh, nx, ny, W / (nx - 1), H / (ny - 1)).translate([pb.min[0], pb.min[1], 0]);
      } else field = M.cube([W, H, Math.max(p.minT, 1.2)]).translate([pb.min[0], pb.min[1], 0]);
      const plate = field.intersect(panel.extrude(p.maxT + 1));
      return sep ? plate.translate([lb.max[0] - lb.min[0] + 10, 0, 0]) : stand(plate.translate([0, 0, D - p.maxT]));
    }
    // name: script text across the lower part of the front, sunk 0.6 mm into the rim so it fuses
    const nm = textRegion(p.name, p.font, { height: p.h * 0.26, maxWidth: (lb.max[0] - lb.min[0]) * 1.25 }).translate([0, lb.min[1] + p.h * 0.3]);
    const solid = nm.extrude(p.nameT);
    return sep ? drop(solid).translate([0, lb.min[1] - p.h * 0.45, 0]) : stand(solid.translate([0, 0, D - 0.6]));
  },
  note: 'Print the body front-up, the panel flat in white (thin = bright), and the name in a second colour. Slide an LED strip inside; the cable leaves through the slot in the base.',
});

// ================================================================ Screw-lock carabiner
registerKind('carabiner', {
  label: 'Screw-lock carabiner', keepOrigin: true,
  params: [text('name', 'Name', 'AVENTURA'), sel('font', 'Font', 'Bebas Neue, sans-serif', BLOCK_FONTS), n('len', 'Length', 85, 50, 200, 1), n('wid', 'Width', 48, 30, 120, 1),
    n('hoop', 'Hoop width', 8, 6, 16, 0.5), n('t', 'Thickness', 8, 6, 16, 0.5), n('relief', 'Name relief', 0.8, 0.2, 3, 0.1), n('clr', 'Thread clearance', 0.3, 0.1, 0.8, 0.05), LAYOUT,
    sel('part', 'This object is the', 'body', [['body', 'Body'], ['gate', 'Gate and pin'], ['lock', 'Lock sleeve'], ['name', 'Name']])],
  build: (p, Kk) => {
    const M = Kk.Manifold; const { len, wid, hoop: w, t } = p; const sep = p.layout === 'separate';
    const r = Math.min(wid * 0.32, len * 0.25); const y0 = wid / 2 - w / 2, z0 = t / 2;
    const xp = -len / 2 + r, xn = len / 2 - r; const dn = Math.min(w, t) * 0.8, noseL = Math.min(10, (xn - xp) * 0.25), pitch = 1.5;
    const pinD = 3.2, tabZ0 = t / 3, tabZ1 = 2 * t / 3;
    const toX = (m) => m.rotate([0, 90, 0]); // build along Z, then lay along +X
    if (p.part === 'body') {
      let body = rr(len, wid, r).subtract(rr(len - 2 * w, wid - 2 * w, Math.max(0.5, r - w))).extrude(t);
      body = body.subtract(M.cube([xn - (xp + w * 0.5), w + 2, t + 2]).translate([xp + w * 0.5, wid / 2 - w - 0.01, -1])); // gate opening
      body = body.subtract(M.cube([w * 1.2 + 1, w + 2, tabZ1 - tabZ0]).translate([xp - w * 0.7, wid / 2 - w - 1, tabZ0])); // fork for the gate tab
      body = body.subtract(M.cylinder(t + 2, pinD / 2, pinD / 2, 24).translate([xp, y0, -1]));
      // threaded nose the lock sleeve screws onto
      const nose = toX(threadRod(Kk, dn, pitch, noseL)).translate([xn - noseL, y0, z0]);
      body = body.add(nose).add(M.cylinder(2, dn / 2, dn / 2, 32).rotate([0, 90, 0]).translate([xn - 1, y0, z0]));
      return body;
    }
    if (p.part === 'gate') {
      const dg = Math.max(2.4, dn - 2.6); const x1 = xn - noseL - p.clr * 2;
      let gate = toX(M.cylinder(x1 - (xp + w * 0.3), dg / 2, dg / 2, 28)).translate([xp + w * 0.3, y0, z0]);
      const tab = M.cube([w * 1.3, w - 2 * p.clr, tabZ1 - tabZ0 - 2 * p.clr]).translate([xp - w * 0.6, y0 - (w - 2 * p.clr) / 2, tabZ0 + p.clr]);
      gate = gate.add(tab).subtract(M.cylinder(t + 2, pinD / 2 + p.clr / 2, pinD / 2 + p.clr / 2, 24).translate([xp, y0, -1]));
      const pin = M.cylinder(t, pinD / 2 - 0.15, pinD / 2 - 0.15, 24).add(M.cylinder(0.8, pinD / 2 + 1.2, pinD / 2 + 1.2, 24).translate([0, 0, t]));
      if (!sep) return gate.add(pin.translate([xp, y0, 0]));
      const g2 = drop(gate).translate([0, wid / 2 + 12 - y0, 0]); const gb = g2.boundingBox();
      return g2.add(pin.translate([gb.max[0] + 8, gb.max[1], 0]));
    }
    if (p.part === 'lock') {
      const sl = noseL + 6, ro = dn / 2 + 2.6; const N = 30;
      const knurl = K.CrossSection.ofPolygons([Array.from({ length: N * 2 }, (_, i) => { const a = i / (N * 2) * Math.PI * 2, rad = i % 2 ? ro : ro - 0.7; return [Math.cos(a) * rad, Math.sin(a) * rad]; })]);
      const sleeve = knurl.extrude(sl).subtract(threadRod(Kk, dn, pitch, sl + 0.02, true, p.clr).translate([0, 0, -0.01])).subtract(M.cylinder(1.2, dn / 2 + p.clr + 0.4, dn / 2 + p.clr, 32).translate([0, 0, -0.01]));
      return sep ? sleeve.translate([len / 2 + ro + 10, wid / 2 + 12, 0]) : toX(sleeve).translate([xn - sl, y0, z0]);
    }
    // name embossed on the top face of the bottom bar
    const barLen = len - 2 * r; const nm = textRegion(p.name, p.font, { height: w * 0.62, maxWidth: barLen * 0.92 }).translate([0, -wid / 2 + w / 2]);
    return nm.extrude(p.relief + 0.01).translate([0, 0, t - 0.01]);
  },
  note: 'Light duty only, not for climbing or anything that holds a person. Print the body flat; the gate pin goes in from below, then screw the sleeve onto the threaded nose.',
});

// ================================================================ Folding box (mailer, printed flat)
registerKind('foldbox', {
  label: 'Folding box', keepOrigin: true, editor: true, editorLabel: 'Choose a lid photo…',
  params: [n('w', 'Width', 50.8, 15, 300, 0.1), n('d', 'Depth', 102, 15, 300, 0.1), n('h', 'Height', 25.4, 8, 200, 0.1), n('sheet', 'Sheet thickness', 0.4, 0.24, 1.2, 0.04), n('crease', 'Crease thickness', 0.2, 0.08, 0.6, 0.02),
    n('gap', 'Crease width', 1, 0.4, 3, 0.1), sel('photoMode', 'Lid photo', 'none', [['none', 'None'], ['color', 'In a second colour'], ['engrave', 'Engraved']]), LAYOUT,
    sel('part', 'This object is the', 'box', [['box', 'Box'], ['photo', 'Lid photo (second colour)']])],
  build: (p, Kk) => {
    const M = Kk.Manifold; const { w, d, h, sheet: s, gap: g } = p; const CS = K.CrossSection;
    const lidY0 = d + 2 * g + h; // lid occupies [lidY0, lidY0 + d]
    const photo = () => {
      if (!p.loops?.length) return null; const cs = CS.ofPolygons(p.loops, 'EvenOdd'); const b = cs.bounds();
      const k = Math.min((w - 10) / (b.max[0] - b.min[0]), (d - 10) / (b.max[1] - b.min[1]));
      return cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale([k, k]);
    };
    const ph = p.photoMode !== 'none' ? photo() : null;
    if (p.layout === 'assembled') {
      const shell = M.cube([w, d, h]).subtract(M.cube([w - 2 * s, d - 2 * s, h - 2 * s]).translate([s, s, s])).translate([-w / 2, -d / 2, 0]);
      if (p.part === 'photo') { if (!ph || p.photoMode !== 'color') throw new Error('No lid photo in colour. Choose a photo and set Lid photo to “In a second colour”.'); return ph.extrude(0.2).translate([0, 0, h - 0.2]); }
      return ph && p.photoMode === 'engrave' ? shell.subtract(ph.extrude(0.3).translate([0, 0, h - s / 2])) : shell;
    }
    // ---- flat net (z = 0 is the bed; outside of the box faces down)
    const panels = []; const creases = [];
    const P = (x0, y0, x1, y1) => panels.push(CS.square([x1 - x0, y1 - y0]).translate([x0, y0]));
    const C = (x0, y0, x1, y1) => creases.push(CS.square([x1 - x0, y1 - y0]).translate([x0, y0]));
    const tuck = (x0, y0, x1, y1, side) => { // flap with chamfered free corners
      const c = Math.min(x1 - x0, y1 - y0) * 0.3; const pts = side === 'up' ? [[x0, y0], [x1, y0], [x1 - c, y1], [x0 + c, y1]] : side === 'down' ? [[x0 + c, y0], [x1 - c, y0], [x1, y1], [x0, y1]] : side === 'left' ? [[x0, y0 + c], [x1, y0], [x1, y1], [x0, y1 - c]] : [[x0, y0], [x1, y0 + c], [x1, y1 - c], [x0, y1]];
      panels.push(CS.ofPolygons([pts]));
    };
    P(0, 0, w, d); // base
    P(0, -g - h, w, -g); C(0, -g, w, 0); // front wall
    P(0, d + g, w, d + g + h); C(0, d, w, d + g); // back wall
    P(0, lidY0, w, lidY0 + d); C(0, d + g + h, w, lidY0); // lid
    const fl = h * 0.85, ins = 2 * s + 0.6; tuck(ins, lidY0 + d + g, w - ins, lidY0 + d + g + fl, 'up'); C(ins, lidY0 + d, w - ins, lidY0 + d + g); // lid tuck flap
    P(-g - h, 0, -g, d); C(-g, 0, 0, d); P(w + g, 0, w + g + h, d); C(w, 0, w + g, d); // side walls
    const tl = Math.min(w * 0.35, h * 0.9) - 0.6; // corner tabs on the side walls, fold in behind front and back
    for (const [x0, x1] of [[-g - h + 0.6, -g - 0.6], [w + g + 0.6, w + g + h - 0.6]]) { tuck(x0, -g - tl, x1, -g, 'down'); C(x0, -g, x1, 0); tuck(x0, d + g, x1, d + g + tl, 'up'); C(x0, d, x1, d + g); }
    const df = h * 0.8; // dust flaps on the lid sides
    tuck(-g - df, lidY0 + 2, -g, lidY0 + d - 2, 'left'); C(-g, lidY0 + 2, 0, lidY0 + d - 2); tuck(w + g, lidY0 + 2, w + g + df, lidY0 + d - 2, 'right'); C(w, lidY0 + 2, w + g, lidY0 + d - 2);
    let net = CS.union(panels).extrude(s).add(CS.union(creases).extrude(p.crease));
    const cx = w / 2;
    // the lid's outside faces the bed, so the picture is mirrored to read the right way round
    const phNet = (cs, at) => cs.mirror([1, 0]).translate(at);
    const lidC = [w / 2, lidY0 + d / 2];
    if (p.part === 'photo') { if (!ph || p.photoMode !== 'color') throw new Error('No lid photo in colour. Choose a photo and set Lid photo to “In a second colour”.'); return phNet(ph, lidC).extrude(0.2).translate([-cx, -lidY0 / 2, 0]); }
    if (ph) { const depth = p.photoMode === 'engrave' ? s / 2 : 0.2; net = net.subtract(phNet(ph, lidC).extrude(depth + 0.01).translate([0, 0, -0.01])); }
    return net.translate([-cx, -lidY0 / 2, 0]);
  },
  note: 'Print flat, outside down. Fold along the thin creases: walls up, corner tabs inside, lid over, tuck flap in front. PETG or TPU creases last longest.',
});

// ================================================================ Geometric planter
function ringSlab(r, nSides, rotDeg, z) { return K.CrossSection.circle(r, nSides).rotate(rotDeg).extrude(0.01).translate([0, 0, z]); }
registerKind('planter', {
  label: 'Geometric planter',
  params: [n('dia', 'Diameter', 90, 30, 300, 1), n('h', 'Height', 80, 20, 300, 1), n('wall', 'Wall', 2.8, 1.2, 8, 0.2), int('faces', 'Faces', 8, 5, 16),
    bool('drain', 'Drainage hole', true), bool('saucer', 'Saucer', false), LAYOUT],
  build: (p, Kk) => {
    const M = Kk.Manifold; const nF = p.faces | 0; const half = 180 / nF; const c = Math.cos(Math.PI / nF);
    const rb = p.dia * 0.34, rm = p.dia / 2, rt = p.dia * 0.47, zm = p.h * 0.5, zt = p.h - 4;
    const body = (dr, z0) => M.union([M.hull([ringSlab(rb - dr, nF, 0, z0), ringSlab(rm - dr, nF, half, zm)]), M.hull([ringSlab(rm - dr, nF, half, zm), ringSlab(rt - dr, nF, 0, zt)])]);
    let pot = body(0, 0).add(K.CrossSection.circle(rt + 1.6, nF).extrude(4).translate([0, 0, zt - 0.01])); // polygonal rim
    const dw = p.wall / c; const floor = Math.max(p.wall * 1.2, 2.4);
    pot = pot.subtract(body(dw, floor)).subtract(K.CrossSection.circle(rt - dw, nF).extrude(10).translate([0, 0, zt - 1]));
    if (p.drain) pot = pot.subtract(M.cylinder(floor + 2, p.dia * 0.06, p.dia * 0.06, 32).translate([0, 0, -1]));
    if (!p.saucer) return pot;
    const sr = rb + 9, sh = 12; const saucer = M.hull([ringSlab(sr - 3, nF, 0, 0), ringSlab(sr, nF, 0, sh)]).subtract(M.hull([ringSlab(sr - 3 - 2, nF, 0, 2), ringSlab(sr - 2, nF, 0, sh + 0.02)]));
    return p.layout === 'separate' ? pot.add(saucer.translate([p.dia + 10, 0, 0])) : saucer.add(pot.translate([0, 0, 2]));
  },
  note: 'Diamond facets come from turning every other ring by half a face. Prints without supports when the belly stays under 45°.',
});

// ================================================================ Vent grille
const VENT_PARAMS = [sel('shape', 'Shape', 'rect', [['rect', 'Rectangular'], ['square', 'Square'], ['round', 'Round'], ['hex', 'Hexagonal']]), n('w', 'Width', 150, 30, 400, 1), n('hgt', 'Height', 100, 30, 400, 1),
    n('frame', 'Frame', 10, 4, 40, 0.5), n('t', 'Thickness', 3, 1.2, 10, 0.2), n('depth', 'Louver depth', 10, 3, 40, 0.5), n('pitch', 'Louver pitch', 10, 4, 30, 0.5), bool('screws', 'Screw holes', true)];
registerKind('ventgrille', {
  label: 'Vent grille', params: VENT_PARAMS,
  schema: (p) => VENT_PARAMS.filter((f) => f.key !== 'hgt' || p.shape === 'rect'),
  build: (p, Kk) => {
    const M = Kk.Manifold; const CS = K.CrossSection; const H = p.shape === 'rect' ? p.hgt : p.w;
    const O = p.shape === 'round' ? CS.circle(p.w / 2, 96) : p.shape === 'hex' ? CS.circle(p.w / 2, 6) : rr(p.w, H, 4);
    const I = O.offset(-p.frame, 'Round', 2, 32); if (I.isEmpty()) throw new Error('The frame is wider than the grille.');
    let g = O.subtract(I).extrude(p.t).add(I.subtract(I.offset(-1.6, 'Round', 2, 24)).extrude(p.depth));
    // 45° slats (lean towards +Y as they rise, so each layer sits on the one below: no supports)
    const lt = 1.4 * Math.SQRT2, ib = I.bounds(); const span = p.w + p.depth * 2 + 20; const slats = [];
    for (let y = ib.min[1] - p.depth; y < ib.max[1] + p.pitch; y += p.pitch) slats.push([[y, 0], [y + lt, 0], [y + lt + p.depth, p.depth], [y + p.depth, p.depth]]);
    g = g.add(alongX(CS.ofPolygons(slats, 'NonZero'), span).intersect(I.extrude(p.depth)));
    if (p.screws) {
      const R = p.w / 2 - p.frame / 2; const pts = p.shape === 'rect' || p.shape === 'square' ? [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [a * (p.w / 2 - p.frame / 2), b * (H / 2 - p.frame / 2)]) : [45, 135, 225, 315].map((a) => [Math.cos(a * Math.PI / 180) * R, Math.sin(a * Math.PI / 180) * R]);
      for (const [x, y] of pts) g = g.subtract(M.cylinder(p.t + 2, 1.8, 1.8, 24).translate([x, y, -1])).subtract(M.cylinder(1.8, 3.6, 1.8, 24).translate([x, y, -0.01]));
    }
    return g;
  },
  note: 'Print face down (as shown): the louvers lean at 45°, so no supports. Countersunk holes take 3.5 mm wood screws.',
});

// ================================================================ Lithophane folding fan
// Each blade is a lithophane: together, opened, they show one picture (or one picture per group of blades).
// Printed flat side by side; a screw or rivet through the pivot holes holds the fan together.
function demoGray(u, v) { // built-in picture: a sunset over hills (no outside images needed)
  const sun = Math.hypot(u - 0.5, v - 0.62) < 0.13 ? 0.95 : 0; const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.62) * 2.2) * 0.5;
  const hill1 = v < 0.35 + 0.08 * Math.sin(u * 9) ? 0.15 : 0, hill2 = v < 0.22 + 0.05 * Math.sin(u * 14 + 1) ? 0.05 : 0;
  if (hill2) return hill2; if (hill1) return hill1; return Math.max(sun, 0.35 + glow + 0.25 * v);
}
function sampleGray(img, u, v) { if (u < 0 || u > 1 || v < 0 || v > 1) return 1; const g = decodeGray(img.gray); const x = Math.min(img.gw - 1, Math.floor(u * img.gw)), y = Math.min(img.gh - 1, Math.floor((1 - v) * img.gh)); return g[y * img.gw + x] / 255; }
function fanGeom(p) {
  const L = Math.max(3, p.leaves | 0), S = p.spread * Math.PI / 180, step = S / (L - 1), R = p.R, rIn = R * p.inner / 100;
  const phi = Math.min(Math.asin(Math.min(0.95, Math.sin(step / 2) * p.overlap)), 0.6); const hw = R * Math.sin(phi);
  const Xm = R * Math.sin(Math.min(Math.PI / 2, S / 2 + phi)); const Ym = Math.min(rIn * Math.cos(Math.min(Math.PI, S / 2 + phi)), R * Math.cos(Math.min(Math.PI, S / 2 + phi)));
  return { L, S, step, R, rIn, phi, hw, box: [-Xm, Ym, Xm, R] };
}
registerKind('lithofan', {
  label: 'Lithophane folding fan', keepOrigin: true, editor: true, editorLabel: 'Choose pictures and text…',
  params: [int('leaves', 'Blades', 12, 5, 24), n('R', 'Fan radius', 150, 60, 250, 1), n('spread', 'Opening angle', 160, 90, 200, 1, '°'), n('inner', 'Picture starts at', 30, 15, 60, 1, '% of radius'),
    n('overlap', 'Blade overlap', 1.35, 1.05, 2, 0.05, '×'), n('minT', 'Thinnest', 0.6, 0.4, 2, 0.1), n('maxT', 'Thickest', 2.2, 1, 4, 0.1), n('frame', 'Blade rim', 1.6, 0.6, 5, 0.2),
    n('pivot', 'Pivot hole', 3.2, 1.5, 6, 0.1), n('res', 'Detail (mm per point)', 0.7, 0.4, 1.5, 0.05), bool('invert', 'Invert pictures', false), LAYOUT],
  build: (p, Kk) => {
    const M = Kk.Manifold; const CS = K.CrossSection; const g = fanGeom(p); const { L, step, R, rIn, phi, hw } = g; const half = (p.spread * Math.PI / 180) / 2; const rp = 7;
    const arc = Array.from({ length: 25 }, (_, i) => { const a = -phi + 2 * phi * i / 24; return [R * Math.sin(a), R * Math.cos(a)]; });
    const blade = CS.hull([CS.circle(rp, 32), CS.ofPolygons([arc.slice().reverse().concat([[0, R * 0.5]])])]); // counter-clockwise
    const segs = p.segs?.length ? p.segs : null; const full = p.gray ? { gray: p.gray, gw: p.gw, gh: p.gh } : null; const txt = p.textGray ? { gray: p.textGray, gw: p.tgw, gh: p.tgh } : null;
    const [bx0, by0, bx1, by1] = g.box; const bw = bx1 - bx0, bh = by1 - by0;
    const coverUV = (img, x, y) => { const ar = img.gw / img.gh, br = bw / bh; let u = (x - bx0) / bw, v = (y - by0) / bh; if (ar > br) { const k = br / ar; u = 0.5 + (u - 0.5) * k; } else { const k = ar / br; v = 0.5 + (v - 0.5) * k; } return [u, v]; };
    const nx = Math.max(2, Math.round(2 * hw / p.res) + 1), ny = Math.max(2, Math.round((R + rp) / p.res) + 1); const sx = 2 * hw / (nx - 1), sy = (R + rp) / (ny - 1);
    const leaves = [];
    for (let k = 0; k < L; k++) {
      const th = -half + k * step; const H = new Float32Array(nx * ny);
      const grp = segs ? Math.min(segs.length - 1, Math.floor(k * segs.length / L)) : 0;
      const gk0 = segs ? Math.round(grp * L / segs.length) : 0, gk1 = segs ? Math.round((grp + 1) * L / segs.length) - 1 : 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = -hw + i * sx, y = -rp + j * sy; const r = Math.hypot(x, y), a = Math.atan2(x, y);
        const inWin = r > rIn && r < R - p.frame && Math.abs(a) < phi - p.frame / Math.max(r, 1);
        if (!inWin) { H[j * nx + i] = p.maxT; continue; }
        // world position of this point on the open fan (blade turned by th around the pivot)
        const X = x * Math.cos(th) + y * Math.sin(th), Y = -x * Math.sin(th) + y * Math.cos(th);
        let val;
        if (segs) { const a0 = -half + gk0 * step - step / 2, a1 = -half + gk1 * step + step / 2; const ang = Math.atan2(X, Y); val = sampleGray(segs[grp], (ang - a0) / (a1 - a0), (r - rIn) / (R - p.frame - rIn)); }
        else if (full) { const [u, v] = coverUV(full, X, Y); val = sampleGray(full, u, v); }
        else val = demoGray((X - bx0) / bw, (Y - by0) / bh);
        if (txt) { const [u, v] = coverUV(txt, X, Y); val = Math.min(val, sampleGray(txt, u, v)); }
        if (p.invert) val = 1 - val;
        H[j * nx + i] = p.minT + (1 - val) * (p.maxT - p.minT);
      }
      let leaf = heightField(Kk, H, nx, ny, sx, sy).translate([-hw, -rp, 0]).intersect(blade.extrude(p.maxT + 1)).subtract(M.cylinder(p.maxT + 4, p.pivot / 2, p.pivot / 2, 32).translate([0, 0, -2]));
      leaves.push(p.layout === 'separate' ? leaf : leaf.rotate([0, 0, -th * 180 / Math.PI]).translate([0, 0, k * p.maxT * 1.02]));
    }
    if (p.layout !== 'separate') return M.union(leaves);
    const pitch = 2 * hw + 4, perRow = Math.max(1, Math.floor(240 / pitch));
    return M.union(leaves.map((m, k) => m.translate([(k % perRow) * pitch, -Math.floor(k / perRow) * (R + rp + 6), 0])));
  },
  note: 'Print the blades flat in white PLA (thin = bright). Stack them in order and join them through the pivot holes with an M3 screw or a rivet.',
});

// ================================================================ add, pick photos, make many
export const MODELS = [
  { kind: 'litholetter', label: 'Lithophane letter', blurb: 'Hollow initial with a removable photo panel, LED inside, cable slot and your name in script.', parts: [['body', 'Letter', '#16D8AA'], ['panel', 'Photo panel', '#F3F3F0'], ['name', 'Name', '#E8B15A']], photo: 'gray', icon: '<svg viewBox="0 0 32 32"><path d="M8 27V5h9a6 6 0 0 1 0 12H8M17 17l7 10"/><path d="M6 22c4-3 9 2 13-1s6-1 8 0" stroke-width="1.6"/></svg>' },
  { kind: 'carabiner', label: 'Screw-lock carabiner', blurb: 'Hinged gate on a pin and a knurled sleeve that screws over the nose. Name on the side.', parts: [['body', 'Body', '#16D8AA'], ['gate', 'Gate and pin', '#F3F3F0'], ['lock', 'Lock sleeve', '#E8B15A'], ['name', 'Name', '#F3F3F0']], icon: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="15" rx="6"/><path d="M10 9h12" stroke-width="3"/><path d="M16 7v4M19 7v4"/></svg>' },
  { kind: 'foldbox', label: 'Folding box', blurb: 'Mailer box printed flat in one piece: fold on the creases, the tabs lock without glue.', parts: [['box', 'Box', '#16D8AA']], photo: 'loops', icon: '<svg viewBox="0 0 32 32"><path d="M11 4h10v7h7v10h-7v7H11v-7H4V11h7z"/><path d="M11 11h10v10H11z"/></svg>' },
  { kind: 'lithofan', label: 'Lithophane folding fan', blurb: 'Fan blades that show one photo (or one per group of blades) when light shines through. Add text too.', photo: 'fan', icon: '<svg viewBox="0 0 32 32"><path d="M16 27L4 13a17 17 0 0 1 24 0z"/><path d="M16 27L9 8M16 27l0-20M16 27l7-19"/><circle cx="16" cy="26" r="1.5"/></svg>' },
  { kind: 'planter', label: 'Geometric planter', blurb: 'Diamond facets, a polygonal rim, a drainage hole and an optional saucer.', icon: '<svg viewBox="0 0 32 32"><path d="M5 7h22l-3 9-3 10H11L8 16z"/><path d="M8 16l5-9 3 9 3-9 5 9M8 16l3 10 5-10 5 10 3-10"/></svg>' },
  { kind: 'ventgrille', label: 'Vent grille', blurb: 'Rectangular, square, round or hex grille with 45° louvers that print without supports.', icon: '<svg viewBox="0 0 32 32"><rect x="3" y="7" width="26" height="18" rx="2"/><path d="M8 12h16M8 16h16M8 20h16"/></svg>' },
];

function defaults(kind) { const p = {}; for (const f of kindDef(kind).params) p[f.key] = f.def; return p; }
export function addModel(app, m, extra = {}) {
  app.setMode('design'); const s = app.scene;
  const p = { ...defaults(m.kind), ...extra };
  if (!m.parts) return app.addShape(m.kind, p, { name: m.label });
  const link = `L${uid()}`; const made = [];
  const first = app.addShape(m.kind, { ...p, part: m.parts[0][0] }, { name: `${m.label} · ${m.parts[0][1]}`, color: m.parts[0][2] });
  s.edit(`add ${m.label.toLowerCase()}`, () => {
    first.link = link; first.local = ['part']; made.push(first);
    for (const [part, name, color] of m.parts.slice(1)) {
      if (m.kind === 'foldbox') continue;
      const o = { ...JSON.parse(JSON.stringify(first)), id: uid(), name: `${m.label} · ${name}`, color, params: { ...first.params, part } };
      s.objects.push(o); made.push(o);
    }
    s.selection = new Set(made.map((o) => o.id));
  });
  s.emit('select');
  if (made.length > 1) app.toast(`${m.label}: ${made.length} linked parts, each with its own colour. Change a setting on any of them and the others follow.`);
  return first;
}

/** Choose a photo (lithophane) or a picture to trace (box lid) for a model, then apply it to every linked part. */
export function pickPhoto(app, o) {
  const m = MODELS.find((x) => x.kind === o.kind); const mode = m?.photo || 'gray';
  const st = { file: null, threshold: 0.5, invert: false }; const info = h('p', { class: 'note' }, mode === 'gray' ? 'Choose a photo. Faces and bright, simple pictures work best.' : 'Choose a picture or logo. Dark areas become the design.');
  const prev = h('canvas', { width: 320, height: 240, class: 'maker-prev' });
  const apply = async () => {
    if (!st.file) { info.textContent = 'Choose a file first.'; return; }
    try {
      let patch;
      if (mode === 'gray') { const g = await grayFromFile(st.file, 360); patch = { gray: encodeGray(g.g), gw: g.gw, gh: g.gh }; }
      else { const r = await traceImageFile(st.file, st); if (!r.loops.length) { info.textContent = 'No shape found. Try another threshold.'; return; } patch = { loops: r.loops, photoMode: o.params.photoMode === 'none' ? 'engrave' : o.params.photoMode }; }
      app.setParams(o, { ...o.params, ...patch }, 'change photo'); d.close();
      if (m?.kind === 'foldbox' && patch.photoMode) ensurePhotoPart(app, o);
    } catch (e) { info.textContent = e.message; }
  };
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', onchange: async (e) => { st.file = e.target.files[0]; if (!st.file) return; const url = URL.createObjectURL(st.file); const img = new Image(); img.onload = () => { const c = prev.getContext('2d'); c.clearRect(0, 0, prev.width, prev.height); const k = Math.min(prev.width / img.width, prev.height / img.height); c.drawImage(img, (prev.width - img.width * k) / 2, (prev.height - img.height * k) / 2, img.width * k, img.height * k); URL.revokeObjectURL(url); }; img.src = url; } });
  const extra = mode === 'loops' ? [row('Threshold', h('input', { type: 'range', min: '0.05', max: '0.95', step: '0.05', value: '0.5', oninput: (e) => { st.threshold = +e.target.value; } })), row('Invert', h('input', { type: 'checkbox', style: { justifySelf: 'end' }, onchange: (e) => { st.invert = e.target.checked; } }))] : [];
  const d = app.modal(mode === 'gray' ? 'Photo for the panel' : 'Picture for the lid', h('div', { class: 'maker-side', style: { minWidth: '320px' } }, prev, fileIn, ...extra, info,
    o.params.gray || o.params.loops ? h('button', { class: 'btn', onclick: () => { app.setParams(o, { ...o.params, gray: null, loops: null, ...(m?.kind === 'foldbox' ? { photoMode: 'none' } : {}) }, 'remove photo'); d.close(); } }, 'Remove the photo') : null),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: apply }, 'Use this picture')));
}

/** Pictures and text for the folding fan: one picture across the whole fan, or one per group of blades. */
export function pickFan(app, o) {
  const st = { mode: o.params.segs?.length ? 'segments' : 'full', files: [], text: o.params.text || '', size: o.params.textSize || 14, pos: o.params.textPos ?? 75, font: o.params.textFont || 'Georgia, serif' };
  const info = h('p', { class: 'note' }, 'One picture across the whole fan, or a different picture for each group of blades. Dark = thick, light = thin.');
  const modeSel = h('select', { onchange: (e) => { st.mode = e.target.value; fileIn.multiple = st.mode === 'segments'; } }, h('option', { value: 'full', selected: st.mode === 'full' }, 'One picture across the fan'), h('option', { value: 'segments', selected: st.mode === 'segments' }, 'A picture per group of blades'));
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: st.mode === 'segments', onchange: (e) => { st.files = [...e.target.files]; info.textContent = `${st.files.length} picture${st.files.length === 1 ? '' : 's'} chosen.`; } });
  const textIn = h('input', { type: 'text', value: st.text, placeholder: 'Optional text, e.g. Welcome', onkeydown: (e) => e.stopPropagation(), oninput: (e) => { st.text = e.target.value; } });
  const fontSel = h('select', { onchange: (e) => { st.font = e.target.value; } }, ...[['Georgia, serif', 'Serif'], ['Pacifico, cursive', 'Pacifico (script)'], ['Great Vibes, cursive', 'Great Vibes (script)'], ['Bebas Neue, sans-serif', 'Bebas Neue'], ['Arial Black, Arial, sans-serif', 'Heavy sans']].map(([v, l]) => h('option', { value: v, selected: v === st.font }, l)));
  const apply = async () => {
    try {
      const patch = { text: st.text, textSize: st.size, textPos: st.pos, textFont: st.font };
      if (st.files.length) {
        if (st.mode === 'full') { const g = await grayFromFile(st.files[0], 420); Object.assign(patch, { gray: encodeGray(g.g), gw: g.gw, gh: g.gh, segs: null }); }
        else { const segs = []; for (const f of st.files.slice(0, 8)) { const g = await grayFromFile(f, 200); segs.push({ gray: encodeGray(g.g), gw: g.gw, gh: g.gh }); } Object.assign(patch, { segs, gray: null }); }
      } else if (st.mode === 'full') patch.segs = null;
      // text is drawn into its own picture laid over the whole fan
      if (st.text.trim()) {
        const g = fanGeom({ ...o.params }); const [x0, y0, x1, y1] = g.box; const W = 600, Hh = Math.round(W * (y1 - y0) / (x1 - x0));
        const c = document.createElement('canvas'); c.width = W; c.height = Hh; const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, Hh); ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const px = st.size / (x1 - x0) * W; if (DECOR_RE.test(st.font)) await app.needFonts?.(); try { await document.fonts.load(`${px}px ${st.font}`); } catch { /* fallback font */ } ctx.font = `${px}px ${st.font}`;
        ctx.fillText(st.text, W / 2, Hh * (1 - st.pos / 100));
        const d = ctx.getImageData(0, 0, W, Hh).data; const u8 = new Uint8Array(W * Hh); for (let i = 0; i < u8.length; i++) u8[i] = d[i * 4];
        Object.assign(patch, { textGray: encodeGray(u8), tgw: W, tgh: Hh });
      } else Object.assign(patch, { textGray: null });
      app.setParams(o, { ...o.params, ...patch }, 'change fan pictures'); d.close();
    } catch (e) { info.textContent = e.message; }
  };
  const d = app.modal('Fan pictures and text', h('div', { class: 'maker-side', style: { minWidth: '360px' } }, row('Layout', modeSel), fileIn, info,
    h('fieldset', {}, h('legend', {}, 'Text on the fan'), row('Text', textIn), row('Font', fontSel), row('Letter height (mm)', numField(st.size, (v) => { st.size = v; }, { min: 4, max: 80 })), row('Height on the fan (%)', numField(st.pos, (v) => { st.pos = v; }, { min: 0, max: 100 }))),
    o.params.gray || o.params.segs ? h('button', { class: 'btn', onclick: () => { app.setParams(o, { ...o.params, gray: null, segs: null }, 'use the built-in picture'); d.close(); } }, 'Use the built-in picture') : null),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: apply }, 'Apply')));
}
function ensurePhotoPart(app, o) {
  const s = app.scene; const box = o.link ? s.objects.find((x) => x.link === o.link && x.params.part === 'box') : o;
  if (!box || box.params.photoMode !== 'color' || s.objects.some((x) => x.link && x.link === box.link && x.params.part === 'photo')) return;
  s.edit('add lid photo', () => { box.link ||= `L${uid()}`; box.local = ['part']; s.objects.push({ ...JSON.parse(JSON.stringify(box)), id: uid(), name: 'Folding box · Lid photo', color: '#1D1F24', params: { ...box.params, part: 'photo' } }); });
}

/** Text keys a model can be personalised with. */
function nameKeys(o) {
  if (o.type !== 'shape') return [];
  if (o.kind === 'layer') return ['studio'];
  const def = kindDef(o.kind); return (def?.params || []).filter((f) => f.type === 'text' && /name|text|initial/.test(f.key)).map((f) => f.key);
}
export function canMakeMany(o) { return nameKeys(o).length > 0; }
/** "Generate many at once": one copy of the model (with all its linked parts) for every line of names. */
export function makeMany(app, o) {
  const keys = nameKeys(o); if (!keys.length) { app.toast('Select a model with a name or text to make many.'); return; }
  const s = app.scene; const group = o.link ? s.objects.filter((x) => x.link === o.link) : [o];
  const key = keys.includes('name') ? 'name' : keys[0];
  const ta = h('textarea', { rows: 8, placeholder: 'One name per line', onkeydown: (e) => e.stopPropagation() });
  const alsoInitial = keys.includes('initial') ? h('input', { type: 'checkbox', checked: true, style: { justifySelf: 'end' } }) : null;
  const go = () => {
    const names = ta.value.split('\n').map((x) => x.trim()).filter(Boolean); if (!names.length) return;
    const made = [];
    s.edit(`make ${names.length}`, () => {
      for (const nm of names) {
        const link = `L${uid()}`; const copies = group.map((g) => { const c = JSON.parse(JSON.stringify((({ _error, ...rest }) => rest)(g))); c.id = uid(); if (g.link) c.link = link; return c; });
        for (const c of copies) {
          if (key === 'studio') { const doc = c.params.doc; const t = doc.layers.flatMap((l) => l.elements).find((e) => e.type === 'text'); if (t) t.text = nm; doc.name = nm; c.params = { ...c.params, doc }; }
          else { c.params = { ...c.params, [key]: nm }; if (alsoInitial?.checked) c.params.initial = nm[0].toUpperCase(); }
          c.name = c.name.replace(/^[^·]+/, `${nm} `).trim();
        }
        // place the whole set in a free spot
        const boxes = copies.map((c) => s.worldBox(c)).filter(Boolean); const b = { min: [Math.min(...boxes.map((x) => x.min[0])), Math.min(...boxes.map((x) => x.min[1]))], max: [Math.max(...boxes.map((x) => x.max[0])), Math.max(...boxes.map((x) => x.max[1]))] };
        const at = app.spawnPoint(b.max[0] - b.min[0], b.max[1] - b.min[1]); const dx = at[0] - (b.min[0] + b.max[0]) / 2, dy = at[1] - (b.min[1] + b.max[1]) / 2;
        for (const c of copies) { c.pos = [c.pos[0] + dx, c.pos[1] + dy, c.pos[2]]; s.objects.push(c); made.push(c); }
      }
      s.selection = new Set(made.map((c) => c.id));
    });
    s.emit('select'); d.close(); app.view.fit(); app.toast(`Made ${names.length} copies. Anything that didn’t fit on the plate is placed beside it.`);
  };
  const d = app.modal('Make many at once', h('div', { class: 'maker-side', style: { minWidth: '340px' } }, h('p', { class: 'note' }, `One copy of “${o.name.split('·')[0].trim()}” for each name${group.length > 1 ? `, with all ${group.length} parts` : ''}.`), ta,
    alsoInitial ? row('Use each name’s first letter as the initial', alsoInitial) : null),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Make them')));
}

export function install(app) {
  app.editors ||= {};
  app.editors.litholetter = (o) => pickPhoto(app, o);
  app.editors.foldbox = (o) => pickPhoto(app, o);
  app.editors.lithofan = (o) => pickFan(app, o);
  app.makeMany = (o) => makeMany(app, o);
  app.canMakeMany = canMakeMany;
  for (const m of MODELS) app.addAction({ label: m.label, group: 'Models', iconHtml: m.icon, run: () => addModel(app, m) });
  app.addAction({ label: 'Make many at once', group: 'Models', run: () => { const o = app.scene.selected()[0]; if (o) makeMany(app, o); else app.toast('Select a model with a name first.'); } });
  app.library.addTab('models', 'Models', (el) => {
    el.append(h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Complete models: change the numbers and colours in the panel on the right. Models with several parts keep them linked.'));
    el.append(h('div', { class: 'gen-list' }, ...MODELS.map((m) => h('button', { class: 'gen-btn', onclick: () => addModel(app, m) }, h('span', { html: m.icon }), h('b', {}, m.label), h('span', {}, m.blurb)))));
  });
  // The decorative text fonts download only when something uses them (a name sign, a text part, the Text tool), not
  // on every visit. Text drawn before they arrive uses a fallback font and is rebuilt once they're in.
  app.needFonts = () => {
    if (app._decorFonts) return app._decorFonts;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = DECOR_FONTS_CSS; document.head.append(l);
    app._decorFonts = new Promise((res) => { l.onload = res; l.onerror = res; })
      .then(() => Promise.all(DECOR_FAMS.map((f) => document.fonts.load(`40px "${f}"`))))
      .then(() => { dropCache((k) => /"font"|"initFont"|font\\"/.test(k)); clearDocCache(); app.scene.emit('change', { structure: true }); app.view?.redraw?.(); })
      .catch(() => {});
    return app._decorFonts;
  };
  const usesDecor = () => app.scene.objects.some(function u(o) { return (o.params && DECOR_RE.test(JSON.stringify(o.params))) || (o.children || []).some(u); });
  app.scene.on('change', () => { if (!app._decorFonts && usesDecor()) app.needFonts(); });
}
