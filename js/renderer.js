// Minimal WebGL2 renderer tuned for CAD previews (no third-party engine).
import { perspective, ortho, lookAt, mul, v3, invert, deg, clamp } from './math.js';

const MESH_VS = `#version 300 es
in vec3 aPos; in vec3 aNor;
uniform mat4 uModel, uVP; uniform mat3 uNorm;
out vec3 vN; out vec3 vW;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vW=w.xyz; vN=normalize(uNorm*aNor); gl_Position=uVP*w; }`;
const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; out vec4 o;
uniform vec3 uColor, uEye; uniform float uAlpha, uHole, uSel, uOverhang, uClip, uDark, uFlip; uniform vec3 uAccent;
void main(){
  if (vW.z > uClip) discard;
  vec3 n = normalize(vN); vec3 V = normalize(uEye - vW);
  bool back = gl_FrontFacing == (uFlip > 0.5); if (back) n = -n;
  vec3 L1 = normalize(vec3(0.45,-0.6,0.85)), L2 = normalize(vec3(-0.6,0.5,0.3));
  float d = max(dot(n,L1),0.0)*0.62 + max(dot(n,L2),0.0)*0.22 + 0.30 + 0.08*n.z;
  vec3 H = normalize(L1+V); float sp = pow(max(dot(n,H),0.0), 48.0)*0.18;
  vec3 col = uColor;
  if (uOverhang > 0.0 && !back) {
    float down = -n.z;
    if (vW.z > 0.15 && down > uOverhang) col = mix(col, vec3(0.93,0.22,0.2), 0.78);
  }
  col = col*d + sp;
  float rim = pow(1.0-max(dot(n,V),0.0), 3.0); col += uSel*rim*uAccent*0.9;
  col = mix(col, uAccent, uSel*0.12);
  if (back) col = vec3(0.95,0.55,0.18)*(0.55+0.3*d); // cut face when clipping
  float a = uAlpha;
  if (uHole > 0.5) {
    float s = mod(gl_FragCoord.x + gl_FragCoord.y, 9.0);
    float stripe = step(s, 1.6);
    col = mix(col, uDark > 0.5 ? vec3(0.85) : vec3(0.18,0.2,0.24), stripe*0.55);
    a = 0.42 + stripe*0.3;
  }
  o = vec4(col, a);
}`;
const LINE_VS = `#version 300 es
in vec3 aPos; uniform mat4 uModel, uVP; out vec3 vW;
void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; gl_Position=uVP*w; gl_Position.z -= 0.0004*gl_Position.w; }`;
const LINE_FS = `#version 300 es
precision highp float; in vec3 vW; uniform vec4 uColor; uniform float uClip; out vec4 o;
void main(){ if (vW.z > uClip + 0.01) discard; o=uColor; }`;
const CLINE_VS = `#version 300 es
in vec3 aPos; in vec3 aCol; uniform mat4 uVP; out vec3 vC;
void main(){ vC=aCol; gl_Position=uVP*vec4(aPos,1.0); }`;
const CLINE_FS = `#version 300 es
precision highp float; in vec3 vC; uniform float uAlpha; out vec4 o;
void main(){ o=vec4(vC,uAlpha); }`;
// Build plates: [base, minor grid, major grid] for light and dark themes.
export const PLATES = {
  textured: { label: 'Textured PEI', light: [[0.79, 0.67, 0.43], [0.62, 0.5, 0.3], [0.45, 0.35, 0.2]], dark: [[0.36, 0.3, 0.2], [0.25, 0.21, 0.14], [0.16, 0.13, 0.09]] },
  smooth: { label: 'Smooth black', light: [[0.2, 0.21, 0.23], [0.3, 0.31, 0.34], [0.42, 0.43, 0.47]], dark: [[0.13, 0.14, 0.15], [0.2, 0.21, 0.23], [0.3, 0.31, 0.34]] },
  cool: { label: 'Cool plate', light: [[0.78, 0.8, 0.82], [0.66, 0.68, 0.71], [0.52, 0.54, 0.58]], dark: [[0.32, 0.34, 0.37], [0.25, 0.27, 0.3], [0.18, 0.2, 0.22]] },
};
const PLATE_VS = `#version 300 es
in vec2 aPos; uniform mat4 uVP; uniform vec2 uSize; out vec2 vP;
void main(){ vP = aPos*uSize; gl_Position = uVP*vec4(vP, -0.02, 1.0); }`;
const PLATE_FS = `#version 300 es
precision highp float; in vec2 vP; out vec4 o;
uniform vec2 uSize; uniform vec3 uPlate, uMinor, uMajor; uniform float uRound, uStep;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float grid(vec2 p, float s){ vec2 g = abs(fract(p/s - 0.5) - 0.5)/fwidth(p/s); return 1.0 - min(min(g.x,g.y),1.0); }
void main(){
  if (uRound > 0.5 && length(vP) > uSize.x) discard;
  float fw = length(fwidth(vP));
  float fine = (hash(floor(vP*4.0)) - 0.5)*0.05*clamp(1.0 - fw*3.0, 0.0, 1.0);
  float speck = fine + (hash(floor(vP*0.25))-0.5)*0.02;
  vec3 c = uPlate + speck;
  c = mix(c, uMinor, grid(vP, uStep)*0.35);
  c = mix(c, uMajor, grid(vP, uStep*10.0)*0.6);
  vec2 ax = abs(vP)/fwidth(vP);
  if (ax.y < 1.2) c = mix(c, vec3(0.86,0.24,0.24), 0.8);
  if (ax.x < 1.2) c = mix(c, vec3(0.3,0.66,0.3), 0.8);
  o = vec4(c, 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u, a: { aPos: gl.getAttribLocation(p, 'aPos'), aNor: gl.getAttribLocation(p, 'aNor') } };
}

