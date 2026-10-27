// The 2D renderer: a top-down, Darkwood-style view of the city, drawn on the GPU.
// Same interface as the 3D View3D, so main.js, the HUD and the living-city client work unchanged.
// Passes per frame: light map (low-res) → ground + characters → composite (ground × light + wet
// reflections) → buildings and everything above street level → bloom → post (mist, grain,
// drowsiness, danger, finale grade) → rain.
import * as THREE from 'three';
import { TILE, PX, T, M, lineOfSight, hash2 } from '/shared/world.js';
import { Assets2D, canvas } from './assets2d.js';
import { Ground2D } from './ground2d.js';
import { Buildings2D } from './buildings2d.js';
import { Light2D } from './light2d.js';
import { Fx2D } from './fx2d.js';
import { Living2D } from './living2d.js';
import { Bloom } from './bloom2d.js';
import { sprite, frameRect, instancedSprites, texture, keepAlpha } from './sprites.js';

THREE.ColorManagement.enabled = false; // colours and textures are used as authored (sRGB), like a 2D game

const S = 1 / PX;          // px → metres
const CAM_H = 100;         // camera height (m): sets how strongly buildings lean
const GRAFFITI_COLS = ['#ff2bd6', '#22e1ff', '#ffe14d', '#7cff6b', '#ff8a3d'];
const DRONE_COLS = ['rgba(255,214,140,0.85)', 'rgba(255,48,72,0.95)', 'rgba(90,180,255,0)', 'rgba(255,138,42,0.9)'];
const EYE_COLS = [0xffb02e, 0xff2a4a, 0x5ab4ff, 0xff7a1a];
const BEAM_COLS = [0xffd27a, 0xff2a4a, 0x5ab4ff, 0xff8a2a];
const CONTACTS = { walk: [0.3, 0.83], run: [0.4, 0.9] }; // footstep frames, from the baked animation
const FOOTPRINTS = 260;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

// Laptops without a graphics card (Intel UHD/Iris, AMD "Radeon Graphics") default to MEDIUM.
export function integratedGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|llvmpipe|swiftshader|basic render/i.test(name);
  } catch { return false; }
}

export function detectQuality() {
  let saved = null;
  try { saved = localStorage.getItem('nexus_quality'); } catch {}
  const level = saved || (integratedGpu() ? 'medium' : 'high');
  return { ...qualityPreset(level), auto: !saved };
}

export function qualityPreset(level) {
  const presets = {
    low: { level, pixelRatio: 1, minScale: 0.6, lightRes: 0.35, rays: 300, rain: 450, mist: false, grain: false, bloom: false, beams: false },
    medium: { level, pixelRatio: 1, minScale: 0.7, lightRes: 0.5, rays: 480, rain: 800, mist: true, grain: true, bloom: true, beams: true },
    high: { level, pixelRatio: Math.min(devicePixelRatio, 1.5), minScale: 0.7, lightRes: 0.6, rays: 720, rain: 1300, mist: true, grain: true, bloom: true, beams: true },
  };
  return presets[level] || presets.medium;
}

const FULLSCREEN = new THREE.PlaneGeometry(2, 2);
const PASS_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// ground × light, plus wet streets: lights reflected (and rippled) where the ground is wet
const COMPOSITE_FS = `
uniform sampler2D tGround; uniform sampler2D tLight; uniform vec2 texel; uniform float time; varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
void main(){
  vec4 g = texture2D(tGround, vUv); vec3 l = texture2D(tLight, vUv).rgb;
  vec2 n = vec2(lum(texture2D(tGround, vUv + vec2(texel.x * 2.0, 0.0)).rgb) - lum(texture2D(tGround, vUv - vec2(texel.x * 2.0, 0.0)).rgb),
                lum(texture2D(tGround, vUv + vec2(0.0, texel.y * 2.0)).rgb) - lum(texture2D(tGround, vUv - vec2(0.0, texel.y * 2.0)).rgb));
  vec2 ruv = vUv + n * 0.05 + vec2(sin(vUv.y * 140.0 + time * 2.3) * 0.0012, 0.012);
  vec3 refl = texture2D(tLight, ruv).rgb;
  vec3 spec = max(refl - vec3(0.3), 0.0) * g.a * 0.4;
  gl_FragColor = vec4(g.rgb * min(l, vec3(1.0)) + l * 0.07 + spec, 1.0);
}`;
const POST_FS = `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloom; uniform float time; uniform float glitch; uniform float grain; uniform float mist;
uniform vec2 res; uniform vec3 cam; uniform float drowsy; uniform float danger; uniform float hidden; uniform vec3 grade; uniform float fade; uniform float lull;
uniform float dissolve; uniform float white;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec3 scene(vec2 uv){ return texture2D(tScene, uv).rgb + texture2D(tBloom, uv).rgb * bloom; }
void main(){
  vec2 uv = vUv;
  // the simulation coming apart: the image breaks into ever bigger blocks, some of them already gone to light
  float gone = 0.0;
  if (dissolve > 0.0) {
    float bs = 2.0 + dissolve * dissolve * 60.0;
    vec2 cell = floor(uv * res / bs);
    uv = (cell + 0.5) * bs / res;
    gone = step(1.0 - dissolve * 1.1, hash(floor(vUv * res / 56.0)));   // whole tiles of the city wink out
  }
  if (glitch > 0.0) { float band = step(0.96, hash(vec2(floor(uv.y * 40.0), floor(time * 20.0)))); uv.x += band * (hash(vec2(time)) - 0.5) * 0.08 * glitch; }
  // the Hush: the world sways and doubles while you're drowsy
  if (drowsy > 0.0) uv += vec2(sin(time * 1.3 + uv.y * 3.0), cos(time * 1.1 + uv.x * 2.0)) * 0.004 * drowsy;
  float ca = glitch * 0.006 + drowsy * 0.004;
  vec3 c = vec3(scene(uv + vec2(ca, 0.0)).r, scene(uv).g, scene(uv - vec2(ca, 0.0)).b);
  if (drowsy > 0.0) {
    vec2 o = vec2(sin(time * 0.9), cos(time * 0.7)) * 0.012 * drowsy;
    c = mix(c, scene(uv + o) * 0.6 + scene(uv - o) * 0.6, 0.45 * drowsy);
    c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(1.15, 0.85, 1.1), 0.5 * drowsy);
  }
  if (mist > 0.5) {
    vec2 wp = cam.xy + vec2((uv.x - 0.5) * res.x, (0.5 - uv.y) * res.y) / cam.z;
    vec2 p = wp * 0.045 + vec2(time * 0.03, time * 0.012);
    float n = noise(p) * 0.6 + noise(p * 2.3 - time * 0.02) * 0.4;
    float m = smoothstep(0.35, 0.9, n) * 0.07;
    c = 1.0 - (1.0 - c) * (1.0 - vec3(0.59, 0.65, 0.78) * m);
  }
  c *= grade;
  float r = length((vUv - 0.5) * vec2(res.x / res.y, 1.0) * 0.9);
  float v = smoothstep(1.05 - hidden * 0.35 - drowsy * 0.3, 0.35 - hidden * 0.2, r);
  c *= mix(0.28, 1.0, v);
  c += vec3(1.0, 0.1, 0.2) * danger * (0.55 + 0.45 * sin(time * 9.0)) * smoothstep(0.35, 0.95, r) * 0.45;
  c += vec3(1.0, 0.17, 0.84) * lull * 0.04 * (0.5 + 0.5 * sin(time * 2.0));
  if (grain > 0.5) c += (hash(vUv * res + time) - 0.5) * 0.04;
  c += glitch * vec3(1.0, 0.17, 0.84) * 0.06;
  c *= 1.0 - fade;
  c = mix(c, vec3(0.92, 1.0, 0.97), max(white, gone * 0.9));
  gl_FragColor = vec4(c, 1.0);
}`;
// searchlight beams: brightest at the drone, soft at the edges
const BEAM_VS = 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
const BEAM_FS = 'uniform vec3 color; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.5); float a = opacity * e * pow(vUv.y, 1.6); gl_FragColor = vec4(color * a, a); }';

