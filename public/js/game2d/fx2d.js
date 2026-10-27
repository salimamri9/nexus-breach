// Effects on the GPU: particle bursts (points), expanding rings, ground splashes, screen-space
// rain. Floating text and pings are tiny HTML labels positioned over the canvas.
import * as THREE from 'three';
import { PX } from '/shared/world.js';
import { QUAD, keepAlpha } from './sprites.js';

const S = 1 / PX;
const MAXP = 800;

export class Fx2D {
  constructor(quality, assets) {
    this.q = quality;
    this.a = assets;
    this.group = new THREE.Group();     // world-space, drawn over the lit scene
    this.ground = new THREE.Group();    // world-space, under the lighting (splashes)
    // particles
    this.parts = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: assets.glowTex }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    // rings
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);
    // splashes around the camera
    const n = Math.round(quality.rain / 8);
    this.splash = new THREE.InstancedMesh(QUAD, keepAlpha(new THREE.MeshBasicMaterial({ map: assets.ringTex, transparent: true, opacity: 0.16, depthWrite: false }), true), n);
    this.splash.frustumCulled = false;
    this.splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashes = Array.from({ length: n }, () => ({ x: 0, z: 0, t: Math.random() }));
    this.ground.add(this.splash);
    // rain: line segments in screen space (own orthographic camera)
    this.rainScene = new THREE.Scene();
    this.rainCam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
    this.drops = Array.from({ length: quality.rain }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), l: 0.5 + Math.random() }));
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quality.rain * 6), 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaabee6, transparent: true, opacity: 0.13, depthTest: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rainScene.add(this.rain);
    // text / ping labels
    this.labels = [];
    this.layer = document.getElementById('fx-layer') || Object.assign(document.createElement('div'), { id: 'fx-layer' });
    if (!this.layer.parentNode) document.body.append(this.layer);
  }

  burst(x, y, color, n = 30, speed = 120, life = 0.8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n && this.parts.length < MAXP; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * S * (0.3 + Math.random() * 0.9);
      this.parts.push({ x: x * S, y: 0.6 + Math.random() * 0.8, z: y * S, vx: Math.cos(a) * v, vz: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.6), max: life, c });
    }
  }

  ring(x, y, r, color, dur = 1) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x * S, 0.15, y * S);
    this.group.add(m);
    this.rings.push({ m, r: r * S, t: 0, dur });
  }

  text(x, y, text, color, dur = 2, size = 18) {
    const e = document.createElement('div');
    e.className = 'fx-text';
    e.textContent = text;
    e.style.color = color; e.style.fontSize = `${size}px`;
    this.layer.append(e);
    this.labels.push({ e, x, y, t: 0, dur, rise: 30 });
  }

  ping(x, y, by, color) {
    const e = document.createElement('div');
    e.className = 'fx-ping';
    e.innerHTML = '<i></i><span></span>';
    e.querySelector('span').textContent = by;
    e.style.setProperty('--c', color);
    this.layer.append(e);
    this.labels.push({ e, x, y, t: 0, dur: 4, rise: 0 });
  }

  update(dt, view, project) {
    // particles
    const pos = this.points.geometry.attributes.position.array, col = this.points.geometry.attributes.color.array;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.92; p.vz *= 0.92;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
    let n = 0;
    for (const p of this.parts) {
      const k = Math.max(0, p.life / p.max);
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      col[n * 3] = p.c.r * k; col[n * 3 + 1] = p.c.g * k; col[n * 3 + 2] = p.c.b * k;
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.m.removeFromParent(); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(r.r * (0.2 + k * 0.8));
      r.m.material.opacity = 1 - k;
    }
    // splashes
    const d = this._d || (this._d = new THREE.Object3D());
    this.splashes.forEach((s, i) => {
      s.t += dt * 2.2;
      if (s.t >= 1) { s.t = 0; s.x = view.x + (Math.random() * 2 - 1) * view.halfW; s.z = view.z + (Math.random() * 2 - 1) * view.halfH; }
      d.position.set(s.x, 0.02, s.z);
      const sc = 0.08 + s.t * 0.45;
      d.scale.set(sc, 1, sc * 0.7);
      d.updateMatrix();
      this.splash.setMatrixAt(i, d.matrix);
    });
    this.splash.instanceMatrix.needsUpdate = true;
    // labels
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      l.t += dt;
      const k = l.t / l.dur;
      if (k >= 1) { l.e.remove(); this.labels.splice(i, 1); continue; }
      const [sx, sy] = project(l.x, l.y);
      l.e.style.transform = `translate(${sx}px, ${sy - k * l.rise}px) translate(-50%, -100%)`;
      l.e.style.opacity = String(1 - k * k);
    }
  }

  // rain falls "into" the screen, drifting with the wind and the camera
  updateRain(dt, W, H, flash, dx, dy) {
    const pos = this.rain.geometry.attributes.position.array;
    let k = 0;
    const dir = this.rainDir ?? 1;      // 1 falls, -1 falls upward (a glitch), 0 hangs in the air
    for (const d of this.drops) {
      d.y += dt * (1.6 + d.z * 1.4) * dir;
      d.x += dt * 0.12 - dx / W;
      d.y -= dy / H;
      if (d.y > 1.05) { d.y -= 1.1; d.x = Math.random(); }
      if (d.x < -0.05) d.x += 1.1; else if (d.x > 1.05) d.x -= 1.1;
      if (d.y < -0.05) d.y += 1.1;
      const x = d.x * W, y = d.y * H, l = (8 + d.z * 18) * d.l * (dir || 0.15) ;
      pos[k++] = x; pos[k++] = y; pos[k++] = 0;
      pos[k++] = x - l * 0.18; pos[k++] = y - l; pos[k++] = 0;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rainMat.opacity = 0.13 + flash * 0.4;
    this.rainCam.left = 0; this.rainCam.right = W; this.rainCam.top = 0; this.rainCam.bottom = H;
    this.rainCam.updateProjectionMatrix();
  }
}
