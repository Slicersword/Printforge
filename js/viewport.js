// 3D viewport: draws the scene and handles pointer interaction.
import { Renderer, hex, normalMatrix } from './renderer.js';
import { transformPoint, rayTri, rayAabb, v3, clamp, deg, fmt, eulerMatrix, eulerFromMatrix, mul } from './math.js';
import { K, renderData } from './kernel.js';
import { axisMap } from './ui.js';

export class Viewport {
  constructor(app, canvas) {
    this.app = app; this.scene = app.scene; this.canvas = canvas;
    this.r = new Renderer(canvas);
    this.needs = true; this.mode = 'design'; this.showOverhang = false;
    this.tool = 'move'; // move | rotate | scale — the transform gizmo
    this.pointers = new Map();
    this.labels = [];
    this._initHandle();
    this._bind();
    const loop = () => { if (this.needs) { this.needs = false; this._draw(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    new ResizeObserver(() => this.redraw()).observe(canvas);
  }
  redraw() { this.needs = true; }

  setTool(t) { if (this.tool === t) return; this.tool = t; this._face = null; this._hoverAxis = null; this.canvas.style.cursor = t === 'flatten' ? 'crosshair' : ''; this.app.emit?.('tool', t); this.redraw(); }

  _initHandle() {
    // Lift cone kept for the old top handle (used as the Move-Z grip too).
    const cone = K.Manifold.cylinder(7, 3.2, 0, 24).add(K.Manifold.cylinder(5, 0.9, 0.9, 12).translate([0, 0, -5]));
    this.handleRD = renderData({ man: cone, render: null });
    // Gizmo handle shapes, each centred on its own tip so a model matrix just places + scales it.
    const arrow = K.Manifold.cylinder(9, 2.6, 0, 20).translate([0, 0, -4.5])
      .add(K.Manifold.cylinder(6, 0.8, 0.8, 10).translate([0, 0, -10.5]));
    this.arrowRD = renderData({ man: arrow, render: null });
    const cube = K.Manifold.cube([5, 5, 5], true);
    this.cubeRD = renderData({ man: cube, render: null });
    const ball = K.Manifold.sphere(3.3, 16);
    this.ballRD = renderData({ man: ball, render: null });
  }

  // ------------------------------------------------------------ transform gizmo
  // Axis colours: X red, Y green, Z blue (the universal CAD convention, as in Bambu Studio / PaliCAD).
  _axisRGB(i, hot) {
    const base = i === 3 ? [0.96, 0.96, 0.98] : [[0.92, 0.26, 0.28], [0.30, 0.74, 0.34], [0.26, 0.52, 0.95]][i];
    return hot ? [Math.min(1, base[0] + 0.25), Math.min(1, base[1] + 0.25), Math.min(1, base[2] + 0.25)] : base;
  }
  /** Where the gizmo sits and how big, from the current selection box. Returns null if nothing is selected. */
  _gizmo() {
    const sel = this.scene.selected();
    if (!sel.length || this.mode !== 'design' || this.tool === 'flatten' || this.measure) return null;
    const box = this.scene.selectionBox(sel); if (!box) return null;
    const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const screen = this.r.cam.dist / 300;            // keep roughly constant size on screen
    const len = Math.max(span * 0.62 + 10, 18 * screen); // reach past the part
    return { c, len, s: screen, box, ring: Math.max(span * 0.62 + 6, 16 * screen) };
  }
  /** In-plane basis (u, v) for a ring around world axis i, with u × v = axis (so +angle is a right-hand turn). */
  _ringBasis(i) { return i === 0 ? [[0, 1, 0], [0, 0, 1]] : i === 1 ? [[0, 0, 1], [1, 0, 0]] : [[1, 0, 0], [0, 1, 0]]; }
  _ringPoints(g, i, n = 72) {
    const [u, v] = this._ringBasis(i); const pts = [];
    for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI * 2, cs = Math.cos(t) * g.ring, sn = Math.sin(t) * g.ring; pts.push([g.c[0] + u[0] * cs + v[0] * sn, g.c[1] + u[1] * cs + v[1] * sn, g.c[2] + u[2] * cs + v[2] * sn]); }
    return pts;
  }
  /** Corner handle for scaling every side at once. */
  _uniformPos(g) { const k = g.len * 0.62; return [g.c[0] + k, g.c[1] - k, g.c[2] + k]; }
  /** Screen positions of each axis tip, for hit-testing and drawing. */
  _gizmoTips(g) {
    const tips = [];
    for (let i = 0; i < 3; i++) {
      const dir = [0, 0, 0]; dir[i] = 1;
      const pos = [g.c[0] + dir[0] * g.len, g.c[1] + dir[1] * g.len, g.c[2] + dir[2] * g.len];
      tips.push({ i, dir, pos, q: this.r.project(pos) });
    }
    return tips;
  }
  _gizmoHit(x, y) {
    const g = this._gizmo(); if (!g) return null;
    let best = null;
    const take = (hit) => { if (!best || hit.d < best.d) best = hit; };
    if (this.tool === 'rotate') {
      for (let i = 0; i < 3; i++) {
        const q = this._ringPoints(g, i, 48).map((p) => this.r.project(p));
        for (let k = 0; k + 1 < q.length; k++) {
          if (!q[k] || !q[k + 1]) continue; const d = segDist(x, y, q[k], q[k + 1]);
          if (d < 9) take({ kind: 'ring', axis: i, dir: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], d, g });
        }
      }
      return best;
    }
    for (const t of this._gizmoTips(g)) {
      if (!t.q) continue; const d = Math.hypot(t.q[0] - x, t.q[1] - y);
      if (d < 17) take({ kind: 'axis', axis: t.i, dir: t.dir, d, g });
    }
    if (this.tool === 'scale') {
      const q = this.r.project(this._uniformPos(g));
      if (q) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < 17) take({ kind: 'uniform', axis: 3, dir: [1, 1, 1], d, g }); }
    }
    return best;
  }

  // ------------------------------------------------------------ drawing
  items() {
    const s = this.scene, out = [], prep = this.mode === 'prepare';
    if (this.mode === 'preview') return out;
    const pv = this.mode === 'design' ? this.preview : null; // boolean preview: inputs drawn as ghosts
    for (const o of s.objects) {
      if (o.visible === false) continue;
      if (prep && o.hole) continue;
      const e = s.geometry(o); if (!e) continue;
      const m = s.matrix(o);
      const it = { obj: o, rd: e.render, model: m, normalMat: normalMatrix(m), rgb: hex(o.hole ? '#9AA3AD' : o.color), hole: o.hole, selected: s.selection.has(o.id), flip: o.scale[0] * o.scale[1] * o.scale[2] < 0, centre: transformPoint(m, [0, 0, 0]) };
      if (pv?.ghost?.has(o.id)) { const role = pv.ghost.get(o.id); it.selected = false; if (role === 'B') { it.hole = true; } else { it.alpha = 0.16; } }
      out.push(it);
    }
    return out;
  }
  _draw() {
    const items = this.items(); const s = this.scene; this._items = items;
    const extras = { lines: [], handles: [] };
    const sel = s.selected();
    let box = null;
    if (sel.length && this.mode === 'design') {
      box = s.selectionBox(sel);
      if (box) {
        extras.lines.push({ data: boxLines(box), color: [...this.r.theme.accent, 0.75] });
        // shadow footprint on the plate
        if (box.min[2] > 0.01) extras.lines.push({ data: rectLines(box, 0), color: [...this.r.theme.accent, 0.35] });
        this._drawGizmo(extras);
      } else this.handlePos = null;
    } else this.handlePos = null;
    if (this.extraLines) extras.lines.push(...this.extraLines);
    const ms = this.measure;
    if (ms?.a) { const b = ms.b || ms.hover; if (b) extras.lines.push({ data: new Float32Array([...ms.a, ...b]), color: [0.95, 0.45, 0.15, 1], noDepth: true }); }
    this.r.overhang = (this.mode === 'prepare' && this.showOverhang) ? Math.cos((90 - this.scene.settings.overhang) * deg) : 0;
    this.app.emit?.('draw-extras', extras);
    const drawn = items.slice();
    if (this.mode === 'design' && this.preview?.items) for (const p of this.preview.items) drawn.push(p);
    if (this._face && this.tool === 'flatten') drawn.push(this._face.item);
    this.r.draw(drawn, extras);
    this._labels(box);
    if (ms?.a) { const b = ms.b || ms.hover; if (b) { const d = [b[0] - ms.a[0], b[1] - ms.a[1], b[2] - ms.a[2]]; this._label([(ms.a[0] + b[0]) / 2, (ms.a[1] + b[1]) / 2, (ms.a[2] + b[2]) / 2], `${fmt(Math.hypot(...d), 2)} mm  (Δx ${fmt(Math.abs(d[0]), 1)} · Δy ${fmt(Math.abs(d[1]), 1)} · Δz ${fmt(Math.abs(d[2]), 1)})`, 'measure'); } }
    this.app.emit?.('drawn');
  }
  _drawGizmo(extras) {
    const g = this._gizmo(); if (!g) { this.handlePos = null; return; }
    this.handlePos = null; // the old lift handle is replaced by the Z arrow
    const hotAxis = this._dragAxis != null ? this._dragAxis : this._hoverAxis;
    if (this.tool === 'rotate') {
      for (let i = 0; i < 3; i++) {
        const hot = hotAxis === i; const pts = this._ringPoints(g, i); const d = [];
        for (let k = 0; k + 1 < pts.length; k++) d.push(...pts[k], ...pts[k + 1]);
        extras.lines.push({ data: new Float32Array(d), color: [...this._axisRGB(i, hot), hot ? 1 : 0.8], noDepth: true });
        if (hot) { const inner = this._ringPoints({ ...g, ring: g.ring * 0.985 }, i); const d2 = []; for (let k = 0; k + 1 < inner.length; k++) d2.push(...inner[k], ...inner[k + 1]); extras.lines.push({ data: new Float32Array(d2), color: [...this._axisRGB(i, true), 1], noDepth: true }); }
      }
      // while turning, show the start and current spokes
      const st = this.state;
      if (st?.mode === 'gizmo' && st.kind === 'ring' && st.began) {
        const [u, v] = this._ringBasis(st.axis); const R = g.ring;
        const at = (a) => [st.c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * R, st.c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * R, st.c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * R];
        const a0 = st.theta0, a1 = st.theta0 + st.accum * deg; const d = [...st.c, ...at(a0), ...st.c, ...at(a1)];
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.08)); for (let k = 0; k < n; k++) d.push(...at(a0 + (a1 - a0) * k / n), ...at(a0 + (a1 - a0) * (k + 1) / n));
        extras.lines.push({ data: new Float32Array(d), color: [...this.r.theme.accent, 1], noDepth: true });
      }
      this._gizmoCache = g; return;
    }
    const rd = this.tool === 'scale' ? this.cubeRD : this.arrowRD;
    for (const t of this._gizmoTips(g)) {
      const hot = hotAxis === t.i;
      const rgb = this._axisRGB(t.i, hot);
      extras.lines.push({ data: new Float32Array([...g.c, ...t.pos]), color: [...rgb, hot ? 1 : 0.85], noDepth: true });
      const sc = g.s * (hot ? 1.18 : 1);
      const m = this._axisHandleMatrix(t.i, t.pos, sc);
      extras.handles.push({ rd, model: m, normalMat: normalMatrix(m), rgb, alpha: 1, selected: false });
    }
    if (this.tool === 'scale') {
      const hot = hotAxis === 3; const p = this._uniformPos(g); const rgb = this._axisRGB(3, hot);
      extras.lines.push({ data: new Float32Array([...g.c, ...p]), color: [...rgb, hot ? 1 : 0.7], noDepth: true });
      const m = this._axisHandleMatrix(2, p, g.s * (hot ? 1.3 : 1.12));
      extras.handles.push({ rd: this.cubeRD, model: m, normalMat: normalMatrix(m), rgb, alpha: 1, selected: false });
    }
    this._gizmoCache = g;
  }
  /** Column-major model matrix: scale by sc, rotate local +Z onto the given world axis, translate to pos. */
  _axisHandleMatrix(axis, pos, sc) {
    // local +Z maps to: X axis -> +X (rotate +90° about Y), Y axis -> +Y (rotate -90° about X), Z axis -> +Z (identity)
    let R;
    if (axis === 0) R = [0, 0, -1, 1, 0, 0, 0, -1, 0];     // columns of rotation sending Z->X
    else if (axis === 1) R = [1, 0, 0, 0, 0, 1, 0, -1, 0];  // Z->Y
    else R = [1, 0, 0, 0, 1, 0, 0, 0, 1];                   // Z->Z
    return new Float64Array([
      R[0] * sc, R[1] * sc, R[2] * sc, 0,
      R[3] * sc, R[4] * sc, R[5] * sc, 0,
      R[6] * sc, R[7] * sc, R[8] * sc, 0,
      pos[0], pos[1], pos[2], 1,
    ]);
  }

  _labels(box) {
    const host = this.canvas.parentElement;
    this.labels.forEach((l) => l.remove()); this.labels = [];
    if (!box || this.dragging) { if (!box) return; }
    const add = (p, text) => { const q = this.r.project(p); if (!q) return; const d = document.createElement('div'); d.className = 'dimlabel'; d.textContent = text; d.style.left = q[0] + 'px'; d.style.top = q[1] + 'px'; host.appendChild(d); this.labels.push(d); };
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
    const qa = this.r.project(box.min), qb = this.r.project(box.max);
    if (qa && qb && Math.hypot(qa[0] - qb[0], qa[1] - qb[1]) < 70) return; // too small on screen for readable labels
    add([(x0 + x1) / 2, y0 - 4, z0], fmt(x1 - x0, 2));
    add([x1 + 4, (y0 + y1) / 2, z0], fmt(y1 - y0, 2));
    add([x1 + 3, y0 - 3, (z0 + z1) / 2], fmt(z1 - z0, 2));
    if (z0 > 0.01 || z0 < -0.01) add([x0 - 3, y0 - 3, z0 / 2], '↑ ' + fmt(z0, 2));
  }

  _label(p, text, cls = '') { const q = this.r.project(p); if (!q) return; const d = document.createElement('div'); d.className = 'dimlabel ' + cls; d.textContent = text; d.style.left = q[0] + 'px'; d.style.top = q[1] + 'px'; this.canvas.parentElement.appendChild(d); this.labels.push(d); }
  setMeasure(on) { this.measure = on ? { a: null, b: null } : null; this.canvas.style.cursor = on ? 'crosshair' : ''; this.app.emit('measure', !!on); this.redraw(); }
  _measurePoint(x, y) { const hit = this.pick(x, y); return hit ? hit.point : this.planeHit(x, y, 0); }

  // ------------------------------------------------------------ picking
  pick(x, y) {
    const { o, d } = this.r.ray(x, y); let best = null;
    for (const it of this._items || this.items()) {
      if (!it.obj) continue;
      const inv = this.scene.inverse(it.obj);
      const lo = transformPoint(inv, o), ld = v3.sub(transformPoint(inv, v3.add(o, d)), lo);
      const rd = it.rd; if (!rayAabb(lo, ld, rd.bbox.min, rd.bbox.max)) continue;
      const P = rd.P, T = rd.T;
      for (let f = 0; f < T.length; f += 3) {
        const a = T[f] * 3, b = T[f + 1] * 3, c = T[f + 2] * 3;
        const t = rayTri(lo, ld, [P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]);
        if (t > 0) {
          const wp = transformPoint(it.model, v3.add(lo, v3.scale(ld, t))); const dist = v3.len(v3.sub(wp, o));
          // prefer solids over holes when both are hit at similar depth
          const score = dist + (it.hole ? 0.5 : 0);
          if (!best || score < best.score) best = { obj: it.obj, point: wp, score, face: f / 3, it };
        }
      }
    }
    return best;
  }
  planeHit(x, y, z) {
    const { o, d } = this.r.ray(x, y); if (Math.abs(d[2]) < 1e-6) return null;
    const t = (z - o[2]) / d[2]; if (t < 0) return null; return v3.add(o, v3.scale(d, t));
  }

  // ------------------------------------------------------------ input
  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => { const h = this.pick(e.offsetX, e.offsetY); if (h) this.app.openEditor?.(h.obj); });
  }
  _down(e) {
    this.canvas.focus(); this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 2) { this._abortDrag(); this.state = { mode: 'touch2', ...this._touchInfo() }; return; }
    const x = e.offsetX, y = e.offsetY; const btn = e.pointerType === 'touch' ? 0 : e.button;
    this.state = { x0: x, y0: y, lx: x, ly: y, moved: false };
    if (this.measure && btn === 0) { this.state.mode = 'orbit'; this.state.measureClick = true; return; }
    if (btn === 1 || (btn === 2 && e.shiftKey)) { this.state.mode = 'pan'; return; }
    if (btn === 2) { this.state.mode = 'orbit'; return; }
    if (this.mode === 'design' && this.tool === 'flatten' && btn === 0) {
      const f = this._faceAt(x, y); if (f) { this.state.mode = 'face'; this.state.face = f; return; }
    }
    if (this.mode === 'design') {
      const gh = this._gizmoHit(x, y);
      if (gh) { this._startGizmo(gh, x, y); return; }
    }
    const hit = this.pick(x, y);
    if (hit && this.mode === 'design' && !hit.obj.locked) {
      const s = this.scene;
      if (!s.selection.has(hit.obj.id)) s.select(hit.obj.id, e.shiftKey || e.ctrlKey || e.metaKey);
      else this.state.toggleOnClick = e.shiftKey || e.ctrlKey || e.metaKey;
      this.state.mode = 'maybeDrag'; this.state.hit = hit; this.state.alt = e.altKey;
      this.state.plane = hit.point[2];
    } else if (hit && this.mode === 'prepare') {
      this.state.mode = 'maybeDrag'; this.state.hit = hit; this.state.plane = 0;
      if (!this.scene.selection.has(hit.obj.id)) this.scene.select(hit.obj.id, e.shiftKey);
    } else { this.state.mode = 'orbit'; this.state.clickEmpty = true; }
  }
  _move(e) {
    const tracked = this.pointers.has(e.pointerId);
    if (tracked) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const st = tracked ? this.state : null;
    if (!tracked && this.state) return;
    if (this.measure && this.measure.a && !this.measure.b) { this.measure.hover = this._measurePoint(e.offsetX, e.offsetY); this.redraw(); }
    if (!st) {
      // hover-highlight gizmo axes when idle
      if (this.mode === 'design' && this.tool === 'flatten') { const now = performance.now(); if (now - (this._lastHover || 0) > 30) { this._lastHover = now; this._hoverFace(e.offsetX, e.offsetY); } return; }
      if (this.mode === 'design') { const gh = this._gizmoHit(e.offsetX, e.offsetY); const a = gh ? gh.axis : null; if (a !== this._hoverAxis) { this._hoverAxis = a; this.canvas.style.cursor = a != null ? 'pointer' : ''; this.redraw(); } }
      return;
    }
    if (st.mode === 'gizmo') { this._dragGizmo(e); return; }
    if (st.mode === 'face') { if (Math.hypot(e.offsetX - st.x0, e.offsetY - st.y0) > 4) { st.mode = 'orbit'; st.moved = true; } else return; }
    if (st.mode === 'touch2') { this._touch2(); return; }
    const x = e.offsetX, y = e.offsetY, dx = x - st.lx, dy = y - st.ly; st.lx = x; st.ly = y;
    if (!st.moved && Math.hypot(x - st.x0, y - st.y0) > 3) st.moved = true;
    const cam = this.r.cam;
    if (st.mode === 'orbit' && st.moved) { cam.yaw -= dx * 0.4; cam.pitch = clamp(cam.pitch + dy * 0.4, -89.9, 89.9); this.redraw(); }
    else if (st.mode === 'pan') { this._pan(dx, dy); }
    else if (st.mode === 'maybeDrag' && st.moved) {
      const s = this.scene;
      s.begin('move');
      if (st.alt) { const copies = s.duplicate([...s.selection], [0, 0, 0]); s.undoStack.pop(); void copies; }
      st.mode = 'drag'; st.start = s.selected().map((o) => [...o.pos]); st.p0 = this.planeHit(st.x0, st.y0, st.plane) || st.hit.point;
      this.dragging = true;
    }
    if (st.mode === 'drag') {
      const p = this.planeHit(x, y, st.plane); if (!p) return;
      const snap = e.ctrlKey || e.metaKey ? 0 : this.scene.settings.snap;
      let ddx = p[0] - st.p0[0], ddy = p[1] - st.p0[1];
      if (e.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
      if (snap) { ddx = Math.round(ddx / snap) * snap; ddy = Math.round(ddy / snap) * snap; }
      this.scene.selected().forEach((o, i) => { o.pos = [st.start[i][0] + ddx, st.start[i][1] + ddy, st.start[i][2]]; });
      this.app.onLiveChange(); this.redraw();
    }
  }
  _up(e) {
    this.pointers.delete(e.pointerId);
    const st = this.state; if (!st) return;
    if (st.mode === 'touch2') { if (this.pointers.size === 0) this.state = null; return; }
    if (st.measureClick && !st.moved) {
      const p = this._measurePoint(st.x0, st.y0); const ms = this.measure;
      if (p) { if (!ms.a || ms.b) { ms.a = p; ms.b = null; } else ms.b = p; }
      this.state = null; this.redraw(); return;
    }
    if (st.mode === 'face') { this.state = null; this.app.layOnFace?.(st.face.obj, st.face.normal); this._face = null; this.redraw(); return; }
    if (st.mode === 'gizmo') { this.dragging = false; this._dragAxis = null; this.labels.forEach((l) => l.remove()); this.labels = []; if (st.began) this.scene.commit(); this.state = null; this.redraw(); return; }
    if (st.mode === 'drag' || st.mode === 'lift') { this.dragging = false; this.scene.commit(); }
    else if (st.mode === 'maybeDrag' && !st.moved) {
      if (st.toggleOnClick) this.scene.select(st.hit.obj.id, true);
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.scene.select(st.hit.obj.id);
    } else if (st.clickEmpty && !st.moved) this.scene.clearSelection();
    this.state = null; this.redraw();
  }
  _abortDrag() { if (this.state && (this.state.mode === 'drag' || this.state.mode === 'lift' || this.state.mode === 'gizmo')) { this.dragging = false; this._dragAxis = null; if (this.state.began) this.scene.commit(); } }

  // ------------------------------------------------------------ gizmo dragging
  _startGizmo(gh, x, y) {
    const s = this.scene; const sel = s.selected();
    const g = gh.g; const c = g.c;
    this._dragAxis = gh.axis;
    const st = { mode: 'gizmo', kind: gh.kind, axis: gh.axis, dir: gh.dir, c, began: false, x0: x, y0: y, lx: x, ly: y,
      startPos: sel.map((o) => [...o.pos]), startRot: sel.map((o) => [...o.rot]), startScale: sel.map((o) => [...o.scale]),
      startBoxes: sel.map((o) => s.worldBox(o)), box: g.box, len: g.len, accum: 0 };
    st.p0 = gh.kind === 'axis' ? this._axisParam(x, y, c, gh.dir) : 0;
    const qc = this.r.project(c); st.qc = qc;
    st.a0 = qc ? Math.atan2(y - qc[1], x - qc[0]) : 0;
    st.r0 = qc ? Math.max(4, Math.hypot(x - qc[0], y - qc[1])) : 1;
    if (gh.kind === 'ring') { const th = this._ringAngle(x, y, c, gh.axis); st.theta0 = th ?? 0; st.screenMode = th == null; st.prevTheta = st.theta0; st.turn = 0; }
    this.state = st; this.dragging = true;
  }
  /** Signed distance of the pointer's closest approach along the world axis line through c. */
  _axisParam(x, y, c, dir) {
    const { o, d } = this.r.ray(x, y);
    const w0 = v3.sub(o, c);
    const a = v3.dot(d, d), b = v3.dot(d, dir), e = v3.dot(dir, dir);
    const dd = v3.dot(d, w0), ee = v3.dot(dir, w0);
    const denom = a * e - b * b; if (Math.abs(denom) < 1e-9) return 0;
    return (a * ee - b * dd) / denom; // parameter along dir (world mm)
  }
  /** Angle of the pointer around world axis i, measured in the ring's plane. null when the ring is seen edge-on. */
  _ringAngle(x, y, c, i) {
    const { o, d } = this.r.ray(x, y); const n = [0, 0, 0]; n[i] = 1;
    const dn = v3.dot(d, n); if (Math.abs(dn) < 0.12 * v3.len(d)) return null;
    const t = v3.dot(v3.sub(c, o), n) / dn; const p = v3.sub(v3.add(o, v3.scale(d, t)), c);
    const [u, v] = this._ringBasis(i); return Math.atan2(v3.dot(p, v), v3.dot(p, u));
  }
  _dragGizmo(e) {
    const st = this.state; const s = this.scene; const sel = s.selected();
    const x = e.offsetX, y = e.offsetY;
    if (!st.began && Math.hypot(x - st.x0, y - st.y0) < 2) return;
    if (!st.began) { s.begin(this.tool === 'rotate' ? 'rotate' : this.tool === 'scale' ? 'scale' : 'move'); st.began = true; }
    const axis = st.axis; const L = 'XYZ'[axis];
    if (this.tool === 'move') {
      const snap = (e.ctrlKey || e.metaKey) ? 0 : (e.shiftKey ? 10 : this.scene.settings.snap);
      let delta = this._axisParam(x, y, st.c, st.dir) - st.p0;
      if (snap) delta = Math.round(delta / snap) * snap;
      sel.forEach((o, i) => { o.pos = st.startPos[i].map((p, k) => (k === axis ? p + delta : p)); });
      this._gizmoLabel(st, `${L}  ${delta >= 0 ? '+' : ''}${fmt(delta, 2)} mm`);
    } else if (this.tool === 'scale') this._dragScale(st, e, x, y);
    else this._dragRotate(st, e, x, y);
    this.dragging = true; this.app.onLiveChange(); this.redraw();
  }
  /**
   * Scale like Bambu Studio: an axis cube stretches that side (Ctrl: only the side you drag, the opposite face stays put);
   * the white corner cube scales every side at once. Shift snaps to whole millimetres (axis) or 5 % steps (corner).
   */
  _dragScale(st, e, x, y) {
    const s = this.scene; const sel = s.selected(); const B = st.box; let f, fx = [1, 1, 1], pivot, label;
    if (st.kind === 'uniform') {
      const qc = st.qc || this.r.project(st.c); if (!qc) return;
      f = Math.hypot(x - qc[0], y - qc[1]) / st.r0; if (e.shiftKey) f = Math.max(0.05, Math.round(f * 20) / 20);
      f = clamp(f, 0.02, 50); fx = [f, f, f];
      pivot = [(B.min[0] + B.max[0]) / 2, (B.min[1] + B.max[1]) / 2, B.min[2]];
      label = `${fmt(f * 100, 0)}%  ·  ${fmt((B.max[0] - B.min[0]) * f, 1)} × ${fmt((B.max[1] - B.min[1]) * f, 1)} × ${fmt((B.max[2] - B.min[2]) * f, 1)} mm`;
    } else {
      const a = st.axis; const span = Math.max(1e-3, B.max[a] - B.min[a]);
      const oneSide = e.ctrlKey || e.metaKey || a === 2;
      const d = this._axisParam(x, y, st.c, st.dir) - st.p0;
      let size = span + (oneSide ? d : 2 * d); if (e.shiftKey) size = Math.round(size);
      size = clamp(size, span * 0.02, span * 50); f = size / span; fx[a] = f;
      pivot = [(B.min[0] + B.max[0]) / 2, (B.min[1] + B.max[1]) / 2, (B.min[2] + B.max[2]) / 2];
      if (oneSide) pivot[a] = B.min[a];
      label = `${'WDH'[a]}  ${fmt(size, 2)} mm  (${fmt(f * 100, 0)}%)${oneSide && a !== 2 ? '  one side' : ''}`;
    }
    sel.forEach((o, i) => {
      const map = axisMap(o);
      o.scale = st.startScale[i].map((v, k) => { const w = map.indexOf(k); return v * (w >= 0 ? fx[w] : 1); });
      o.pos = [...st.startPos[i]];
      // place the new box so it scales about the pivot
      const ob = st.startBoxes[i], nb = s.worldBox(o); if (!ob || !nb) return;
      o.pos = o.pos.map((p, k) => p + (pivot[k] + (ob.min[k] - pivot[k]) * fx[k]) - nb.min[k]);
    });
    this._gizmoLabel(st, label);
  }
  /** Turn about the selection centre on the grabbed ring. Shift snaps to 15°; otherwise whole degrees. */
  _dragRotate(st, e, x, y) {
    const s = this.scene; const sel = s.selected(); const axis = st.axis;
    let ang;
    if (!st.screenMode) {
      const th = this._ringAngle(x, y, st.c, axis);
      if (th == null) return;
      let dth = th - st.prevTheta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
      st.turn += dth; st.prevTheta = th; ang = st.turn / deg;
    } else {
      // ring seen edge-on: fall back to the pointer's angle around the centre on screen
      const qc = st.qc || this.r.project(st.c); if (!qc) return;
      ang = (Math.atan2(y - qc[1], x - qc[0]) - st.a0) / deg; while (ang > 180) ang -= 360; while (ang < -180) ang += 360;
      const look = v3.sub(st.c, this.r.cam.eye()); if (look[axis] < 0) ang = -ang;
    }
    const snapped = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
    st.accum = snapped;
    const axisVec = [0, 0, 0]; axisVec[axis] = 1; const Rw = eulerMatrix(axisVec.map((a) => a * snapped));
    sel.forEach((o, i) => {
      o.rot = eulerFromMatrix(mul(Rw, eulerMatrix(st.startRot[i])));
      const rel = v3.sub(st.startPos[i], st.c); o.pos = v3.add(st.c, transformPoint(Rw, rel));
    });
    // keep the selection's lowest point where it was (on the plate stays on the plate)
    const nb = s.selectionBox(sel); if (nb) { const dz = st.box.min[2] - nb.min[2]; sel.forEach((o) => { o.pos = [o.pos[0], o.pos[1], o.pos[2] + dz]; }); }
    this._gizmoLabel(st, `${'XYZ'[axis]}  ${snapped > 0 ? '+' : ''}${snapped}°`);
  }
  _gizmoLabel(st, text) {
    this.labels.forEach((l) => l.remove()); this.labels = [];
    this._label(st.c, text, 'measure');
  }
  // ------------------------------------------------------------ lay on face
  /** The flat region under the pointer: every triangle coplanar with the one hit, plus its world normal. */
  _faceAt(x, y) {
    const hit = this.pick(x, y); if (!hit || hit.obj.locked) return null;
    const rd = hit.it.rd, { P, T, FN, nT } = rd; const f = hit.face;
    const n = [FN[f * 3], FN[f * 3 + 1], FN[f * 3 + 2]]; const a = T[f * 3] * 3; const d0 = n[0] * P[a] + n[1] * P[a + 1] + n[2] * P[a + 2];
    const size = Math.max(...[0, 1, 2].map((k) => rd.bbox.max[k] - rd.bbox.min[k])); const tol = Math.max(1e-3, size * 2e-4);
    const tris = [];
    for (let g = 0; g < nT; g++) {
      if (FN[g * 3] * n[0] + FN[g * 3 + 1] * n[1] + FN[g * 3 + 2] * n[2] < 0.9995) continue;
      const b = T[g * 3] * 3; if (Math.abs(n[0] * P[b] + n[1] * P[b + 1] + n[2] * P[b + 2] - d0) > tol) continue;
      tris.push(g);
    }
    const nm = hit.it.normalMat; // world normal = normal matrix × local normal
    let wn = [nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2], nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2], nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2]];
    const l = Math.hypot(...wn) || 1; wn = wn.map((v) => v / l);
    if (hit.it.flip) wn = wn.map((v) => -v);
    return { obj: hit.obj, it: hit.it, tris, normal: wn, key: `${hit.obj.id}:${tris[0]}:${tris.length}` };
  }
  _hoverFace(x, y) {
    const f = this._faceAt(x, y);
    if (!f) { if (this._face) { this._face = null; this.canvas.style.cursor = ''; this.redraw(); } return; }
    if (this._face?.key === f.key && this._face.model === f.it.model) return;
    const { P, T, FN } = f.it.rd; const pos = new Float32Array(f.tris.length * 9), nor = new Float32Array(f.tris.length * 9);
    f.tris.forEach((g, j) => { for (let k = 0; k < 3; k++) { const v = T[g * 3 + k] * 3, o = j * 9 + k * 3; pos[o] = P[v]; pos[o + 1] = P[v + 1]; pos[o + 2] = P[v + 2]; nor[o] = FN[g * 3]; nor[o + 1] = FN[g * 3 + 1]; nor[o + 2] = FN[g * 3 + 2]; } });
    const rd = { pos, nor, edges: new Float32Array(0), bbox: f.it.rd.bbox };
    if (this._face?.item) this.r.release(this._face.item.rd);
    this._face = { key: f.key, model: f.it.model, item: { rd, model: f.it.model, normalMat: f.it.normalMat, rgb: [0.98, 0.52, 0.18], alpha: 0.8, hole: false, selected: false, flip: f.it.flip, centre: f.it.centre } };
    this.canvas.style.cursor = 'pointer'; this.redraw();
  }

  _pan(dx, dy) {
    const cam = this.r.cam; const h = this.canvas.clientHeight;
    const scale = (2 * cam.dist * Math.tan(cam.fov * deg / 2)) / h;
    const eye = cam.eye(); const f = v3.norm(v3.sub(cam.target, eye)); const right = v3.norm(v3.cross(f, cam.up())); const up = v3.cross(right, f);
    cam.target = v3.add(cam.target, v3.add(v3.scale(right, -dx * scale), v3.scale(up, dy * scale))); this.redraw();
  }
  _wheel(e) {
    e.preventDefault(); const cam = this.r.cam;
    const k = Math.exp(clamp(e.deltaY * (e.deltaMode === 1 ? 33 : 1), -200, 200) * 0.0012);
    const p = this.pick(e.offsetX, e.offsetY)?.point || this.planeHit(e.offsetX, e.offsetY, 0);
    const nd = clamp(cam.dist * k, 5, 6000);
    if (p && cam.persp) { const f = 1 - nd / cam.dist; cam.target = v3.add(cam.target, v3.scale(v3.sub(p, cam.target), f)); }
    cam.dist = nd; this.redraw();
  }
  _touchInfo() { const [a, b] = [...this.pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  _touch2() {
    const st = this.state; const t = this._touchInfo(); const cam = this.r.cam;
    if (st.d > 0) cam.dist = clamp(cam.dist * st.d / t.d, 5, 6000);
    this._pan(t.mx - st.mx, t.my - st.my); Object.assign(st, t); this.redraw();
  }

  setView(v) {
    const cam = this.r.cam;
    const views = { top: [-90, 89.9], front: [-90, 0], right: [0, 0], iso: [-55, 32], back: [90, 0], left: [180, 0], bottom: [-90, -89.9] };
    if (v === 'proj') { cam.persp = !cam.persp; this.redraw(); return cam.persp; }
    if (v === 'home') { this.fit(); return; }
    if (v === 'measure') { this.setMeasure(!this.measure); return; }
    if (views[v]) { [cam.yaw, cam.pitch] = views[v]; this.fit(true); }
  }
  fit(keep = true) {
    const s = this.scene; const box = s.selection.size ? s.selectionBox() : s.selectionBox(s.objects.filter((o) => o.visible !== false));
    const b = this.r.bed;
    this.r.frame(box || { min: [-b.w / 2, -b.d / 2, 0], max: [b.w / 2, b.d / 2, 30] }, keep); this.redraw();
  }
}

function boxLines(b) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max; const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; const d = [];
  for (let i = 0; i < 4; i++) { const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4]; d.push(ax, ay, z0, bx, by, z0, ax, ay, z1, bx, by, z1, ax, ay, z0, ax, ay, z1); }
  return new Float32Array(d);
}
function rectLines(b, z) {
  const [x0, y0] = b.min, [x1, y1] = b.max; return new Float32Array([x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z]);
}
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
