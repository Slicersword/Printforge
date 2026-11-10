// 3D viewport: draws the scene and handles pointer interaction.
import { Renderer, hex, normalMatrix } from './renderer.js';
import { transformPoint, rayTri, rayAabb, v3, clamp, deg, fmt, eulerMatrix, eulerFromMatrix } from './math.js';
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

  setTool(t) { if (this.tool === t) return; this.tool = t; this.app.emit?.('tool', t); this.redraw(); }

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
    const base = [[0.92, 0.26, 0.28], [0.30, 0.74, 0.34], [0.26, 0.52, 0.95]][i];
    return hot ? [Math.min(1, base[0] + 0.25), Math.min(1, base[1] + 0.25), Math.min(1, base[2] + 0.25)] : base;
  }
  /** Where the gizmo sits and how big, from the current selection box. Returns null if nothing is selected. */
  _gizmo() {
    const sel = this.scene.selected();
    if (!sel.length || this.mode !== 'design') return null;
    const box = this.scene.selectionBox(sel); if (!box) return null;
    const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const screen = this.r.cam.dist / 300;            // keep roughly constant size on screen
    const len = Math.max(span * 0.62 + 10, 18 * screen); // reach past the part
    return { c, len, s: screen, box };
  }
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
    const grab = this.tool === 'rotate' ? 20 : 17;
    let best = null;
    for (const t of this._gizmoTips(g)) {
      if (!t.q) continue; const d = Math.hypot(t.q[0] - x, t.q[1] - y);
      if (d < grab && (!best || d < best.d)) best = { axis: t.i, dir: t.dir, d, g };
    }
    return best;
  }

  // ------------------------------------------------------------ drawing
  items() {
    const s = this.scene, out = [], prep = this.mode === 'prepare';
    if (this.mode === 'preview') return out;
    for (const o of s.objects) {
      if (o.visible === false) continue;
      if (prep && o.hole) continue;
      const e = s.geometry(o); if (!e) continue;
      const m = s.matrix(o);
      out.push({ obj: o, rd: e.render, model: m, normalMat: normalMatrix(m), rgb: hex(o.hole ? '#9AA3AD' : o.color), hole: o.hole, selected: s.selection.has(o.id), flip: o.scale[0] * o.scale[1] * o.scale[2] < 0, centre: transformPoint(m, [0, 0, 0]) });
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
    this.r.draw(items, extras);
    this._labels(box);
    if (ms?.a) { const b = ms.b || ms.hover; if (b) { const d = [b[0] - ms.a[0], b[1] - ms.a[1], b[2] - ms.a[2]]; this._label([(ms.a[0] + b[0]) / 2, (ms.a[1] + b[1]) / 2, (ms.a[2] + b[2]) / 2], `${fmt(Math.hypot(...d), 2)} mm  (Δx ${fmt(Math.abs(d[0]), 1)} · Δy ${fmt(Math.abs(d[1]), 1)} · Δz ${fmt(Math.abs(d[2]), 1)})`, 'measure'); } }
    this.app.emit?.('drawn');
  }
  _drawGizmo(extras) {
    const g = this._gizmo(); if (!g) { this.handlePos = null; return; }
    this.handlePos = null; // the old lift handle is replaced by the Z arrow
    const rd = this.tool === 'scale' ? this.cubeRD : this.tool === 'rotate' ? this.ballRD : this.arrowRD;
    const hotAxis = this._dragAxis != null ? this._dragAxis : this._hoverAxis;
    for (const t of this._gizmoTips(g)) {
      const hot = hotAxis === t.i;
      const rgb = this._axisRGB(t.i, hot);
      // axis stem
      extras.lines.push({ data: new Float32Array([...g.c, ...t.pos]), color: [...rgb, hot ? 1 : 0.85], noDepth: true });
      // handle at the tip, oriented so the arrow points outward along its axis
      const sc = g.s * (hot ? 1.18 : 1);
      const m = this._axisHandleMatrix(t.i, t.pos, sc);
      extras.handles.push({ rd, model: m, normalMat: normalMatrix(m), rgb, alpha: 1, selected: false });
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
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const st = this.state;
    if (this.measure && this.measure.a && !this.measure.b) { this.measure.hover = this._measurePoint(e.offsetX, e.offsetY); this.redraw(); }
    if (!st) {
      // hover-highlight gizmo axes when idle
      if (this.mode === 'design') { const gh = this._gizmoHit(e.offsetX, e.offsetY); const a = gh ? gh.axis : null; if (a !== this._hoverAxis) { this._hoverAxis = a; this.canvas.style.cursor = a != null ? 'pointer' : ''; this.redraw(); } }
      return;
    }
    if (st.mode === 'gizmo') { this._dragGizmo(e); return; }
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
    const st = { mode: 'gizmo', axis: gh.axis, dir: gh.dir, c, began: false, x0: x, y0: y, lx: x, ly: y,
      startPos: sel.map((o) => [...o.pos]), startRot: sel.map((o) => [...o.rot]), startScale: sel.map((o) => [...o.scale]),
      box: g.box, len: g.len, accum: 0 };
    // Anchor point for translate/scale: where the axis ray is closest to the pointer ray now.
    st.p0 = this._axisParam(x, y, c, gh.dir);
    // Anchor angle for rotate: pointer angle around the axis in screen space, about the projected centre.
    const qc = this.r.project(c); st.qc = qc;
    st.a0 = qc ? Math.atan2(y - qc[1], x - qc[0]) : 0;
    this.state = st; this.dragging = true;
  }
  /** Signed distance of the pointer's closest approach along the world axis line through c. */
  _axisParam(x, y, c, dir) {
    const { o, d } = this.r.ray(x, y);
    // closest point between ray (o,d) and line (c,dir): solve for t along the axis
    const w0 = v3.sub(o, c);
    const a = v3.dot(d, d), b = v3.dot(d, dir), e = v3.dot(dir, dir);
    const dd = v3.dot(d, w0), ee = v3.dot(dir, w0);
    const denom = a * e - b * b; if (Math.abs(denom) < 1e-9) return 0;
    return (a * ee - b * dd) / denom; // parameter along dir (world mm)
  }
  _dragGizmo(e) {
    const st = this.state; const s = this.scene; const sel = s.selected();
    const x = e.offsetX, y = e.offsetY;
    if (!st.began && Math.hypot(x - st.x0, y - st.y0) < 2) return;
    if (!st.began) { s.begin(this.tool === 'rotate' ? 'rotate' : this.tool === 'scale' ? 'scale' : 'move'); st.began = true; }
    const snap = (e.ctrlKey || e.metaKey) ? 0 : this.scene.settings.snap;
    const axis = st.axis; const L = 'XYZ'[axis];
    if (this.tool === 'move') {
      let delta = this._axisParam(x, y, st.c, st.dir) - st.p0;
      if (snap) delta = Math.round(delta / snap) * snap;
      sel.forEach((o, i) => { o.pos = st.startPos[i].map((p, k) => (k === axis ? p + delta : p)); });
      this._gizmoLabel(st, `${L}  ${fmt(delta, 2)} mm`);
    } else if (this.tool === 'scale') {
      const cur = this._axisParam(x, y, st.c, st.dir);
      const span = Math.max(1e-3, st.box.max[axis] - st.box.min[axis]);
      const ref = Math.max(span / 2, st.len || span); // distance of the handle from centre
      let f = (ref + (cur - st.p0)) / ref; f = clamp(f, 0.05, 50);
      const uniform = e.shiftKey;
      sel.forEach((o, i) => {
        const map = axisMap(o);
        o.scale = st.startScale[i].map((v, k) => (uniform || k === map[axis] ? v * f : v));
      });
      // keep the selection sitting where it was on the plate
      sel.forEach((o) => { const nb = s.worldBox(o); if (nb) o.pos = [o.pos[0], o.pos[1], o.pos[2] + (st.box.min[2] - nb.min[2])]; });
      this._gizmoLabel(st, uniform ? `scale ${fmt(f * 100, 0)}%` : `${L}  ${fmt(f * 100, 0)}%`);
    } else { // rotate
      const qc = st.qc || this.r.project(st.c); if (!qc) return;
      let ang = (Math.atan2(y - qc[1], x - qc[0]) - st.a0) / deg;
      // normalise to -180..180 and flip so screen-clockwise reads as positive about the axis facing the camera
      while (ang > 180) ang -= 360; while (ang < -180) ang += 360;
      let snapped = e.shiftKey ? Math.round(ang / 15) * 15 : ang;
      const d = snapped - st.accum; st.accum = snapped;
      sel.forEach((o) => {
        const axisVec = [0, 0, 0]; axisVec[axis] = 1;
        const Rw = eulerMatrix(axisVec.map((a) => a * d)); const R = eulerMatrix(o.rot);
        const m = new Float64Array(16); for (let cc = 0; cc < 4; cc++) for (let rr = 0; rr < 4; rr++) { let sum = 0; for (let k = 0; k < 4; k++) sum += Rw[k * 4 + rr] * R[cc * 4 + k]; m[cc * 4 + rr] = sum; }
        o.rot = eulerFromMatrix(m);
      });
      this._gizmoLabel(st, `${L}  ${fmt(snapped, 1)}°`);
    }
    this.dragging = true; this.app.onLiveChange(); this.redraw();
  }
  _gizmoLabel(st, text) {
    this.labels.forEach((l) => l.remove()); this.labels = [];
    this._label(st.c, text, 'measure');
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
