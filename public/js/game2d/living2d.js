// 2D side of the living city on the GPU: echoes, survivors' surroundings, relays, cameras,
// alarm cars, supply drops, purges, plus ambient life (crows that scatter, rats, steam vents).
import * as THREE from 'three';
import { TILE, PX, T, hash2 } from '/shared/world.js';
import { QUAD, sprite, frameRect, instancedSprites, texture } from './sprites.js';
import { canvas } from './assets2d.js';

const S = 1 / PX;
const DIRS = { '0,-1': -Math.PI / 2, '1,0': 0, '0,1': Math.PI / 2, '-1,0': Math.PI };

export class Living2D {
  constructor(view) {
    this.v = view;
    this.a = view.a;
    this.ground = new THREE.Group();   // lit by the light map
    this.top = new THREE.Group();      // emissive / above street level
    this.beams = [];
    this.camAlert = new Map();
  }

  setWorld(world) {
    this.ground.clear(); this.top.clear();
    this.w = world;
    const a = this.a, props = a.atlas.props;
    // relays: cabinets against walls
    this.relays = world.relays.map((r) => {
      const m = sprite(a.relayTex, undefined, 0.9, 1.3);
      m.position.set((r.x + r.dx * (TILE / 2 - 8)) * S, 0.02, (r.y + r.dy * (TILE / 2 - 8)) * S);
      m.rotation.y = -((DIRS[`${r.dx},${r.dy}`] ?? 0) + Math.PI / 2);
      this.ground.add(m);
      return m;
    });
    // cameras on walls (they turn)
    const cf = props.frames.security_camera_01;
    this.cams = world.cameras.map((c) => {
      const m = sprite(a.propsTex, cf ? frameRect(props, cf) : undefined, (cf?.mw || 0.6) * 1.1, (cf?.mh || 0.4) * 1.1);
      m.position.set((c.x + c.dx * (TILE / 2 - 4)) * S, 0.03, (c.y + c.dy * (TILE / 2 - 4)) * S);
      this.ground.add(m);
      return m;
    });
    // steam vents: fixed grates on roads (same rule as the 3D version)
    this.vents = [];
    for (let y = 1; y < world.H - 1; y++) for (let x = 1; x < world.W - 1; x++) {
      if (world.tiles[y * world.W + x] === T.ROAD && hash2(x, y, 77) < 0.0035) this.vents.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
    }
    this.ground.add(instancedSprites(a.ventTex, this.vents.map((v) => ({ x: v.x * S, z: v.y * S, w: 0.9, h: 0.65, rect: new THREE.Vector4(0, 0, 1, 1) }))));
    // rats
    const rf = props.frames.street_rat;
    this.rats = Array.from({ length: 5 }, () => {
      const m = sprite(a.propsTex, rf ? frameRect(props, rf) : undefined, (rf?.mw || 0.4) * 1.4, (rf?.mh || 0.2) * 1.4);
      m.visible = false;
      this.ground.add(m);
      return { m, state: 'gone', t: Math.random() * 8 };
    });
    // the supply crate (on the ground once landed) and its falling twin with a parachute
    this.crate = sprite(a.crateTex, undefined, 1.3, 1.3); this.crate.visible = false; this.ground.add(this.crate);
    this.fallCrate = sprite(a.crateTex, undefined, 1.3, 1.3); this.fallCrate.visible = false; this.top.add(this.fallCrate);
    this.chute = sprite(a.chuteTex, undefined, 3.2, 3.2, { alpha: 0.85 }); this.chute.visible = false; this.top.add(this.chute);
    // echoes: halo + turning hexagon + bright core
    const hex = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 7 }, (_, k) => new THREE.Vector3(Math.cos((k / 6) * Math.PI * 2) * 0.45, 0, Math.sin((k / 6) * Math.PI * 2) * 0.45)));
    const hexMat = new THREE.LineBasicMaterial({ color: 0xa0dcff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
    this.echoes = world.echoes.map((e) => {
      const g = new THREE.Group();
      g.position.set(e.x * S, 1.2, e.y * S);
      const halo = sprite(a.glowTex, undefined, 3.6, 3.6, { additive: true, color: 0x78c8ff, alpha: 0.9 });
      const core = sprite(a.glowTex, undefined, 0.6, 0.6, { additive: true, color: 0xe6f6ff });
      const ring = new THREE.Line(hex, hexMat);
      g.add(halo, ring, core);
      this.top.add(g);
      return { g, ring };
    });
    // car alarm flashers, abduction beams (pooled glows)
    this.flashers = Array.from({ length: 12 }, () => { const m = sprite(a.glowTex, undefined, 1.7, 1.7, { additive: true, color: 0xffa028 }); m.visible = false; m.position.y = 1; this.top.add(m); return m; });
    // purge wall
    this.purge = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.purge.visible = false; this.top.add(this.purge);
    // steam
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
    this.steamPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.8, map: a.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.steamPts.frustumCulled = false;
    this.top.add(this.steamPts);
    this.steam = Array.from({ length: 90 }, (_, i) => ({ v: i % 6, t: Math.random(), x: 0, y: 0, dx: 0, dy: 0 }));
    this.activeVents = [];
    // crows: a black V, flapping by squashing its width
    const bc = canvas(32, 32), bg = bc.getContext('2d');
    bg.fillStyle = '#050507'; bg.beginPath(); bg.moveTo(28, 16); bg.lineTo(6, 3); bg.lineTo(11, 16); bg.lineTo(6, 29); bg.closePath(); bg.fill();
    const birdTex = texture(bc);
    this.flocks = Array.from({ length: 6 }, () => ({ state: 'gone', t: Math.random() * 4, x: 0, y: 0, birds: Array.from({ length: 8 }, () => {
      const m = sprite(birdTex, undefined, 0.5, 0.5); m.visible = false; this.top.add(m);
      return { m, x: 0, y: 0, h: 0, dir: 0, flap: 0, vx: 0, vy: 0, hop: 0 };
    }) }));
  }

  event(e) {
    const fx = this.v.fx;
    if (e.type === 'relay') {
      const r = this.w.relays[e.id];
      fx.burst(r.x, r.y, '#ffd27a', 50, 160, 1.1);
      fx.burst(r.x, r.y, '#8fd3ff', 20, 90, 0.6);
    } else if (e.type === 'camAlert') this.camAlert.set(e.id, performance.now() + 1200);
    else if (e.type === 'dropLand') { fx.burst(e.x, e.y, '#c8b48a', 40, 140, 1); fx.ring(e.x, e.y, 6 * PX, '#ffb02e', 1); }
    else if (e.type === 'dropTaken') fx.burst(e.x, e.y, '#ffb02e', 40, 120, 1);
    else if (e.type === 'npcTaken') {
      fx.burst(e.x, e.y, '#9fd8ff', 40, 90, 1.2);
      const m = sprite(this.a.glowTex, undefined, 9, 9, { additive: true, color: 0xbfe6ff });
      m.position.set(e.x * S, 2, e.y * S);
      this.top.add(m);
      this.beams.push({ m, t: 0 });
    }
  }

  update(st, live, dt, t, now, visible) {
    if (!live) return;
    const w = this.w, snow = live.now();
    w.relays.forEach((r, i) => { this.relays[i].visible = visible(r.x, r.y, 80); });
    w.cameras.forEach((c, i) => {
      const m = this.cams[i];
      m.visible = visible(c.x, c.y, 80);
      if (!m.visible) return;
      m.rotation.y = -live.camAngle(i, snow);
      m.material.uniforms.alpha.value = live.camOn(i, snow) ? 1 : 0.55;
    });
    // echoes
    w.echoes.forEach((e, i) => {
      const o = this.echoes[i];
      o.g.visible = !live.taken.has(i) && visible(e.x, e.y, 60);
      if (!o.g.visible) return;
      o.g.position.y = 1.2 + Math.sin(t * 1.6 + i) * 0.12;
      o.ring.rotation.y = t * 1.2 + i;
    });
    // alarm flashers
    let fi = 0;
    const blink = Math.sin(t * 12) > 0;
    for (const [id, until] of live.cars) {
      if (until < snow) continue;
      const c = w.alarmCars[id];
      for (const side of [-1, 1]) {
        const m = this.flashers[fi++];
        if (!m) break;
        m.position.set((c.x + Math.cos(c.rot) * 2.1 * PX * side) * S, 1, (c.y + Math.sin(c.rot) * 2.1 * PX * side) * S);
        m.visible = blink;
      }
    }
    for (; fi < this.flashers.length; fi++) this.flashers[fi].visible = false;
    // supply drop
    const d = live.drop;
    this.crate.visible = !!d && snow >= d.landAt;
    this.fallCrate.visible = this.chute.visible = !!d && snow < d.landAt;
    if (d) {
      this.crate.position.set(d.x * S, 0.05, d.y * S);
      if (snow < d.landAt) {
        const h = 32 * Math.max(0, (d.landAt - snow) / 20000);
        this.fallCrate.position.set(d.x * S, h, d.y * S);
        this.chute.position.set(d.x * S, h + 0.2, d.y * S);
        this.chute.rotation.y = t * 0.5;
      }
    }
    // purge
    const pg = live.purge;
    this.purge.visible = !!(pg && pg.until > snow);
    if (this.purge.visible) { this.purge.position.set(pg.x * S, 0.2, pg.y * S); this.purge.scale.setScalar(pg.r * S); this.purge.material.opacity = 0.6 + Math.sin(t * 5) * 0.3; }
    // abduction beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      b.m.material.uniforms.alpha.value = Math.max(0, 1 - b.t / 1.6);
      if (b.t > 1.6) { b.m.removeFromParent(); this.beams.splice(i, 1); }
    }
    this.ambient(st, dt, now);
  }

  // ---- light contributions
  lights(L, st, live, t, visible) {
    const w = this.w, snow = live.now();
    w.echoes.forEach((e, i) => { if (!live.taken.has(i) && visible(e.x, e.y, 120)) L.glow(e.x, e.y, 4.5 * PX, 'rgba(110,190,255,0.85)', 0.8 + Math.sin(t * 3 + i) * 0.15); });
    w.relays.forEach((r, i) => {
      if (!visible(r.x, r.y, 60)) return;
      const off = live.relayOff(i);
      L.glow(r.x, r.y, 1.2 * PX, off ? 'rgba(255,40,60,0.9)' : 'rgba(60,255,140,0.9)', off ? (Math.sin(t * 8) > 0 ? 1 : 0.2) : 0.8);
    });
    w.cameras.forEach((c, i) => {
      if (!visible(c.x, c.y, c.range) || !live.camOn(i, snow)) return;
      const alert = (this.camAlert.get(i) || 0) > performance.now();
      L.cone(c.x, c.y, live.camAngle(i, snow), 0.42, c.range, 3, 26, alert ? 'rgba(255,40,60,0.75)' : 'rgba(255,220,220,0.28)', null);
    });
    for (const [id, until] of live.cars) {
      if (until < snow) continue;
      const c = w.alarmCars[id];
      if (Math.sin(t * 12) > 0) L.glow(c.x, c.y, 7 * PX, 'rgba(255,150,40,0.9)', 0.9);
    }
    const d = live.drop;
    if (d && snow >= d.landAt) L.glow(d.x, d.y, 11 * PX, 'rgba(255,60,40,0.95)', 0.7 + Math.random() * 0.3);
    const pg = live.purge;
    if (pg && pg.until > snow) L.glow(pg.x, pg.y, pg.r * 1.1, 'rgba(255,30,50,0.5)', 0.35 + Math.sin(t * 5) * 0.1);
  }

  ambient(st, dt, now) {
    const w = this.w, me = st.me, v = this.v;
    const threat = (x, y) => {
      const d = Math.hypot(x - me.x, y - me.y) / PX;
      if (d < 7 || (me.sprinting && d < 16)) return true;
      for (const s of st.sentinels.values()) if (Math.hypot(s.x - x, s.y - y) / PX < 8) return true;
      return false;
    };
    const openAt = (x, y) => { const k = Math.floor(y / TILE) * w.W + Math.floor(x / TILE); const tt = w.tiles[k]; return tt !== undefined && tt < 10 && tt !== T.BASE && tt !== T.TOXIC; };
    // crows
    for (const f of this.flocks) {
      if (f.state === 'gone') {
        for (const b of f.birds) b.m.visible = false;
        f.t -= dt;
        if (f.t > 0) continue;
        for (let tries = 0; tries < 10; tries++) {
          const a = Math.random() * Math.PI * 2, r = (14 + Math.random() * 22) * PX;
          const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
          if (!openAt(x, y)) continue;
          f.state = 'ground'; f.x = x; f.y = y;
          for (const b of f.birds) Object.assign(b, { x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * 60, h: 0.15, dir: Math.random() * 6.28, flap: 0, hop: Math.random() * 3 });
          break;
        }
        continue;
      }
      if (f.state === 'ground') {
        for (const b of f.birds) { b.hop -= dt; if (b.hop < 0) { b.hop = 1 + Math.random() * 3; b.dir += (Math.random() - 0.5) * 2; b.x += Math.cos(b.dir) * 4; b.y += Math.sin(b.dir) * 4; } }
        if (threat(f.x, f.y) || Math.hypot(f.x - me.x, f.y - me.y) > 60 * PX) {
          f.state = 'fly'; f.t = 5;
          const away = Math.atan2(f.y - me.y, f.x - me.x);
          for (const b of f.birds) { const a = away + (Math.random() - 0.5) * 1.2, sp = (6 + Math.random() * 3) * PX; b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.dir = a; }
          if (Math.hypot(f.x - me.x, f.y - me.y) < 40 * PX) v.sfx?.play('flap', { x: f.x, y: f.y });
        }
      } else {
        f.t -= dt;
        for (const b of f.birds) { b.x += b.vx * dt; b.y += b.vy * dt; b.h += dt * 6; b.flap += dt * 22; }
        if (f.t <= 0) { f.state = 'gone'; f.t = 4 + Math.random() * 10; }
      }
      for (const b of f.birds) {
        b.m.visible = true;
        b.m.position.set(b.x * S, b.h, b.y * S);
        b.m.rotation.y = -b.dir;
        b.m.scale.z = 0.5 * (f.state === 'fly' ? 0.35 + Math.abs(Math.sin(b.flap)) * 0.65 : 0.6);
      }
    }
    // rats dart along now and then
    for (const r of this.rats) {
      if (r.state === 'gone') {
        r.m.visible = false;
        r.t -= dt;
        if (r.t > 0) continue;
        const a = Math.random() * Math.PI * 2, d = (5 + Math.random() * 10) * PX;
        const x = me.x + Math.cos(a) * d, y = me.y + Math.sin(a) * d;
        if (!openAt(x, y)) { r.t = 1; continue; }
        Object.assign(r, { state: 'run', x, y, dir: Math.atan2(y - me.y, x - me.x) + (Math.random() - 0.5), life: 2.5 });
      } else {
        r.life -= dt;
        const nx = r.x + Math.cos(r.dir) * 7 * PX * dt, ny = r.y + Math.sin(r.dir) * 7 * PX * dt;
        if (openAt(nx, ny)) { r.x = nx; r.y = ny; } else r.dir += Math.PI / 2;
        if (r.life <= 0) { r.state = 'gone'; r.t = 6 + Math.random() * 14; }
        r.m.visible = true;
        r.m.position.set(r.x * S, 0.04, r.y * S);
        r.m.rotation.y = -r.dir;
      }
    }
    // steam from the nearest vents
    if (!this._ventT || now - this._ventT > 1000) {
      this._ventT = now;
      this.activeVents = this.vents.map((vv) => ({ vv, d: Math.abs(vv.x - me.x) + Math.abs(vv.y - me.y) })).filter((o) => o.d < 60 * PX)
        .sort((p, q) => p.d - q.d).slice(0, 6).map((o) => o.vv);
    }
    const pos = this.steamPts.geometry.attributes.position.array, col = this.steamPts.geometry.attributes.color.array;
    this.steam.forEach((p, i) => {
      p.t += dt / 3.2;
      const vv = this.activeVents[p.v];
      if (p.t >= 1) { p.t = 0; if (vv) { p.x = vv.x + (Math.random() - 0.5) * 10; p.y = vv.y + (Math.random() - 0.5) * 10; p.dx = 0.3 + Math.random() * 0.4; p.dy = (Math.random() - 0.5) * 0.3; } }
      const k = vv ? 0.09 * Math.sin(p.t * Math.PI) : 0;
      pos[i * 3] = (p.x + p.dx * p.t * 60) * S; pos[i * 3 + 1] = 0.3 + p.t * 3; pos[i * 3 + 2] = (p.y + p.dy * p.t * 60) * S;
      col[i * 3] = 0.78 * k; col[i * 3 + 1] = 0.82 * k; col[i * 3 + 2] = 0.9 * k;
    });
    this.steamPts.geometry.attributes.position.needsUpdate = true;
    this.steamPts.geometry.attributes.color.needsUpdate = true;
  }
}
