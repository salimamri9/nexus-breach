// 2.5D buildings on the GPU: every solid block is a real extruded box seen by a camera straight
// above, so towers lean out of the screen. Night shading, procedural lit windows (dark inside a
// blackout), rooftop machinery, blinking antennas and neon signs on the walls that face you.
import * as THREE from 'three';
import { TILE, PX, T, M, hash2 } from '/shared/world.js';
import { instancedSprites, frameRect, texture } from './sprites.js';
import { canvas } from './assets2d.js';

const S = 1 / PX;
const CONT_COLS = ['#a8432c', '#2f5a96', '#38703f', '#c06d22', '#6f6f74'];
const TOWER_COLS = ['#6a6e78', '#77716a', '#58606e', '#7a756f', '#686b70', '#6e6a7a', '#626a62', '#78716e'];
const EXTRUDE = new Set([T.WALL, T.TOWER, T.CORE_SOLID, T.CONTAINER, T.FENCE]);
// tall towers are compressed so the top-down perspective stays readable
export const zVis = (z) => 48 * (1 - Math.exp(-z / 40));

const VS = `
attribute vec2 aUV; attribute vec4 aStyle; attribute float aSeed; attribute vec2 aSize;
varying vec3 vN; varying vec3 vW; varying vec2 vUV; varying vec4 vStyle; varying float vSeed; varying vec2 vSize;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vUV = aUV; vStyle = aStyle; vSeed = aSeed; vSize = aSize;
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
uniform sampler2D facade; uniform sampler2D wallT; uniform sampler2D corr; uniform sampler2D roofT; uniform float time; uniform vec4 blackout[8];
varying vec3 vN; varying vec3 vW; varying vec2 vUV; varying vec4 vStyle; varying float vSeed; varying vec2 vSize;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  int kind = int(vStyle.w + 0.5);
  bool roof = vN.y > 0.5;
  if (kind == 6) { // chain-link fence: see-through mesh
    vec2 q = fract(vec2(vUV.x + vUV.y, vUV.x - vUV.y) * 4.0);
    float wire = max(step(q.x, 0.12), step(q.y, 0.12));
    float rail = step(vSize.y - 0.12, vUV.y) + step(fract(vUV.x / 2.5), 0.03);
    gl_FragColor = vec4(vec3(0.45, 0.47, 0.5), max(wire * 0.45, min(1.0, rail) * 0.9));
    return;
  }
  vec3 tx;
  if (roof) { if (kind == 2) tx = texture2D(corr, vW.xz / 3.0).rgb; else tx = texture2D(roofT, vW.xz / 5.0).rgb; }
  else if (kind == 1) tx = texture2D(facade, vUV / 4.0).rgb;
  else if (kind == 2) tx = texture2D(corr, vUV / 3.0).rgb;
  else tx = texture2D(wallT, vUV / 3.0).rgb;
  float light = roof ? 0.36 : 0.16 + 0.22 * max(dot(vN, normalize(vec3(-0.6, 0.4, -0.6))), 0.0);
  vec3 col = vStyle.rgb * tx * light * 1.5;
  if (!roof) col *= mix(0.45, 1.0, smoothstep(0.0, 6.0, vW.y));
  if (roof) {
    vec2 e = min(vUV, vSize - vUV);
    float ed = min(e.x, e.y);
    col *= mix(0.6, 1.0, smoothstep(0.2, 0.7, ed));
    col += vec3(0.1, 0.11, 0.15) * (1.0 - smoothstep(0.0, 0.15, min(vUV.x, vUV.y)));
  }
  if (kind == 1 && !roof && vW.y > 1.0) {
    vec2 g = vec2(vUV.x / 2.4, vUV.y / 3.4), cell = floor(g), lf = fract(g);
    float inw = step(0.2, lf.x) * step(lf.x, 0.82) * step(0.32, lf.y) * step(lf.y, 0.76);
    if (inw > 0.5) {
      bool dark = false;
      for (int i = 0; i < 8; i++) { vec4 b = blackout[i]; if (b.w > 0.5 && distance(vW.xz, b.xy) < b.z) dark = true; }
      float r = hash(cell + vSeed);
      if (r < 0.16 && !dark) col = hash(cell * 1.7 + vSeed) < 0.7 ? vec3(1.0, 0.78, 0.47) : vec3(0.59, 0.84, 1.0);
      else col = vec3(0.07, 0.09, 0.13) + vec3(0.05, 0.06, 0.08) * step(lf.x, 0.4);
    }
  }
  if (kind == 3) col += vec3(1.0, 0.17, 0.84) * 0.6 * (0.6 + 0.4 * sin(time * 3.0)) * step(fract(vUV.y / 4.0), 0.06);
  if (kind == 4 && roof) col = mix(col, vec3(0.2, 0.15, 0.02), 0.4);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Buildings2D {
  constructor(assets) {
    this.a = assets;
    this.group = new THREE.Group();
  }

  setWorld(world) {
    this.dispose();
    this.world = world;
    const W = world.W, H = world.H, used = new Uint8Array(W * H);
    const kindOf = (k) => world.buildings[world.bid[k]]?.kind;
    const key = (k) => {
      const t = world.tiles[k];
      if (!EXTRUDE.has(t) || kindOf(k) === 'tank') return -1;
      return t * 1e6 + Math.round(world.heights[k] * 2) * 1000 + (world.bid[k] + 1);
    };
    const boxes = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k0 = y * W + x;
      if (used[k0]) continue;
      const kk = key(k0);
      if (kk < 0) continue;
      let w = 1;
      while (x + w < W && !used[k0 + w] && key(k0 + w) === kk) w++;
      let h = 1;
      outer: while (y + h < H) {
        for (let i = 0; i < w; i++) { const k = (y + h) * W + x + i; if (used[k] || key(k) !== kk) break outer; }
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * W + x + i] = 1;
      const t = world.tiles[k0], b = world.buildings[world.bid[k0]];
      boxes.push({ x0: x * M, z0: y * M, x1: (x + w) * M, z1: (y + h) * M, h: zVis(world.heights[k0]), t, kind: b?.kind || 'wall', style: b?.style ?? 0, seed: hash2(x, y, 9) * 100 });
    }
    // geometry, bucketed into 48 m cells so off-screen blocks are culled
    const CELL = 48, cells = new Map(), fenceCells = new Map();
    const bucket = (map, bx) => {
      const k = `${Math.floor(bx.x0 / CELL)},${Math.floor(bx.z0 / CELL)}`;
      if (!map.has(k)) map.set(k, { pos: [], nor: [], uv: [], style: [], seed: [], size: [] });
      return map.get(k);
    };
    for (const bx of boxes) this.addBox(bx.t === T.FENCE ? bucket(fenceCells, bx) : bucket(cells, bx), bx);
    const tex = (key) => texture(this.a.tex[key] || canvas(4, 4), { repeat: true });
    this.uniforms = {
      facade: { value: tex('facade') }, wallT: { value: tex('plaster') }, corr: { value: tex('corrugated') }, roofT: { value: tex('floor') },
      time: { value: 0 }, blackout: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS });
    this.fenceMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const [map, mat] of [[cells, this.mat], [fenceCells, this.fenceMat]]) {
      for (const c of map.values()) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
        g.setAttribute('aUV', new THREE.Float32BufferAttribute(c.uv, 2));
        g.setAttribute('aStyle', new THREE.Float32BufferAttribute(c.style, 4));
        g.setAttribute('aSeed', new THREE.Float32BufferAttribute(c.seed, 1));
        g.setAttribute('aSize', new THREE.Float32BufferAttribute(c.size, 2));
        g.computeBoundingSphere();
        this.group.add(new THREE.Mesh(g, mat));
      }
    }
    this.tanks(world);
    this.roofs(boxes);
    this.signs(world);
  }

  styleOf(bx) {
    const col = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    if (bx.t === T.FENCE) return [0.5, 0.5, 0.5, 6];
    if (bx.t === T.CONTAINER) return [...col(CONT_COLS[(bx.style + (bx.h > 3.6 ? 2 : 0)) % CONT_COLS.length]), 2];
    if (bx.t === T.CORE_SOLID) return [0.12, 0.1, 0.16, 3];
    if (bx.kind === 'warehouse') return [0.75, 0.75, 0.78, 2];
    if (bx.kind === 'perimeter') return [0.7, 0.7, 0.72, 4];
    if (bx.kind === 'tower') return [...col(TOWER_COLS[bx.style % TOWER_COLS.length]), 1];
    return [0.78, 0.76, 0.74, 0];
  }

  // four walls and a roof; aUV is in metres (along the wall, up the wall) or (across the roof)
  addBox(c, bx) {
    const { x0, z0, x1, z1, h } = bx, st = this.styleOf(bx), w = x1 - x0, d = z1 - z0;
    const quad = (p, n, uv, size) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        c.pos.push(...p[i]); c.nor.push(...n); c.uv.push(...uv[i]); c.style.push(...st); c.seed.push(bx.seed); c.size.push(...size);
      }
    };
    quad([[x0, 0, z0], [x0, h, z0], [x1, h, z0], [x1, 0, z0]], [0, 0, -1], [[0, 0], [0, h], [w, h], [w, 0]], [w, h]);
    quad([[x1, 0, z1], [x1, h, z1], [x0, h, z1], [x0, 0, z1]], [0, 0, 1], [[0, 0], [0, h], [w, h], [w, 0]], [w, h]);
    quad([[x0, 0, z1], [x0, h, z1], [x0, h, z0], [x0, 0, z0]], [-1, 0, 0], [[0, 0], [0, h], [d, h], [d, 0]], [d, h]);
    quad([[x1, 0, z0], [x1, h, z0], [x1, h, z1], [x1, 0, z1]], [1, 0, 0], [[0, 0], [0, h], [d, h], [d, 0]], [d, h]);
    if (bx.t !== T.FENCE) quad([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0], [[0, 0], [0, d], [w, d], [w, 0]], [w, d]);
  }

  tanks(world) {
    for (const b of world.buildings) {
      if (b.kind !== 'tank') continue;
      const r = (b.w / 2) * M, h = zVis(b.height);
      const g = new THREE.CylinderGeometry(r, r, h, 28, 1, false);
      const n = g.attributes.position.count, uv = g.attributes.uv.array, nor = g.attributes.normal.array;
      const aUV = new Float32Array(n * 2), style = new Float32Array(n * 4), seed = new Float32Array(n), size = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const top = nor[i * 3 + 1] > 0.5;
        aUV[i * 2] = top ? uv[i * 2] * r * 2 : uv[i * 2] * Math.PI * 2 * r; aUV[i * 2 + 1] = top ? uv[i * 2 + 1] * r * 2 : uv[i * 2 + 1] * h;
        style.set([0.7, 0.72, 0.75, 2], i * 4); size.set([r * 2, r * 2], i * 2);
      }
      g.setAttribute('aUV', new THREE.BufferAttribute(aUV, 2)); g.setAttribute('aStyle', new THREE.BufferAttribute(style, 4));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 2));
      const m = new THREE.Mesh(g, this.mat);
      m.position.set((b.x + b.w / 2) * M, h / 2, (b.y + b.h / 2) * M);
      this.group.add(m);
    }
  }

  // air-conditioning units on tower roofs, blinking red lights on the tallest
  roofs(boxes) {
    const props = this.a.atlas.props, f = props.frames.exterior_aircon_unit, ac = [], blink = [];
    for (const bx of boxes) {
      if (bx.t !== T.TOWER || bx.kind === 'perimeter' || bx.x1 - bx.x0 < 4 || bx.z1 - bx.z0 < 4) continue;
      const n = Math.floor(hash2(bx.x0 * 10, bx.z0 * 10, 7) * 4) + 1;
      for (let i = 0; i < n && f; i++) {
        const u = 0.15 + hash2(bx.x0 * 10, bx.z0 * 10, 10 + i) * 0.7, v = 0.15 + hash2(bx.x0 * 10, bx.z0 * 10, 20 + i) * 0.7;
        ac.push({ x: bx.x0 + (bx.x1 - bx.x0) * u, y: bx.h + 0.05, z: bx.z0 + (bx.z1 - bx.z0) * v, rot: Math.floor(hash2(bx.x0 * 10, bx.z0 * 10, 40 + i) * 4) * Math.PI / 2, w: f.mw * 1.2, h: f.mh * 1.2, rect: frameRect(props, f) });
      }
      if (bx.h > 30 && hash2(bx.x0 * 10, bx.z0 * 10, 50) < 0.7) blink.push({ x: (bx.x0 + bx.x1) / 2, y: bx.h + 0.2, z: (bx.z0 + bx.z1) / 2, w: 1.8, h: 1.8, rect: new THREE.Vector4(0, 0, 1, 1), phase: bx.x0 });
    }
    if (ac.length) { const m = instancedSprites(this.a.propsTex, ac, { color: 0x6a6e78 }); m.material.depthWrite = false; this.group.add(m); }
    if (blink.length) { this.blink = instancedSprites(this.a.glowTex, blink, { additive: true, blink: true, color: 0xff2828 }); this.group.add(this.blink); }
  }

  // neon signs: a plane on the wall plus a soft additive halo
  signs(world) {
    this.signList = [];
    for (const n of world.neon) {
      const c = canvas(n.vertical ? 96 : 384, n.vertical ? 384 : 96), g = c.getContext('2d');
      g.fillStyle = 'rgba(5,6,10,0.85)'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = n.color; g.lineWidth = 3; g.strokeRect(6, 6, c.width - 12, c.height - 12);
      g.font = `bold ${n.vertical ? 48 : 58}px Orbitron, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = n.color; g.shadowBlur = 18; g.fillStyle = n.color;
      if (n.vertical) [...n.text].slice(0, 6).forEach((ch, i, arr) => g.fillText(ch, 48, arr.length > 1 ? 40 + (i * 300) / (arr.length - 1) : 192));
      else g.fillText(n.text, c.width / 2, 50);
      const w = n.vertical ? 1.2 : 4.8, h = n.vertical ? 4.8 : 1.2;
      const mat = new THREE.MeshBasicMaterial({ map: texture(c), transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(n.x * S + n.nx * 0.06, zVis(n.z), n.y * S + n.ny * 0.06);
      mesh.rotation.y = Math.atan2(n.nx, n.ny);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, h * 3), new THREE.MeshBasicMaterial({ map: this.a.glowTex, color: n.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.copy(mesh.position).add(new THREE.Vector3(n.nx * 0.05, 0, n.ny * 0.05));
      halo.rotation.copy(mesh.rotation);
      this.group.add(mesh, halo);
      this.signList.push({ n, mesh, halo, mat });
    }
  }

  update(t, live, snow) {
    if (!this.uniforms) return;
    this.uniforms.time.value = t;
    // blackout circles for the windows, and dark signs inside them
    if (!this._bT || t - this._bT > 0.5) {
      this._bT = t;
      const bo = this.uniforms.blackout.value;
      bo.forEach((v) => v.set(0, 0, 0, 0));
      let i = 0;
      if (live) for (const [id, until] of live.relays) {
        if (until < snow || i >= 8) continue;
        const r = this.world.relays[id];
        bo[i++].set(r.x * S, r.y * S, r.radius * S, 1);
      }
      for (const s of this.signList) s.mesh.visible = s.halo.visible = !live?.blackoutAt(s.n.x, s.n.y, snow);
    }
    for (const s of this.signList) if (s.mesh.visible) s.mat.opacity = Math.sin(t * 7 + s.n.phase) > 0.94 ? 0.3 : 1;
    if (this.blink) this.blink.material.uniforms.time.value = t;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
    this.group.clear();
  }
}
