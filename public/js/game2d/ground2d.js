// The city floor, drawn on the GPU in one pass: a tile map texture tells the shader what each
// 1.5 m tile is; it picks a ground texture, adds wall shadows, curbs, puddles, manholes, toxic
// sludge and base stripes. Static props (cars, barriers, lamps, sleepers…) are instanced sprites.
import * as THREE from 'three';
import { TILE, PX, T, M, isSolid, isOpaque, hash2 } from '/shared/world.js';
import { instancedSprites, frameRect, texture } from './sprites.js';
import { canvas } from './assets2d.js';

const LAYERS = ['road', 'sidewalk', 'floor', 'rubble', 'grass', 'base', 'mud'];
const S = 1 / PX; // px → metres

const VS = `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
precision highp float; precision highp sampler2DArray;
uniform sampler2D tiles; uniform sampler2DArray tex; uniform vec2 mapSize; uniform vec3 teamCols[6]; uniform float time;
varying vec2 vP;
const vec3 NIGHT = vec3(0.016, 0.024, 0.047);
void main(){
  vec2 tp = vP / 1.5;
  ivec2 ti = ivec2(floor(tp));
  if (ti.x < 0 || ti.y < 0 || float(ti.x) >= mapSize.x || float(ti.y) >= mapSize.y) { gl_FragColor = vec4(NIGHT, 1.0); return; }
  vec2 f = fract(tp);
  vec4 d = texelFetch(tiles, ti, 0) * 255.0;
  int t = int(d.r + 0.5); int gb = int(d.g + 0.5); float h = d.b / 255.0; int fl = int(d.a + 0.5);
  // texture layer, metres per repeat, darkening
  float layer = 2.0, sc = 4.0, dark = 0.3;
  if (t == 0) { layer = 0.0; sc = 6.0; dark = 0.35; }
  else if (t == 1) { layer = 1.0; sc = 3.0; dark = 0.25; }
  else if (t == 3) { layer = 3.0; sc = 3.0; dark = 0.3; }
  else if (t == 4 || t == 12) { layer = 4.0; sc = 6.0; dark = 0.35; }
  else if (t == 5) { layer = 5.0; sc = 3.0; dark = 0.2; }
  else if (t == 6) { layer = 2.0; sc = 4.0; dark = 0.4; }
  else if (t == 7) { layer = 6.0; sc = 4.0; dark = 0.4; }
  else if (t == 8) { layer = 2.0; sc = 5.0; dark = 0.35; }
  else if (t == 16) { layer = 6.0; sc = 4.0; dark = 0.7; }
  else if (t == 13 || t == 14) { layer = 0.0; sc = 6.0; dark = 0.35; }
  else if (t == 18) { layer = 3.0; sc = 3.0; dark = 0.35; }
  else if (t >= 10) { layer = 2.0; sc = 4.0; dark = 0.6; }
  vec3 col = texture(tex, vec3(vP / sc, layer)).rgb;
  col = mix(col, NIGHT, dark + h * 0.12);
  if (t == 16) { // toxic sludge
    col = mix(col, vec3(0.08, 0.27, 0.1), 0.85);
    col += vec3(0.1, 0.5, 0.18) * (0.15 + 0.1 * sin(time * 1.3 + vP.x * 0.7 + vP.y * 0.4)) * smoothstep(0.6, 0.0, length(f - 0.5));
  }
  if (t == 0) {
    vec2 q = f - 0.5;
    if (h < 0.04) { // puddle
      float e = length(q / vec2(0.25 + h * 6.0, 0.17 + h * 3.0));
      if (e < 1.0) { col *= 0.45; col += vec3(0.25, 0.32, 0.45) * 0.18 * smoothstep(0.8, 1.0, e) * step(0.0, -q.x - q.y); }
    } else if (h < 0.06) { // manhole
      float r = length(q);
      if (r < 0.28) { col = vec3(0.06, 0.065, 0.075) + vec3(0.06) * step(0.6, fract(q.y * 18.0)) * step(r, 0.22); }
    } else if (h > 0.16 && h < 0.2) { // oil stain
      col *= 1.0 - 0.35 * smoothstep(1.0, 0.6, length(q / vec2(0.32, 0.2)));
    } else if (h >= 0.06 && h < 0.16) { // crack
      float cx = 0.5 + sin(f.y * 9.0 + h * 50.0) * 0.18;
      col *= 1.0 - 0.45 * smoothstep(0.035, 0.0, abs(f.x - cx));
    }
  }
  if (t == 5 && gb >= 8) { // base edge: team-coloured hazard stripes
    int bi = (gb & 7) - 1;
    vec3 tc = teamCols[0];
    for (int i = 0; i < 6; i++) if (i == bi) tc = teamCols[i];
    float s = step(0.5, fract((vP.x + vP.y) * 0.9));
    col = mix(col, tc * 0.6, s * 0.55);
  }
  if (t == 6) col += vec3(0.4, 0.05, 0.35) * 0.18 * (step(fract(vP.x / 3.0), 0.02) + step(fract(vP.y / 3.0), 0.02));
  if (t < 10) {
    // wall shadows (ambient occlusion) on the sides that touch walls
    float ao = 0.0;
    if ((fl & 1) != 0) ao = max(ao, 1.0 - smoothstep(0.0, 0.38, f.y));
    if ((fl & 2) != 0) ao = max(ao, 1.0 - smoothstep(0.0, 0.38, 1.0 - f.x));
    if ((fl & 4) != 0) ao = max(ao, 1.0 - smoothstep(0.0, 0.38, 1.0 - f.y));
    if ((fl & 8) != 0) ao = max(ao, 1.0 - smoothstep(0.0, 0.38, f.x));
    col *= 1.0 - ao * 0.55;
    // curbs where a sidewalk meets the road
    if (t == 1) {
      float c = 0.0;
      if ((fl & 16) != 0) c = max(c, step(f.y, 0.06));
      if ((fl & 32) != 0) c = max(c, step(1.0 - f.x, 0.06));
      if ((fl & 64) != 0) c = max(c, step(1.0 - f.y, 0.06));
      if ((fl & 128) != 0) c = max(c, step(f.x, 0.06));
      col = mix(col, vec3(0.67, 0.69, 0.72), c * 0.5);
    }
  }
  // alpha carries "wetness" for the reflections in the composite pass
  float wet = t == 0 ? 0.85 : t == 1 ? 0.5 : t == 5 ? 0.6 : t == 6 ? 0.7 : t == 16 ? 0.8 : t == 7 ? 0.3 : t == 13 || t == 14 ? 0.85 : 0.12;
  if (t == 0 && h < 0.04 && length((f - 0.5) / vec2(0.25 + h * 6.0, 0.17 + h * 3.0)) < 1.0) wet = 1.0;
  gl_FragColor = vec4(col, wet);
}`;

