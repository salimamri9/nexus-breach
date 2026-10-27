// Darkwood-style lighting on the GPU. Each light is a polygon ray-cast against the walls (so it
// casts exact shadows) drawn into a low-resolution light texture with a radial falloff shader,
// added on top of the night's ambient. The view multiplies the ground by it.
import * as THREE from 'three';
import { TILE, PX, isOpaque } from '/shared/world.js';

const S = 1 / PX;
const VS = `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
uniform vec2 center; uniform float radius; uniform vec4 inner; uniform vec4 mid; uniform float hasMid; uniform float gain;
varying vec2 vW;
void main(){
  float t = distance(vW, center) / radius;
  if (t >= 1.0) discard;
  vec4 c = hasMid > 0.5 ? (t < 0.35 ? mix(inner, mid, t / 0.35) : mix(mid, vec4(mid.rgb, 0.0), (t - 0.35) / 0.65)) : mix(inner, vec4(inner.rgb, 0.0), t);
  gl_FragColor = vec4(c.rgb * c.a * gain, 1.0);
}`;
const rgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return new THREE.Vector4(m[0] / 255, m[1] / 255, m[2] / 255, m[3] ?? 1); };
const colorCache = new Map();
const col = (s) => { let v = colorCache.get(s); if (!v) { v = rgba(s); colorCache.set(s, v); } return v; };

function lightMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { center: { value: new THREE.Vector2() }, radius: { value: 1 }, inner: { value: new THREE.Vector4() }, mid: { value: new THREE.Vector4() }, hasMid: { value: 0 }, gain: { value: 1 } },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  });
}

export class Light2D {
  constructor(quality) {
    this.q = quality;
    this.scene = new THREE.Scene();
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.fans = [];      // pooled dynamic polygons
    this.quads = [];     // pooled glow quads
    this.lamps = new Map();
    this.quadGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  }

  setWorld(world) {
    this.w = world;
    for (const m of this.lamps.values()) { m.geometry.dispose(); m.removeFromParent(); }
    this.lamps.clear();
  }

  resize(w, h) {
    const s = this.q.lightRes, cw = Math.max(4, Math.ceil(w * s)), ch = Math.max(4, Math.ceil(h * s));
    if (this.rt.width !== cw || this.rt.height !== ch) this.rt.setSize(cw, ch);
  }

  // ray-cast a fan from (ox, oy) px: walls at least `eye` metres tall stop the rays → points in metres
  fan(ox, oy, eye, radius, a0, a1, rays, out) {
    const w = this.w, W = w.W, H = w.H, tiles = w.tiles, hts = w.heights;
    for (let i = 0; i <= rays; i++) {
      const a = a0 + ((a1 - a0) * i) / rays;
      const dx = Math.cos(a), dy = Math.sin(a);
      let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      let tMaxX = dx ? ((tx + (dx > 0 ? 1 : 0)) * TILE - ox) / dx : Infinity;
      let tMaxY = dy ? ((ty + (dy > 0 ? 1 : 0)) * TILE - oy) / dy : Infinity;
      const tdx = dx ? TILE / Math.abs(dx) : Infinity, tdy = dy ? TILE / Math.abs(dy) : Infinity;
      let t = 0;
      for (;;) {
        if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tdx; tx += sx; } else { t = tMaxY; tMaxY += tdy; ty += sy; }
        if (t >= radius) { t = radius; break; }
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) break;
        const k = ty * W + tx;
        if (isOpaque(tiles[k]) && hts[k] >= eye) break;
      }
      out[i * 2] = (ox + dx * t) * S; out[i * 2 + 1] = (oy + dy * t) * S;
    }
    return out;
  }

  // triangle fan geometry (centre + rim points) written into a position buffer
  writeFan(geo, cx, cz, pts, n) {
    const pos = geo.attributes.position.array;
    let k = 0;
    for (let i = 0; i < n; i++) {
      pos[k++] = cx; pos[k++] = 0; pos[k++] = cz;
      pos[k++] = pts[i * 2]; pos[k++] = 0; pos[k++] = pts[i * 2 + 1];
      pos[k++] = pts[i * 2 + 2]; pos[k++] = 0; pos[k++] = pts[i * 2 + 3];
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, n * 3);
  }

  begin() {
    this.fi = 0; this.qi = 0;
    for (const f of this.fans) f.mesh.visible = false;
    for (const q of this.quads) q.visible = false;
    for (const m of this.lamps.values()) m.visible = false;
  }

  setMat(mat, x, y, r, inner, mid, gain) {
    const u = mat.uniforms;
    u.center.value.set(x * S, y * S); u.radius.value = r * S;
    u.inner.value.copy(col(inner)); u.hasMid.value = mid ? 1 : 0; if (mid) u.mid.value.copy(col(mid));
    u.gain.value = gain;
  }

  // a shadowed fan (sight, flashlights, searchlights, cameras)
  cone(x, y, ang, half, radius, eye, rays, inner, mid, gain = 1) {
    let f = this.fans[this.fi];
    if (!f) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(722 * 9), 3));
      const mesh = new THREE.Mesh(geo, lightMaterial());
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      f = this.fans[this.fi] = { mesh, pts: new Float32Array(1500) };
    }
    this.fi++;
    rays = Math.min(720, rays);
    this.fan(x, y, eye, radius, ang - half, ang + half, rays, f.pts);
    this.writeFan(f.mesh.geometry, x * S, y * S, f.pts, rays);
    this.setMat(f.mesh.material, x, y, radius, inner, mid, gain);
    f.mesh.visible = true;
  }

  // an unshadowed soft glow
  glow(x, y, r, color, gain = 1) {
    let q = this.quads[this.qi];
    if (!q) { q = this.quads[this.qi] = new THREE.Mesh(this.quadGeo, lightMaterial()); q.frustumCulled = false; this.scene.add(q); }
    this.qi++;
    q.position.set(x * S, 0, y * S);
    q.scale.setScalar(r * S);
    this.setMat(q.material, x, y, r, color, null, gain);
    q.visible = true;
  }

  // street lamps: their shadow shapes never change, so cast them once
  lamp(l, r, inner, gain) {
    let m = this.lamps.get(l);
    if (!m) {
      const pts = this.fan(l.x, l.y, 3, r, 0, Math.PI * 2, 140, new Float32Array(290));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(140 * 9), 3));
      this.writeFan(geo, l.x * S, l.y * S, pts, 140);
      m = new THREE.Mesh(geo, lightMaterial());
      m.frustumCulled = false;
      this.scene.add(m);
      this.lamps.set(l, m);
    }
    this.setMat(m.material, l.x, l.y, r, inner, null, gain);
    m.visible = true;
  }

  render(renderer, camera, ambient) {
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(ambient, 1);
    renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
  }
}