export class View2D {
  constructor(cvs, quality) {
    this.cvs = cvs;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.a = new Assets2D();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, CAM_H + 20);
    this.camera.up.set(0, 0, -1);
    this.groundScene = new THREE.Scene();
    this.topScene = new THREE.Scene();
    this.light = new Light2D(quality);
    this.bloom = quality.bloom ? new Bloom(5) : null;
    this.cam = { x: 0, y: 0, zoom: 2.6, shake: 0, first: true };
    try { this.cam.zoom = +localStorage.getItem('nexus_zoom2d') || 2.6; } catch {}
    this.engine = { scale: 1, struggling: false };
    this.flash = 0;
    this.glitchT = 0;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.nextLightning = performance.now() + 20000;
    this.frameAvg = 16; this.slowT = 0; this.goodT = 0; this.lowT = 0; this.age = 0;
    this.chars = new Map();
    this.drones = new Map();
    this.labelPool = [];
    this.bubbles = new Map();
    this.bottles = [];
    this.fx2 = { drowsy: 0, danger: 0, hidden: 0, lull: 0 };
    this.ambient = new THREE.Color();
    // passes
    const rt = (depth) => new THREE.WebGLRenderTarget(4, 4, { depthBuffer: depth });
    this.groundRT = rt(false);
    this.finalRT = rt(true);
    this.passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeMat = new THREE.ShaderMaterial({ uniforms: { tGround: { value: this.groundRT.texture }, tLight: { value: this.light.rt.texture }, texel: { value: new THREE.Vector2() }, time: { value: 0 } }, vertexShader: PASS_VS, fragmentShader: COMPOSITE_FS, depthTest: false, depthWrite: false });
    this.compositeScene = new THREE.Scene(); this.compositeScene.add(new THREE.Mesh(FULLSCREEN, this.compositeMat));
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.finalRT.texture }, tBloom: { value: this.bloom ? this.bloom.texture : black }, bloom: { value: this.bloom ? 0.4 : 0 },
        time: { value: 0 }, glitch: { value: 0 }, grain: { value: quality.grain ? 1 : 0 }, mist: { value: quality.mist ? 1 : 0 }, res: { value: new THREE.Vector2() }, cam: { value: new THREE.Vector3() },
        drowsy: { value: 0 }, danger: { value: 0 }, hidden: { value: 0 }, grade: { value: new THREE.Vector3(1, 1, 1) }, fade: { value: 0 }, lull: { value: 0 }, dissolve: { value: 0 }, white: { value: 0 },
      },
      vertexShader: PASS_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene(); this.postScene.add(new THREE.Mesh(FULLSCREEN, this.postMat));
    this.beamGeo = new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    this.labelLayer = document.getElementById('label-layer') || Object.assign(document.createElement('div'), { id: 'label-layer' });
    if (!this.labelLayer.parentNode) document.body.append(this.labelLayer);
    cvs.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (quality.level === 'low') return;
      try { localStorage.setItem('nexus_quality', 'low'); } catch {}
      setTimeout(() => location.reload(), 300);
    });
  }

  async load(onProgress) {
    await document.fonts?.load?.('40px "Permanent Marker"').catch(() => {});
    await document.fonts?.load?.('bold 40px Orbitron').catch(() => {});
    await this.a.load(onProgress);
    this.fx = new Fx2D(this.quality, this.a);
    this.ground = new Ground2D(this.a);
    this.buildings = new Buildings2D(this.a);
    this.living = new Living2D(this);
    this.groundScene.add(this.ground.group, this.fx.ground, this.living.ground);
    this.topScene.add(this.buildings.group, this.living.top, this.fx.group);
    // footprints: a pooled instanced decal that fades out
    this.feet = instancedSprites(this.a.footTex, Array.from({ length: FOOTPRINTS }, () => ({ x: 0, z: -999, w: 0.22, h: 0.34, rect: new THREE.Vector4(0, 0, 1, 1), alpha: 0 })));
    this.feet.renderOrder = 3;
    this.feetData = Array.from({ length: FOOTPRINTS }, () => ({ t: -99 }));
    this.feetI = 0;
    this.groundScene.add(this.feet);
  }

  setWorld(world, teamColors, baseColors = teamColors) {
    this.world = world;
    this.teamColors = teamColors;
    this.baseColors = baseColors;
    this.ground.setWorld(world, baseColors);
    this.buildings.setWorld(world);
    this.light.setWorld(world);
    this.living.setWorld(world);
    for (const c of this.chars.values()) c.group.removeFromParent();
    this.chars.clear();
    for (const d of this.drones.values()) { d.top.removeFromParent(); d.shadow.removeFromParent(); d.beam.removeFromParent(); }
    this.drones.clear();
    this.buildStatic(world, teamColors);
    this.cam.first = true;
    this.finale = null;
  }

  // terminals, caches, graffiti, lamp heads, trees, bases, the Core: built once per city
  buildStatic(world, teamColors) {
    const a = this.a;
    // a new city (admin reset / new map): free the old one's per-spot graffiti textures and materials
    for (const g of this.graffitiMeshes || []) g.tex.dispose();
    for (const grp of [this.staticGround, this.staticTop]) grp?.traverse((o) => o.material?.dispose?.());
    this.staticGround?.removeFromParent(); this.staticTop?.removeFromParent();
    const gnd = this.staticGround = new THREE.Group(), top = this.staticTop = new THREE.Group();
    this.groundScene.add(gnd); this.topScene.add(top);
    this.terms = world.terminals.map((p, i) => {
      const m = sprite(a.terminalTex, undefined, 2, 2);
      m.position.set(p.x * S, 0.03, p.y * S); m.rotation.y = -((i * 1.7) % (Math.PI * 2)); m.renderOrder = 4;
      const glow = sprite(a.glowTex, undefined, 1.6, 1.6, { additive: true, color: 0x22e1ff });
      glow.position.set(p.x * S + Math.cos((i * 1.7) % (Math.PI * 2)) * 0.32, 0.5, p.y * S + Math.sin((i * 1.7) % (Math.PI * 2)) * 0.32);
      gnd.add(m); top.add(glow);
      return { m, glow };
    });
    this.cacheSprites = world.caches.map((c) => { const m = sprite(a.caseTex, undefined, 0.45, 0.45); m.position.set(c.x * S, 0.04, c.y * S); m.renderOrder = 4; gnd.add(m); return m; });
    this.graffitiMeshes = world.graffiti.map((gr) => {
      const c = canvas(512, 128);
      const tex = texture(c);
      const m = sprite(tex, undefined, 3.6, 0.9, { alpha: 0.9 });
      m.position.set((gr.x + gr.dx * TILE * 0.18) * S, 0.03, (gr.y + gr.dy * TILE * 0.18) * S);
      m.rotation.y = gr.dx ? -Math.PI / 2 * gr.dx : 0;
      m.renderOrder = 4;
      gnd.add(m);
      const entry = { m, c, tex, hue: gr.hue, text: undefined };
      this.paintGraffiti(entry, null);
      return entry;
    });
    const heads = [], bulbs = [];
    this.lampList = world.lamps;
    for (const l of world.lamps) {
      const hx = (l.x + Math.cos(l.rot) * 1.2 * PX) * S, hz = (l.y + Math.sin(l.rot) * 1.2 * PX) * S;
      heads.push({ x: hx, y: 6, z: hz, rot: l.rot, w: 0.9, h: 0.55, rect: new THREE.Vector4(0, 0, 1, 1) });
      bulbs.push({ x: hx, y: 6.05, z: hz, w: 1.6, h: 1.6, rect: new THREE.Vector4(0, 0, 1, 1), alpha: l.on ? 1 : 0 });
    }
    top.add(instancedSprites(a.lampHeadTex, heads));
    this.bulbs = instancedSprites(a.glowTex, bulbs, { additive: true, color: 0xffd7a0 });
    top.add(this.bulbs);
    const trees = [];
    for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
      if (world.tiles[y * world.W + x] !== T.TREE) continue;
      const v = Math.floor(hash2(x, y, 3) * 3);
      trees.push({ x: (x + 0.5) * M, y: 6, z: (y + 0.5) * M, rot: hash2(x, y, 4) * 6.28, w: 4.2, h: 4.2, rect: new THREE.Vector4(v / 3, 0, (v + 1) / 3, 1) });
    }
    if (trees.length) top.add(instancedSprites(a.treeTex, trees));
    this.baseMarks = world.bases.map((b, i) => {
      const pts = [0, 1, 2, 3].map((k) => new THREE.Vector3(Math.cos((k / 3) * Math.PI * 2) * 2.4, 0, Math.sin((k / 3) * Math.PI * 2) * 2.4));
      const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.baseColors[i], transparent: true, opacity: 0.5 }));
      m.position.set(b.cx * S, 9, b.cy * S);
      top.add(m);
      return m;
    });
    this.coreRings = [[10, 5, 1], [16, 7, -0.7], [22, 9, 0.5]].map(([h, r, sp]) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 64, 1, 0, Math.PI * 1.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(world.core.x * S, h, world.core.y * S);
      m.userData.sp = sp;
      top.add(m);
      return m;
    });
    const cg = sprite(a.glowTex, undefined, 7, 7, { additive: true, color: 0xff2bd6 });
    cg.position.set(world.core.x * S, 24, world.core.y * S);
    top.add(cg);
  }

  paintGraffiti(e, text) {
    e.text = text;
    const g = e.c.getContext('2d'), col = GRAFFITI_COLS[e.hue % GRAFFITI_COLS.length];
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = col; g.globalAlpha = text ? 1 : 0.35;
    g.font = `${text ? 34 : 44}px "Permanent Marker", cursive`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = text ? 10 : 0;
    const s = text || '~ ~ ~';
    let lines = [s];
    if (s.length > 24) { const cut = s.lastIndexOf(' ', 24) > 0 ? s.lastIndexOf(' ', 24) : 24; lines = [s.slice(0, cut), s.slice(cut).trim()]; }
    lines.forEach((l, i) => g.fillText(l, 256, 64 + (i - (lines.length - 1) / 2) * 40, 500));
    e.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- effects api (px coords)
  // team objectives: two-key consoles (amber) and the current beacon of a run (green)
  setObjectives(list) {
    this.objectives ||= new Map();
    const keep = new Set();
    for (const o of list) {
      keep.add(o.key);
      let e = this.objectives.get(o.key);
      if (!e) {
        const col = new THREE.Color(o.color);
        const base = o.kind === 'console' ? sprite(this.a.terminalTex, undefined, 2, 2, { color: col }) : sprite(this.a.ringTex, undefined, 3, 3, { additive: true, color: col });
        const glow = sprite(this.a.glowTex, undefined, 3.2, 3.2, { additive: true, color: col });
        base.renderOrder = 4;
        this.groundScene.add(base); this.topScene.add(glow);
        e = { base, glow };
        this.objectives.set(o.key, e);
      }
      Object.assign(e, o);
      e.base.position.set(o.x * S, 0.04, o.y * S);
      e.glow.position.set(o.x * S, 0.6, o.y * S);
    }
    for (const [k, e] of this.objectives) {
      if (keep.has(k)) continue;
      e.base.removeFromParent(); e.glow.removeFromParent(); e.base.material.dispose(); e.glow.material.dispose();
      this.objectives.delete(k);
    }
  }

  // Core uploads: [{ team, p, state }] — the ring around the Core pulses in the uploader's colour
  setUploads(list) { this.uploads = list || []; }

  burst(x, y, color, n = 30, speed = 120, life = 0.8) { this.fx?.burst(x, y, color, n, speed, life); }
  ring(x, y, r, color, dur = 1) { this.fx?.ring(x, y, r, color, dur); }
  floatText(x, y, text, color, dur = 2, size = 18) { this.fx?.text(x, y, text, color, dur, size); }
  ping(x, y, by, color) { this.fx?.ping(x, y, by, color); }
  shake(n) { this.cam.shake = Math.min(16, this.cam.shake + n); }
  lightning() { this.flash = 1; }
  glitch() { this.glitchT = 0.6; }
  nexusSays() { this.glitchT = 0.5; }
  setGraffiti(id, text) { const e = this.graffitiMeshes?.[id]; if (e && e.text !== text) this.paintGraffiti(e, text); }
  zoomBy(steps) {
    if (!steps) return;
    this.cam.zoom = Math.max(1.5, Math.min(4, this.cam.zoom * (steps > 0 ? 1.12 : 1 / 1.12)));
    try { localStorage.setItem('nexus_zoom2d', String(this.cam.zoom)); } catch {}
  }
  // a cinematic drop from high above the city down to your agent
  swoop(ms = 3800) { this.swoopT = { t0: performance.now(), ms }; }
  // a chat line floats above whoever said it
  say(name, text) { this.bubbles.set(name, { text: text.length > 60 ? text.slice(0, 58) + '…' : text, until: performance.now() + 5000 }); }

  liveEvent(e) {
    this.living?.event(e);
    if (e.type === 'throw') {
      const m = sprite(this.a.bottleTex, undefined, 0.5, 0.5);
      const sh = sprite(this.a.shadowTex, undefined, 0.5, 0.4, { alpha: 0.5 }); sh.renderOrder = 5;
      this.topScene.add(m); this.groundScene.add(sh);
      this.bottles.push({ ...e, t0: performance.now(), m, sh });
    } else if (e.type === 'shatter') {
      this.fx.burst(e.x, e.y, '#bfffd8', 26, 140, 0.7);
      this.fx.ring(e.x, e.y, 22 * PX, 'rgba(255,255,255,0.35)', 1.4);
    } else if (e.type === 'coreHit') {
      this.flash = 1; this.glitchT = 1.2; this.shake(14);
    } else if (e.type === 'act') {
      this.glitchT = 0.9; this.shake(5);
    } else if (e.type === 'glitch') {
      // the simulation slips: each player sees one of these for a moment
      const now = performance.now();
      this.glitchT = Math.max(this.glitchT, e.kind === 'tear' ? 1.6 : 0.5);
      if (e.kind === 'rainUp') this.rainUpUntil = now + 3500;
      else if (e.kind === 'freeze') this.rainFreezeUntil = now + 2500;
      else if (e.kind === 'wire') this.wireUntil = now + 1400;
      else if (e.kind === 'tear') this.shake(4);
      else if (e.kind === 'drone' && this.view) {
        let best = null, bd = Infinity;
        for (const [id, d] of this.drones) {
          if (!d.top.visible) continue;
          const dd = Math.hypot(d.top.position.x / S - this.view.x, d.top.position.z / S - this.view.y);
          if (dd < bd) { bd = dd; best = [id, d]; }
        }
        if (best) {
          best[1].flickerUntil = now + 1600;
          this.fx.burst(best[1].top.position.x / S, best[1].top.position.z / S, '#3dff8a', 40, 90, 1.2);
        }
      }
    }
  }

  // the end: dawn (someone breached the Core) or eternal sleep (nobody did)
  playFinale(kind, onDone) {
    this.finale = { kind, t0: performance.now(), done: onDone, fired: false };
    if (kind === 'sleep') this.sfx?.lullaby?.(9000);
    else this.sfx?.play?.('breach');
  }

  surfaceAt(x, y) {
    const w = this.world, t = w.tiles[Math.floor(y / TILE) * w.W + Math.floor(x / TILE)];
    if (t === T.GRASS) return 'grass';
    if (t === T.RUBBLE) return 'rubble';
    if (t === T.MUD || t === T.TOXIC) return 'mud';
    if (t === T.FLOOR || t === T.YARD) return 'concrete';
    return 'wet';
  }
  groundAt() { return 0; }

  aimPoint() {
    if (!this.view) return null;
    const v = this.view;
    return { x: v.x + (this.mouse.x - innerWidth / 2) / v.zoom, y: v.y + (this.mouse.y - innerHeight / 2) / v.zoom };
  }

  project(x, y, h = 0) {
    const p = this._p || (this._p = new THREE.Vector3());
    p.set(x * S, h, y * S).project(this.camera);
    return [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight];
  }

  // ---------------------------------------------------------------- frame
  frame(st, dt, now, onThunder) {
    const w = this.world, me = st.me;
    if (!w || !me || !this.fx) return;
    const t = now / 1000, q = this.quality, live = this.live, R = this.renderer, snow = live?.now() ?? Date.now();
    this.adapt(dt);

    const W = innerWidth, H = innerHeight, pr = q.pixelRatio * this.engine.scale;
    const bw = Math.max(4, Math.round(W * pr)), bh = Math.max(4, Math.round(H * pr));
    if (this.cvs.width !== Math.round(W * q.pixelRatio) || this.cvs.height !== Math.round(H * q.pixelRatio)) R.setSize(W * q.pixelRatio, H * q.pixelRatio, false);
    if (this.groundRT.width !== bw || this.groundRT.height !== bh) { this.groundRT.setSize(bw, bh); this.finalRT.setSize(bw, bh); }
    this.light.resize(bw, bh);
    this.bloom?.resize(bw, bh);

    // camera: follows the player, leans toward the mouse; swoops in from the sky at the start
    let Z = this.cam.zoom;
    if (this.swoopT) {
      const k = (performance.now() - this.swoopT.t0) / this.swoopT.ms;
      if (k >= 1) this.swoopT = null; else Z *= 0.16 + 0.84 * ease(Math.max(0, k));
    }
    if (this.finale) Z *= 1 - 0.35 * Math.min(1, (performance.now() - this.finale.t0) / 9000);
    const tx = me.x + (this.mouse.x - W / 2) / Z * 0.22, ty = me.y + (this.mouse.y - H / 2) / Z * 0.22;
    if (this.cam.first) { this.cam.x = tx; this.cam.y = ty; this.cam.first = false; }
    const pcx = this.cam.x, pcy = this.cam.y, k = Math.min(1, dt * 6);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.cam.shake = Math.max(0, this.cam.shake - dt * 20);
    const vx = this.cam.x + (Math.random() - 0.5) * this.cam.shake / Z, vy = this.cam.y + (Math.random() - 0.5) * this.cam.shake / Z;
    const halfW = W / Z / 2, halfH = H / Z / 2;
    this.view = { x: vx, y: vy, zoom: Z };
    const cam = this.camera;
    cam.aspect = W / H;
    cam.fov = (2 * Math.atan((halfH * S) / CAM_H) * 180) / Math.PI;
    cam.far = CAM_H + 20;
    cam.position.set(vx * S, CAM_H, vy * S);
    cam.lookAt(vx * S, 0, vy * S);
    cam.updateProjectionMatrix();
    const x0 = vx - halfW, x1 = vx + halfW, y0 = vy - halfH, y1 = vy + halfH;
    const visible = (x, y, m = 40) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    const los = new Map();
    const canSee = (x, y, eye = 1.6) => {
      if (Math.abs(x - me.x) > 45 * PX || Math.abs(y - me.y) > 45 * PX) return false;
      const key = `${Math.round(x)},${Math.round(y)},${eye}`;
      let v = los.get(key);
      if (v === undefined) { v = lineOfSight(w, me.x, me.y, x, y, eye); los.set(key, v); }
      return v;
    };

    // ---- scene objects
    this.ground.update(t);
    this.buildings.update(t, live, snow);
    this.updateStatic(st, t, live, snow);
    const labels = [];
    const bubble = (name, x, y) => { const b = this.bubbles.get(name); if (b && b.until > performance.now()) labels.push({ x, y, text: b.text, bubble: true }); };
    if (live) for (const n of live.npcs.values()) {
      if (!canSee(n.x, n.y)) { this.hideChar(`npc${n.id}`); continue; }
      this.updateChar(`npc${n.id}`, { x: n.x, y: n.y, dir: n.dir || 0, speed: n.state === 1 ? 3 : 0, crouch: n.state === 0, ring: 0xffb02e }, dt, me);
      if (Math.hypot(n.x - me.x, n.y - me.y) < 9 * PX) labels.push({ x: n.x, y: n.y, text: live.names[n.id], color: '#ffb02e' });
    }
    const seenChars = new Set([`p${me.id}`]);
    for (const o of st.others.values()) {
      const meta = st.roster.get(o.id);
      if (!meta) continue;
      const ally = meta.team === me.team, seen = canSee(o.x, o.y);
      if ((!seen && !ally) || (o.hidden && !ally)) continue;
      seenChars.add(`p${o.id}`);
      this.trackSpeed(o, dt);
      this.updateChar(`p${o.id}`, { x: o.x, y: o.y, dir: o.dir, speed: o.vs, crouch: o.crouch, ring: this.teamColors[meta.team], alpha: o.hidden ? 0.25 : seen ? 1 : 0.35, stunned: o.stunned, invuln: o.invuln, steps: seen && Math.hypot(o.x - me.x, o.y - me.y) < 35 * PX, sprint: o.sprint, prints: seen }, dt, me);
      if (ally || Math.hypot(o.x - me.x, o.y - me.y) < 14 * PX) labels.push({ x: o.x, y: o.y, text: meta.name, color: this.teamColors[meta.team] });
      bubble(meta.name, o.x, o.y);
    }
    const asleep = this.finale?.kind === 'sleep' && performance.now() - this.finale.t0 > 2500;
    this.updateChar(`p${me.id}`, { x: me.x, y: me.y, dir: me.dir, speed: asleep ? 0 : me.speed || 0, crouch: me.crouch, ring: this.teamColors[me.team], stunned: me.stunned, invuln: me.invuln, self: true, steps: true, sprint: me.sprinting, prints: true, alpha: me.hidden >= 0 ? 0.25 : 1, sleep: asleep }, dt, me);
    bubble(me.name, me.x, me.y);
    for (const [id, c] of this.chars) if (id.startsWith('p') && !seenChars.has(id)) c.group.visible = false;
    if (live) for (const [id, c] of this.chars) if (id.startsWith('npc') && !live.npcs.has(+id.slice(3))) c.group.visible = false;
    this.updateDrones(st, t, dt, visible, canSee, live, snow);
    this.updateBottles();
    this.updateFootprints(t);
    this.living.update(st, live, dt, t, now, visible);
    this.fx.update(dt, { x: vx * S, z: vy * S, halfW: halfW * S, halfH: halfH * S }, (x, y) => this.project(x, y, 1.5));
    this.drawLabels(labels);

    // ---- mood: drowsiness, danger, hiding, the Hush, the Core hit, the finale
    const f2 = this.fx2, ka = Math.min(1, dt * 2);
    const drowsy = live?.drowsy(me) ? 1 : 0;
    let danger = (st.alertUntil || 0) > now ? 1 : 0;
    for (const s of st.sentinels.values()) if (s.state === 1 && Math.hypot(s.x - me.x, s.y - me.y) < 25 * PX) danger = Math.max(danger, 0.6);
    f2.drowsy += (drowsy - f2.drowsy) * ka; f2.danger += (danger - f2.danger) * Math.min(1, dt * 4);
    f2.hidden += ((me.hidden >= 0 ? 1 : 0) - f2.hidden) * Math.min(1, dt * 5);
    f2.lull += ((live?.lullaby && live.lullaby.until > snow ? 1 : 0) - f2.lull) * ka;
    const amb = this.ambient.setRGB(13 / 255, 15 / 255, 25 / 255);
    if (f2.lull > 0.01) amb.lerp(new THREE.Color(0.12, 0.03, 0.12), f2.lull * (0.5 + 0.3 * Math.sin(t * 2)));
    const coreHit = live && live.coreHitUntil > snow;
    if (coreHit && Math.random() < 0.15) amb.setRGB(0.25, 0.3, 0.28);
    const grade = this.postMat.uniforms.grade.value.set(1, 1, 1);
    let fade = 0, dissolve = 0, white = 0;
    if (this.finale) {
      const fk = Math.min(1, (performance.now() - this.finale.t0) / 9000);
      if (this.finale.kind === 'dawn') {
        // the exit code runs: light floods in, the glitches pile up, then Halcyon dissolves into white
        amb.lerp(new THREE.Color(0.85, 0.9, 1.0), ease(fk));
        grade.set(1 + fk * 0.1, 1 + fk * 0.12, 1 + fk * 0.15);
        if (fk > 0.2 && Math.random() < dt * 4) this.glitchT = Math.max(this.glitchT, 0.4);
        dissolve = Math.max(0, (fk - 0.35) / 0.55);
        white = Math.max(0, (fk - 0.7) / 0.3);
      } else {
        amb.lerp(new THREE.Color(0.2, 0.0, 0.18), fk);
        f2.drowsy = Math.max(f2.drowsy, fk);
        fade = Math.min(1, Math.max(0, (fk - 0.4) / 0.6));
      }
      if (fk >= 1 && !this.finale.fired) { this.finale.fired = true; this.finale.done?.(); }
    }

    // ---- light map
    this.lighting(st, t, visible, canSee, live, snow);
    this.light.render(R, cam, amb);
    // ---- ground + characters
    R.setRenderTarget(this.groundRT);
    R.setClearColor(0x05060a, 1); R.clear(true, true, false);
    R.render(this.groundScene, cam);
    // ---- composite, then buildings and everything above street level
    this.compositeMat.uniforms.texel.value.set(1 / bw, 1 / bh);
    this.compositeMat.uniforms.time.value = t;
    R.setRenderTarget(this.finalRT);
    R.clear(true, true, false);
    R.render(this.compositeScene, this.passCam);
    R.render(this.topScene, cam);
    this.bloom?.render(R, this.finalRT.texture, bw, bh);
    // ---- post + rain
    if (now > this.nextLightning) { this.nextLightning = now + 25000 + Math.random() * 40000; this.flash = 1; onThunder?.(); }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.glitchT = Math.max(0, this.glitchT - dt);
    const pu = this.postMat.uniforms;
    pu.time.value = t; pu.glitch.value = this.glitchT; pu.res.value.set(W, H); pu.cam.value.set(vx * S, -vy * S, Z * PX);
    pu.drowsy.value = f2.drowsy; pu.danger.value = f2.danger; pu.hidden.value = f2.hidden; pu.lull.value = f2.lull; pu.fade.value = fade; pu.dissolve.value = dissolve; pu.white.value = white;
    R.setRenderTarget(null);
    R.clear(true, true, false);
    R.render(this.postScene, this.passCam);
    if (!this.finale || this.finale.kind !== 'dawn') {
      { const pn = performance.now(); this.fx.rainDir = pn < this.rainFreezeUntil ? 0 : pn < this.rainUpUntil ? -1 : 1;
        const wire = pn < this.wireUntil && Math.random() < 0.7; if (this.buildings.mat.wireframe !== wire) { this.buildings.mat.wireframe = wire; this.buildings.fenceMat.wireframe = wire; } }
      this.fx.updateRain(dt, W * q.pixelRatio, H * q.pixelRatio, this.flash, (this.cam.x - pcx) * Z * q.pixelRatio, (this.cam.y - pcy) * Z * q.pixelRatio);
      R.render(this.fx.rainScene, this.fx.rainCam);
    }
    this.audio(st, me);
  }

  updateStatic(st, t, live, snow) {
    this.terms.forEach((o, i) => {
      const ours = st.team.hacked.includes(i);
      o.glow.material.uniforms.color.value.set(ours ? 0x3dff8a : 0x22e1ff);
      o.glow.material.uniforms.alpha.value = 0.75 + Math.sin(t * 4 + i) * 0.2;
    });
    this.cacheSprites.forEach((m, i) => { m.visible = !!st.caches[i]; if (m.visible) m.rotation.y = -(t * 0.8 + i); });
    for (const e of this.objectives?.values() || []) {
      const k = Math.sin(t * 5) * 0.5 + 0.5;
      e.glow.material.uniforms.alpha.value = 0.45 + k * 0.45;
      if (e.kind === 'beacon') { const sc = 2.6 + k * 1.4; e.base.scale.set(sc, 1, sc); e.base.rotation.y = t; }
    }
    // a live upload: the ring of the Core zone pulses outward in the uploader's colour
    for (const u of this.uploads || []) {
      if (u.state === 'empty' || (this._upT?.[u.team] || 0) > t) continue;
      (this._upT ||= {})[u.team] = t + (u.state === 'running' ? 0.9 : 1.6);
      this.fx.ring(this.world.core.x, this.world.core.y, 14 * PX, this.teamColors[u.team] || '#ffffff', 1.4);
    }
    if (!this._bulbT || t - this._bulbT > 0.05) {
      this._bulbT = t;
      const al = this.bulbs.geometry.attributes.aAlpha, dawn = this.finale?.kind === 'dawn';
      const hit = live && live.coreHitUntil > snow && Math.random() < 0.5;
      this.lampList.forEach((l, i) => { al.array[i] = !l.on || dawn || hit || live?.blackoutAt(l.x, l.y, snow) ? 0 : l.flicker && Math.sin(t * 13 + l.tx) > 0.55 ? 0.2 : 1; });
      al.needsUpdate = true;
    }
    this.baseMarks.forEach((m) => { m.rotation.y = t * 0.8; });
    const breached = !!st.team.breachRank;
    this.coreRings.forEach((m, i) => { m.rotation.y = t * m.userData.sp; m.material.color.set(breached ? 0x3dff8a : 0xff2bd6); m.material.opacity = 0.6 + Math.sin(t * 2 + i) * 0.2; });
  }

  trackSpeed(o, dt) {
    const sp = o.lastX !== undefined ? Math.hypot(o.x - o.lastX, o.y - o.lastY) / PX / Math.max(dt, 1e-3) : 0;
    o.lastX = o.x; o.lastY = o.y;
    o.vs = (o.vs || 0) + (sp - (o.vs || 0)) * Math.min(1, dt * 8);
  }

  hideChar(id) { const c = this.chars.get(id); if (c) c.group.visible = false; }

  // a character: soft shadow, a ring in its team colour, the animated sprite; footsteps and prints
  updateChar(id, o, dt, me) {
    const a = this.a, at = a.atlas.chars;
    let c = this.chars.get(id);
    if (!c) {
      const group = new THREE.Group();
      const shadow = sprite(a.shadowTex, undefined, 1.7, 1.4, { alpha: 0.8 }); shadow.position.set(0.12, 0.01, 0.16); shadow.renderOrder = 5;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 32).rotateX(-Math.PI / 2), keepAlpha(new THREE.MeshBasicMaterial({ color: o.ring, transparent: true, opacity: 0.65, depthWrite: false })));
      ring.position.y = 0.015; ring.renderOrder = 6;
      const body = sprite(a.charsTex, new THREE.Vector4(), 2.8, 2.8); body.position.y = 0.02; body.renderOrder = 7;
      group.add(shadow, ring, body);
      this.groundScene.add(group);
      c = { group, ring, body, shadow, ph: Math.random(), foot: 0 };
      this.chars.set(id, c);
    }
    c.group.visible = true;
    c.group.position.set(o.x * S, 0, o.y * S);
    c.ring.material.color.set(o.ring);
    const alpha = o.alpha ?? 1;
    c.ring.material.opacity = 0.65 * alpha;
    const sp = o.speed || 0;
    const kind = sp < 0.3 ? 'idle' : sp < 3.2 ? 'walk' : 'run';
    const rate = kind === 'idle' ? 0.35 : kind === 'walk' ? Math.max(0.6, sp / 1.9) / 1.033 : Math.max(0.8, sp / 5.2) / 0.7;
    const prev = c.ph;
    c.ph = (c.ph + dt * rate) % 1;
    if (kind !== 'idle') {
      for (const p of CONTACTS[kind]) {
        if (!((prev < p && c.ph >= p) || (prev > c.ph && (p > prev || c.ph >= p)))) continue;
        const surf = this.surfaceAt(o.x, o.y);
        if (o.steps && this.sfx?.ctx) this.sfx.footstep(surf, o.self ? (o.sprint ? 0.6 : o.crouch ? 0.12 : 0.35) : (o.sprint ? 0.9 : o.crouch ? 0.12 : 0.45), o.self ? null : { x: o.x / PX, y: 0.2, z: o.y / PX });
        if (o.prints && surf !== 'concrete') this.footprint(o.x, o.y, o.dir, c.foot ^= 1, surf);
        break;
      }
    }
    const at2 = o.sleep ? 'sleeper_back' : null;
    const f = at2 ? at.frames[at2] : at.frames[at.anims[kind][Math.floor(c.ph * at.anims[kind].length) % at.anims[kind].length]];
    c.body.material.uniforms.rect.value.copy(frameRect(at, f));
    const blink = (o.stunned && Math.random() < 0.4) || (o.invuln && Math.sin(performance.now() / 60) > 0.6);
    c.body.visible = !blink;
    c.body.material.uniforms.alpha.value = alpha;
    c.shadow.material.uniforms.alpha.value = 0.8 * alpha;
    const sc = o.sleep ? 2.4 * 1.2 : o.crouch ? 2.4 : 2.8;
    c.body.scale.set(sc, 1, sc);
    c.body.rotation.y = -o.dir;
  }

  footprint(x, y, dir, side, surf) {
    const i = this.feetI = (this.feetI + 1) % FOOTPRINTS;
    const off = side ? 0.13 : -0.13;
    const px = x * S + Math.cos(dir + Math.PI / 2) * off, pz = y * S + Math.sin(dir + Math.PI / 2) * off;
    const d = this._fd || (this._fd = new THREE.Object3D());
    d.position.set(px, 0.012, pz); d.rotation.set(0, -dir - Math.PI / 2, 0); d.scale.set(0.2, 1, 0.3); d.updateMatrix();
    this.feet.setMatrixAt(i, d.matrix);
    this.feet.instanceMatrix.needsUpdate = true;
    this.feetData[i] = { t: performance.now() / 1000, a: surf === 'mud' ? 0.55 : surf === 'grass' ? 0.25 : 0.3 };
  }

  updateFootprints(t) {
    if (!this.feet) return;
    const al = this.feet.geometry.attributes.aAlpha, now = performance.now() / 1000;
    for (let i = 0; i < FOOTPRINTS; i++) { const d = this.feetData[i]; al.array[i] = d.a ? d.a * Math.max(0, 1 - (now - d.t) / 25) : 0; }
    al.needsUpdate = true;
  }

  updateBottles() {
    const now = performance.now();
    for (let i = this.bottles.length - 1; i >= 0; i--) {
      const b = this.bottles[i], k = (now - b.t0) / b.ms;
      if (k >= 1) { b.m.removeFromParent(); b.sh.removeFromParent(); this.bottles.splice(i, 1); continue; }
      const x = b.fx + (b.tx - b.fx) * k, y = b.fy + (b.ty - b.fy) * k;
      b.m.position.set(x * S, 1.2 + 4 * 3.2 * k * (1 - k), y * S);
      b.m.rotation.y = k * 14;
      b.sh.position.set(x * S, 0.01, y * S);
    }
  }

  // drones: a shadow on the ground, hull + spinning rotors + eye above street level, a searchlight beam
  updateDrones(st, t, dt, visible, canSee, live, snow) {
    const a = this.a, seen = new Set();
    for (const s of st.sentinels.values()) {
      seen.add(s.id);
      let d = this.drones.get(s.id);
      if (!d) {
        const top = new THREE.Group();
        const body = sprite(a.droneTex, undefined, 1.9, 1.9);
        const rotors = [0, 1, 2, 3].map((i) => {
          const r = sprite(a.rotorTex, undefined, 0.72, 0.72, { alpha: 0.9 });
          const an = Math.PI / 4 + (i * Math.PI) / 2;
          r.position.set(Math.cos(an) * 0.65, 0.02, Math.sin(an) * 0.65);
          return r;
        });
        const eye = sprite(a.glowTex, undefined, 0.6, 0.6, { additive: true });
        eye.position.set(0.25, 0.04, 0);
        top.add(body, ...rotors, eye);
        const shadow = sprite(a.shadowTex, undefined, 2.1, 1.7, { alpha: 0.45 }); shadow.renderOrder = 5;
        const beam = new THREE.Mesh(this.beamGeo, new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0.16 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        beam.frustumCulled = false;
        this.topScene.add(top, beam); this.groundScene.add(shadow);
        d = { top, rotors, eye, shadow, beam, h: 5.5 };
        this.drones.set(s.id, d);
      }
      const near = visible(s.x, s.y, 60);
      const hj = s.state === 4 ? live?.hijacks.get(s.id) : null;
      // the Core hit (or the dawn) brings them down
      const down = (s.state === 2 && live && live.coreHitUntil > snow) || this.finale?.kind === 'dawn';
      d.h += ((down ? 0.6 : 5.5) - d.h) * Math.min(1, dt * (down ? 2.5 : 1.5));
      if (down && near && Math.random() < dt * 2) this.fx.burst(s.x, s.y, '#ffd27a', 6, 60, 0.5);
      d.shadow.visible = near;
      d.shadow.position.set(s.x * S, 0.01, s.y * S);
      d.top.visible = near && canSee(s.x, s.y, 4.5);
      const lit = near && s.state !== 2 && !down;
      d.beam.visible = lit && this.quality.beams;
      const col = hj ? new THREE.Color(this.teamColors[hj.team] || '#3dff8a') : null;
      if (d.beam.visible) {
        const gx = s.x * S + Math.cos(s.look) * 8, gz = s.y * S + Math.sin(s.look) * 8;
        d.beam.position.set(s.x * S, d.h - 0.2, s.y * S);
        d.beam.lookAt(gx, 0, gz);
        const len = Math.hypot(8, d.h);
        d.beam.scale.set(3.2, 3.2, len);
        d.beam.material.uniforms.color.value.set(col || BEAM_COLS[s.state] || BEAM_COLS[0]);
        d.beam.material.uniforms.opacity.value = s.state === 1 ? 0.3 : 0.16;
      }
      if (d.flickerUntil > performance.now()) { d.top.visible = d.top.visible && Math.random() < 0.3; d.beam.visible = false; }
      if (!d.top.visible) continue;
      d.top.position.set(s.x * S, d.h, s.y * S);
      d.top.rotation.y = -s.look;
      d.rotors.forEach((r, i) => { r.rotation.y = down ? i : t * 40 + i; });
      d.eye.material.uniforms.color.value.set(col || (down ? 0x222222 : EYE_COLS[s.state] || EYE_COLS[0]));
    }
    for (const [id, d] of this.drones) if (!seen.has(id)) d.top.visible = d.shadow.visible = d.beam.visible = false;
  }

  // the light map for this frame (all positions in px)
  lighting(st, t, visible, canSee, live, snow) {
    const L = this.light, w = this.world, me = st.me, q = this.quality;
    const dawn = this.finale?.kind === 'dawn', hit = live && live.coreHitUntil > snow;
    L.begin();
    L.cone(me.x, me.y, 0, Math.PI, 30 * PX, 1.6, q.rays, me.crouch ? 'rgba(40,44,60,1)' : 'rgba(50,54,72,1)', 'rgba(26,29,42,1)');
    L.setMat(L.fans[L.fi - 1].mesh.material, me.x, me.y, 14 * PX, me.crouch ? 'rgba(40,44,60,1)' : 'rgba(50,54,72,1)', 'rgba(26,29,42,1)', 1);
    if (!dawn) for (const l of w.lamps) {
      if (!l.on || !visible(l.x, l.y, 10 * PX) || live?.blackoutAt(l.x, l.y)) continue;
      L.lamp(l, 9.5 * PX, 'rgba(255,186,110,0.9)', hit ? (Math.random() < 0.5 ? 0 : 1) : l.flicker ? (Math.sin(t * 13 + l.tx) > 0.55 ? 0.2 : 1) : 1);
    }
    for (const n of w.neon) {
      if (!visible(n.x, n.y, 8 * PX) || live?.blackoutAt(n.x, n.y)) continue;
      L.glow(n.x + n.nx * 3 * PX, n.y + n.ny * 3 * PX, 6 * PX, hexA(live?.lullaby ? '#ff2bd6' : n.color, 0.6), Math.sin(t * 7 + n.phase) > 0.94 ? 0.1 : 0.45);
    }
    w.terminals.forEach((p, i) => { if (visible(p.x, p.y, 80)) L.glow(p.x, p.y, 4 * PX, st.team.hacked.includes(i) ? 'rgba(61,255,138,0.8)' : 'rgba(34,225,255,0.8)', 0.75 + Math.sin(t * 4 + i) * 0.15); });
    w.caches.forEach((c, i) => { if (st.caches[i] && visible(c.x, c.y)) L.glow(c.x, c.y, 1.6 * PX, 'rgba(255,225,77,0.9)', 0.8); });
    const up = (this.uploads || []).find((u) => u.state === 'running') || (this.uploads || [])[0];
    if (visible(w.core.x, w.core.y, 30 * PX)) L.glow(w.core.x, w.core.y, 26 * PX, up ? hexA(this.teamColors[up.team], 0.8) : 'rgba(255,43,214,0.75)', 0.55 + Math.sin(t * (up ? 6 : 2)) * 0.15);
    for (const o of this.objectives?.values() || []) if (visible(o.x, o.y, 20)) L.glow(o.x, o.y, 5 * PX, o.kind === 'beacon' ? 'rgba(61,255,138,0.9)' : 'rgba(255,176,46,0.85)', 0.6 + Math.sin(t * 5) * 0.2);
    w.bases.forEach((b, i) => { if (visible(b.cx, b.cy, 16 * PX)) L.glow(b.cx, b.cy, 15 * PX, hexA(this.teamColors[i], 0.55), 0.6); });
    this.toxic ||= (() => { const out = []; for (let y = 0; y < w.H; y += 2) for (let x = 0; x < w.W; x += 2) if (w.tiles[y * w.W + x] === T.TOXIC) out.push({ x: (x + 1) * TILE, y: (y + 1) * TILE }); return out; })();
    for (const p of this.toxic) if (visible(p.x, p.y)) L.glow(p.x, p.y, 2.2 * PX, 'rgba(60,255,110,0.6)', 0.35 + Math.sin(t * 1.3 + p.x) * 0.08);
    if (me.lit && !me.stunned && !(me.hidden >= 0)) {
      const bat = me.battery === undefined ? 1 : Math.max(0.2, Math.min(1, me.battery * 3));
      L.cone(me.x, me.y, me.dir, 0.62, 17 * PX, 1.6, Math.round(q.rays / 4), 'rgba(150,140,120,0.7)', 'rgba(110,100,85,0.35)', bat);
      L.cone(me.x, me.y, me.dir, 0.36, 22 * PX, 1.6, Math.round(q.rays / 5), 'rgba(255,238,205,0.85)', 'rgba(255,226,186,0.42)', bat);
    }
    for (const o of st.others.values()) {
      if (!o.light || o.stunned || o.hidden || !canSee(o.x, o.y)) continue;
      L.cone(o.x, o.y, o.dir, 0.42, 18 * PX, 1.6, 48, 'rgba(255,238,205,0.75)', 'rgba(255,226,186,0.35)');
    }
    if (!dawn) for (const s of st.sentinels.values()) {
      if (s.state === 2 || !visible(s.x, s.y, 24 * PX)) continue;
      const hj = s.state === 4 ? live?.hijacks.get(s.id) : null;
      const col = hj ? hexA(this.teamColors[hj.team] || '#3dff8a', 0.8) : DRONE_COLS[s.state] || DRONE_COLS[0];
      L.cone(s.x, s.y, s.look, 0.55, 22 * PX, 4, 56, col, null);
      L.glow(s.x, s.y, 2.5 * PX, col, 0.6);
    }
    for (const b of this.bottles) L.glow(b.tx, b.ty, 1.5 * PX, 'rgba(180,255,200,0.4)', 0.3);
    if (live) this.living.lights(L, st, live, t, visible);
    if (this.flash > 0.05) L.glow(me.x, me.y, 120 * PX, 'rgba(150,160,200,1)', this.flash * 0.7);
  }

  drawLabels(labels) {
    while (this.labelPool.length < labels.length) {
      const e = document.createElement('div');
      this.labelLayer.append(e);
      this.labelPool.push(e);
    }
    this.labelPool.forEach((e, i) => {
      const l = labels[i];
      if (!l) { if (e.style.display !== 'none') e.style.display = 'none'; return; }
      const [x, y] = this.project(l.x, l.y, 0);
      e.style.display = '';
      const cls = l.bubble ? 'bubble2d' : 'lbl2d';
      if (e.className !== cls) e.className = cls;
      if (e.textContent !== l.text) e.textContent = l.text;
      if (!l.bubble) e.style.borderColor = l.color;
      e.style.transform = `translate(${x}px, ${y - (l.bubble ? 58 : 34)}px) translate(-50%, -100%)`;
    });
  }

  audio(st, me) {
    const sfx = this.sfx;
    if (!sfx?.ctx || sfx.muted) return;
    sfx.setListener2D(me.x / PX, me.y / PX);
    const w = this.world;
    if (!this.coreLoop && sfx.buf.core_loop) this.coreLoop = sfx.loop('core_loop', { x: w.core.x / PX, y: 6, z: w.core.y / PX }, 0.9);
    this.droneLoops ||= [];
    const near = [...st.sentinels.values()].filter((s) => s.state !== 2).map((s) => ({ s, d: Math.hypot(s.x - me.x, s.y - me.y) / PX }))
      .filter((n) => n.d < 70).sort((a, b) => a.d - b.d).slice(0, 4);
    for (let i = 0; i < 4; i++) {
      if (!this.droneLoops[i] && sfx.buf.drone_loop) this.droneLoops[i] = sfx.loop('drone_loop', { x: 0, y: 0, z: 0 }, 0);
      const l = this.droneLoops[i], n = near[i];
      if (!l) continue;
      if (!n || this.finale) { l.set(me.x / PX, 7, me.y / PX, 0, 1); continue; }
      l.set(n.s.x / PX, 5, n.s.y / PX, n.s.state === 1 ? 0.9 : 0.45, n.s.state === 1 ? 1.35 : 0.9 + i * 0.05);
    }
  }

  // dynamic resolution: drop the render scale when frames run long, restore it when they don't
  adapt(dt) {
    this.age += dt;
    if (this.age < 5 || dt > 0.25) return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    this.slowT = this.frameAvg > 26 ? this.slowT + dt : 0;
    this.goodT = this.frameAvg < 18.5 ? this.goodT + dt : 0;
    const e = this.engine, min = this.quality.minScale;
    if (this.slowT > 2 && e.scale > min) { e.scale = Math.max(min, +(e.scale - 0.1).toFixed(2)); this.slowT = 0; this.frameAvg = 20; }
    else if (this.goodT > 4 && e.scale < 1) { e.scale = Math.min(1, +(e.scale + 0.1).toFixed(2)); this.goodT = 0; }
    this.lowT = this.frameAvg > 34 && e.scale <= min + 0.01 ? this.lowT + dt : 0;
    if (this.lowT > 12) e.struggling = true;
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