export class Ground2D {
  constructor(assets) {
    this.a = assets;
    this.group = new THREE.Group();
  }

  setWorld(world, teamColors) {
    this.dispose();
    const W = world.W, H = world.H;
    const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.TOWER : world.tiles[y * W + x]);
    // tile map: r = type, g = base index (+8 on the base edge), b = variation, a = neighbour flags
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4, t = tile(x, y);
      data[k] = t;
      if (t === T.BASE) {
        const bi = world.bases.findIndex((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
        const b = world.bases[bi];
        data[k + 1] = (bi + 1) | (b && (x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1) ? 8 : 0);
      }
      data[k + 2] = Math.floor(hash2(x, y, 11) * 255);
      let fl = 0;
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], i) => {
        const n = tile(x + dx, y + dy);
        if (isOpaque(n) || n === T.FENCE) fl |= 1 << i;
        if (n === T.ROAD) fl |= 16 << i;
      });
      data[k + 3] = fl;
    }
    const tiles = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tiles.needsUpdate = true;
    // ground textures packed into one array texture (512² each)
    const N = 512, arr = new Uint8Array(N * N * 4 * LAYERS.length);
    const c = canvas(N, N), g = c.getContext('2d', { willReadFrequently: true });
    LAYERS.forEach((key, i) => {
      const im = this.a.tex[key];
      g.fillStyle = '#444'; g.fillRect(0, 0, N, N);
      if (im) g.drawImage(im, 0, 0, N, N);
      arr.set(g.getImageData(0, 0, N, N).data, i * N * N * 4);
    });
    const tex = new THREE.DataArrayTexture(arr, N, N, LAYERS.length);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tiles: { value: tiles }, tex: { value: tex }, mapSize: { value: new THREE.Vector2(W, H) }, time: { value: 0 },
        teamCols: { value: Array.from({ length: 6 }, (_, i) => new THREE.Color(teamColors[i] || '#888')) } },
      vertexShader: VS, fragmentShader: FS,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W * M, H * M).rotateX(-Math.PI / 2), this.mat);
    plane.position.set((W * M) / 2, 0, (H * M) / 2);
    plane.frustumCulled = false;
    this.group.add(plane);
    this.textures = [tiles, tex];
    this.buildProps(world);
  }

  // every static sprite in the city, with soft shadows, as a few instanced draws
  buildProps(world) {
    const a = this.a, props = a.atlas.props, chars = a.atlas.chars;
    const pItems = [], cItems = [], shadows = [], rocks = [];
    const add = (atlas, list, name, x, y, rot, s = 1, alpha = 1) => {
      const f = atlas.frames[name];
      if (!f) return;
      list.push({ x: x * S, z: y * S, rot, w: f.mw * s, h: f.mh * s, rect: frameRect(atlas, f), alpha });
      shadows.push({ x: x * S + 0.12, z: y * S + 0.18, rot, w: f.mw * s * 1.05, h: f.mh * s * 1.05, rect: new THREE.Vector4(0, 0, 1, 1), alpha: 0.65 });
    };
    for (const p of world.props) if (!p.type.startsWith('dead_tree')) add(props, pItems, p.type, p.x, p.y, p.rot, p.s);
    for (const l of world.lamps) add(props, pItems, l.model === 1 ? 'street_lamp_01' : 'street_lamp_02', l.x, l.y, l.rot, 1, 1);
    for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
      const t = world.tiles[y * world.W + x], cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
      if (t === T.BARRIER) {
        const horiz = world.tiles[y * world.W + x + 1] === T.BARRIER || world.tiles[y * world.W + x - 1] === T.BARRIER;
        const name = hash2(x, y, 3) < 0.5 ? 'concrete_road_barrier' : 'concrete_road_barrier_02', f = props.frames[name];
        if (f) add(props, pItems, name, cx, cy, horiz ? 0 : Math.PI / 2, M / Math.max(f.mw, f.mh) * 1.02);
      } else if (t === T.ROCK) rocks.push({ x: cx * S, z: cy * S, rot: hash2(x, y, 5) * 6.28, w: 1.5 * (0.9 + hash2(x, y, 6) * 0.4), h: 1.5 * (0.9 + hash2(x, y, 6) * 0.4), rect: new THREE.Vector4(0, 0, 1, 1) });
      else if ((t === T.SIDEWALK || t === T.ROAD || t === T.FLOOR) && hash2(x, y, 91) < 0.0035 && !world.bases.some((b) => x >= b.x - 4 && x < b.x + b.w + 4 && y >= b.y - 4 && y < b.y + b.h + 4)) {
        const v = hash2(x, y, 92);
        add(chars, cItems, v < 0.45 ? 'sleeper_back' : v < 0.8 ? 'sleeper_side' : 'sleeper_curl', cx, cy, hash2(x, y, 93) * 6.28, 1, 0.92);
      }
    }
    const shadowMesh = instancedSprites(a.shadowTex, shadows);
    const rockMesh = instancedSprites(a.rockTex, rocks);
    const propMesh = instancedSprites(a.propsTex, pItems);
    const charMesh = instancedSprites(a.charsTex, cItems);
    shadowMesh.renderOrder = 1; rockMesh.renderOrder = 2; propMesh.renderOrder = 3; charMesh.renderOrder = 3;
    this.group.add(shadowMesh, rockMesh, propMesh, charMesh);
  }

  update(t) { if (this.mat) this.mat.uniforms.time.value = t; }

  dispose() {
    this.group.traverse((o) => { if (o.geometry && o.geometry !== undefined) o.geometry.dispose?.(); });
    this.group.clear();
    for (const t of this.textures || []) t.dispose();
  }
}