export const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export class Camera {
  constructor() { this.target = [0, 0, 10]; this.yaw = -55; this.pitch = 32; this.dist = 320; this.persp = true; this.fov = 40; }
  eye() {
    const cp = Math.cos(this.pitch * deg), sp = Math.sin(this.pitch * deg);
    return [this.target[0] + this.dist * cp * Math.cos(this.yaw * deg), this.target[1] + this.dist * cp * Math.sin(this.yaw * deg), this.target[2] + this.dist * sp];
  }
  up() { return Math.abs(this.pitch) > 89.5 ? [-Math.cos(this.yaw * deg) * Math.sign(this.pitch), -Math.sin(this.yaw * deg) * Math.sign(this.pitch), 0] : [0, 0, 1]; }
  matrices(aspect) {
    const eye = this.eye(); const view = lookAt(eye, this.target, this.up());
    const near = Math.max(0.5, this.dist / 200), far = this.dist * 20 + 4000;
    let proj;
    if (this.persp) proj = perspective(this.fov * deg, aspect, near, far);
    else { const h = this.dist * Math.tan(this.fov * deg / 2); proj = ortho(-h * aspect, h * aspect, -h, h, -far, far); }
    return { view, proj, vp: mul(proj, view), eye };
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.mesh = compile(gl, MESH_VS, MESH_FS);
    this.line = compile(gl, LINE_VS, LINE_FS);
    this.plate = compile(gl, PLATE_VS, PLATE_FS);
    this.cline = compile(gl, CLINE_VS, CLINE_FS); this.cline.a.aCol = gl.getAttribLocation(this.cline.p, 'aCol');
    this.cam = new Camera();
    this.buffers = new WeakMap(); // render data -> gl buffers
    this.quad = this._buf(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.theme = { dark: false, bg: [0.93, 0.945, 0.96], accent: [0.1, 0.62, 0.66], plate: 'textured' };
    this.bed = { w: 256, d: 256, h: 250, round: false, origin: 'centre' };
    this.clipZ = 1e9; this.overhang = 0; this.gridStep = 10;
  }
  _buf(data, target) { const gl = this.gl; const b = gl.createBuffer(); gl.bindBuffer(target || gl.ARRAY_BUFFER, b); gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  buffersFor(rd) {
    let b = this.buffers.get(rd);
    if (!b) { b = { pos: this._buf(rd.pos), nor: this._buf(rd.nor), count: rd.pos.length / 3, edges: rd.edges.length ? this._buf(rd.edges) : null, ecount: rd.edges.length / 3 }; this.buffersFor.lru = 0; this.buffers.set(rd, b); }
    return b;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  /** items: [{rd, model(Float64Array), normalMat, color, hole, selected, ghost, alpha}] */
  draw(items, extras = {}) {
    const gl = this.gl; this.resize();
    const W = this.canvas.width, H = this.canvas.height; gl.viewport(0, 0, W, H);
    const t = this.theme; gl.clearColor(t.bg[0], t.bg[1], t.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const M = this.cam.matrices(W / H); this.last = M;
    const vp = new Float32Array(M.vp);

    // plate
    const bed = this.bed; const P = this.plate; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform2f(P.u.uSize, bed.round ? bed.w / 2 : bed.w / 2, bed.round ? bed.w / 2 : bed.d / 2);
    gl.uniform1f(P.u.uRound, bed.round ? 1 : 0); gl.uniform1f(P.u.uStep, this.gridStep);
    const pc = (PLATES[t.plate] || PLATES.textured)[t.dark ? 'dark' : 'light'];
    gl.uniform3fv(P.u.uPlate, pc[0]); gl.uniform3fv(P.u.uMinor, pc[1]); gl.uniform3fv(P.u.uMajor, pc[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const drawMesh = (it, alphaPass) => {
      const S = this.mesh; const b = this.buffersFor(it.rd);
      gl.uniformMatrix4fv(S.u.uModel, false, new Float32Array(it.model));
      gl.uniformMatrix3fv(S.u.uNorm, false, it.normalMat);
      gl.uniform3fv(S.u.uColor, it.rgb); gl.uniform1f(S.u.uHole, it.hole ? 1 : 0); gl.uniform1f(S.u.uSel, it.selected ? 1 : 0);
      gl.uniform1f(S.u.uAlpha, alphaPass ? (it.alpha ?? 1) : 1); gl.uniform1f(S.u.uFlip, it.flip ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(S.a.aPos); gl.vertexAttribPointer(S.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nor); gl.enableVertexAttribArray(S.a.aNor); gl.vertexAttribPointer(S.a.aNor, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    };
    const S = this.mesh; gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.uVP, false, vp); gl.uniform3fv(S.u.uEye, M.eye); gl.uniform3fv(S.u.uAccent, t.accent);
    gl.uniform1f(S.u.uOverhang, this.overhang); gl.uniform1f(S.u.uClip, this.clipZ); gl.uniform1f(S.u.uDark, t.dark ? 1 : 0);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
    const opaque = items.filter((i) => !i.hole && !(i.alpha < 1)), trans = items.filter((i) => i.hole || i.alpha < 1);
    for (const it of opaque) drawMesh(it, false);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (extras.gcode) this._drawGcode(extras.gcode, vp);

    // lines: edges, bed volume, extras
    const L = this.line; gl.useProgram(L.p); gl.uniformMatrix4fv(L.u.uVP, false, vp); gl.uniform1f(L.u.uClip, this.clipZ);
    const lineCol = t.dark ? [1, 1, 1, 0.22] : [0.05, 0.08, 0.12, 0.35];
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const it of items) {
      const b = this.buffersFor(it.rd); if (!b.edges || it.hole) continue;
      gl.uniformMatrix4fv(L.u.uModel, false, new Float32Array(it.model));
      gl.uniform4fv(L.u.uColor, it.selected ? [...t.accent, 1] : lineCol);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.edges); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, b.ecount);
    }
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.uniformMatrix4fv(L.u.uModel, false, I); gl.uniform1f(L.u.uClip, 1e9);
    for (const ln of [this._bedLines(), ...(extras.lines || [])]) {
      if (!ln || !ln.data.length) continue;
      if (!ln.buf || ln.bufData !== ln.data) { ln.buf = this._buf(ln.data); ln.bufData = ln.data; }
      gl.uniform4fv(L.u.uColor, ln.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, ln.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (ln.noDepth) gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.LINES, 0, ln.data.length / 3);
      gl.enable(gl.DEPTH_TEST);
    }
    // translucent: holes and ghosts, sorted back to front
    gl.useProgram(S.p); gl.depthMask(false);
    const eye = M.eye; trans.sort((a, b) => dist2(b.centre, eye) - dist2(a.centre, eye));
    for (const it of trans) drawMesh(it, true);
    // extra handle meshes always on top
    gl.depthMask(true);
    if (extras.handles) { gl.clear(gl.DEPTH_BUFFER_BIT); for (const it of extras.handles) drawMesh(it, true); }
    gl.disable(gl.BLEND);
  }
  /** G-code toolpaths: { sets: [{ pos, col, buf?, start, count, alpha }] } drawn as coloured lines. */
  _drawGcode(g, vp) {
    const gl = this.gl; const C = this.cline; gl.useProgram(C.p); gl.uniformMatrix4fv(C.u.uVP, false, vp);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const set of g.sets) {
      if (!set.count) continue;
      if (!set.buf || set.bufFor !== set.pos) { if (set.buf) { gl.deleteBuffer(set.buf.p); gl.deleteBuffer(set.buf.c); } set.buf = { p: this._buf(set.pos), c: this._buf(set.col) }; set.bufFor = set.pos; }
      gl.uniform1f(C.u.uAlpha, set.alpha ?? 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, set.buf.p); gl.enableVertexAttribArray(C.a.aPos); gl.vertexAttribPointer(C.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, set.buf.c); gl.enableVertexAttribArray(C.a.aCol); gl.vertexAttribPointer(C.a.aCol, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, set.start || 0, set.count);
      gl.disableVertexAttribArray(C.a.aCol);
    }
    gl.disable(gl.BLEND);
  }
  _bedLines() {
    const b = this.bed; const key = `${b.w},${b.d},${b.h},${b.round},${this.theme.dark}`;
    if (this._bedKey === key) return this._bedL;
    const d = []; const push = (a, c) => d.push(...a, ...c);
    const corners = (z) => b.round ? null : [[-b.w / 2, -b.d / 2, z], [b.w / 2, -b.d / 2, z], [b.w / 2, b.d / 2, z], [-b.w / 2, b.d / 2, z]];
    if (b.round) {
      for (const z of [0, b.h]) for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, a2 = (i + 1) / 96 * Math.PI * 2; push([Math.cos(a) * b.w / 2, Math.sin(a) * b.w / 2, z], [Math.cos(a2) * b.w / 2, Math.sin(a2) * b.w / 2, z]); }
    } else {
      const lo = corners(0), hi = corners(b.h);
      for (let i = 0; i < 4; i++) { push(lo[i], lo[(i + 1) % 4]); push(hi[i], hi[(i + 1) % 4]); push(lo[i], hi[i]); }
    }
    this._bedKey = key; this._bedL = { data: new Float32Array(d), color: this.theme.dark ? [1, 1, 1, 0.16] : [0.1, 0.15, 0.25, 0.22] };
    return this._bedL;
  }
  /** Ray from canvas pixel (CSS px). */
  ray(x, y) {
    const c = this.canvas; const nx = (x / c.clientWidth) * 2 - 1, ny = 1 - (y / c.clientHeight) * 2;
    const M = this.last || this.cam.matrices(c.clientWidth / c.clientHeight); const inv = invert(M.vp);
    const un = (z) => { const v = [nx, ny, z, 1]; const o = [0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[r] += inv[k * 4 + r] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
    const a = un(-1), b = un(1); return { o: a, d: v3.norm(v3.sub(b, a)) };
  }
  project(p) {
    const M = this.last; if (!M) return null; const m = M.vp; const v = [p[0], p[1], p[2], 1]; const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[r] += m[k * 4 + r] * v[k];
    if (o[3] <= 0) return null; const c = this.canvas;
    return [(o[0] / o[3] + 1) / 2 * c.clientWidth, (1 - o[1] / o[3]) / 2 * c.clientHeight];
  }
  frame(box, keepAngles = true) {
    if (!box) return; const c = box.min.map((v, i) => (v + box.max[i]) / 2); const r = Math.max(10, v3.len(v3.sub(box.max, box.min)) / 2);
    this.cam.target = c; this.cam.dist = clamp(r / Math.sin(this.cam.fov * deg / 2) * 1.55, 40, 5000);
    if (!keepAngles) { this.cam.yaw = -55; this.cam.pitch = 32; }
  }
}
function dist2(a, b) { if (!a) return 0; return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; }

export function normalMatrix(m) {
  const inv = invert(m); // transpose of inverse upper 3x3
  return new Float32Array([inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]]);
}
