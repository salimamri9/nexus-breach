// The living city: story echoes, survivors, power relays, security cameras, car alarms,
// supply drops, purge sweeps, and the voices of NEXUS and Juno. Owned by Game.
import { TILE, PX, T, INTERACT_R, CLASSES, lineOfSight, sectorName, baseIndexAt, cameraAngle, tileAt } from '../shared/world.js';

const ECHO_SCORE = 5;   // echoes are story: worth a little, never as much as solving terminals
const DROP_SCORE = 75;
const NPC_SPEED = 3.4 * PX;
const BLACKOUT_MS = 75000, RELAY_CD_MS = 240000;
const CAM_OFF_MS = 60000, CAM_EMP_MS = 30000, CAM_COOLDOWN_MS = 8000;
const ALARM_MS = 12000, ALARM_CD_MS = 90000, ALARM_R = 2.6 * PX, ALARM_NOISE = 40 * PX;
const DROP_WARN_MS = 20000, DROP_LIFE_MS = 100000;
const PURGE_MS = 45000;
const THROW_RANGE = 18 * PX, THROW_NOISE = 22 * PX, THROW_SPEED = 16 * PX, THROW_CD = 1200, THROW_MAX = 5;
const HIJACK_MS = 25000, HIJACK_CD = 60000, HIJACK_R = 2.6 * PX, ESCORT_R = 12 * PX;
const LULLABY_WARN = 12000, LULLABY_MS = 18000;
const CORE_HIT_MS = 12000;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
// array lookup by an untrusted index
const at = (arr, i) => (Number.isInteger(i) && i >= 0 && i < arr.length ? arr[i] : undefined);
// delayed work must never throw out of a timer
const later = (fn, ms) => setTimeout(() => { try { fn(); } catch (err) { console.error('[living timer]', err); } }, ms);
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export class Living {
  constructor(game, story) {
    this.game = game;
    this.story = story || {};
  }

  get io() { return this.game.io; }

  reset() {
    const w = this.game.world, st = this.story;
    const names = st.survivors?.names || ['Survivor'];
    this.echoes = w.echoes.map((e, i) => ({ ...e, id: i, story: (st.echoes || [])[i % Math.max(1, (st.echoes || []).length)] || null }));
    this.npcs = w.hideouts.map((h, i) => ({
      id: i, name: names[i % names.length], x: h.x, y: h.y, home: i, state: 0, // 0 hiding · 1 moving · 2 taken
      path: null, pathI: 0, nextMove: Date.now() + 90000 + Math.random() * 240000, told: new Set(), backAt: 0,
    }));
    this.relays = w.relays.map((r, i) => ({ ...r, id: i, offUntil: 0, cdUntil: 0 }));
    this.cams = w.cameras.map((c, i) => ({ ...c, id: i, offUntil: 0, lastAlert: 0 }));
    this.cars = w.alarmCars.map((c, i) => ({ ...c, id: i, until: 0, cdUntil: 0, lastNoise: 0 }));
    this.drop = null;
    this.purge = null;
    this.junoDone = new Set();
    this.nextDropAt = 0;
    this.nextPurgeAt = 0;
    this.nextTauntAt = 0;
    this.flags = {};
    this.lullaby = null;
    this.nextLullabyAt = 0;
    this.coreHitUntil = 0;
    this.act = 1;
    this.nextGlitchAt = 0;
    for (const t of this.game.teams) t.echoes = new Set();
  }

  // state every client needs on (re)join
  payload(team) {
    const now = Date.now();
    return {
      echoes: [...(team?.echoes || [])],
      relays: this.relays.filter((r) => r.offUntil > now).map((r) => [r.id, r.offUntil]),
      cams: this.cams.filter((c) => c.offUntil > now).map((c) => [c.id, c.offUntil]),
      cars: this.cars.filter((c) => c.until > now).map((c) => [c.id, c.until]),
      drop: this.dropInfo(),
      purge: this.purge && this.purge.until > now ? this.purge : null,
      npcNames: this.npcs.map((n) => n.name),
      lullaby: this.lullaby,
      hijacks: this.game.sentinels.filter((s) => s.state === 4).map((s) => [s.id, s.hijackUntil, s.ownerTeam]),
      echoTotal: this.echoes.length,
    };
  }

  dropInfo() {
    const d = this.drop;
    return d ? { x: d.x, y: d.y, landAt: d.landAt, until: d.until, sector: d.sector } : null;
  }

  world(ev) { this.io.emit('world', ev); }

  // ---------------------------------------------------------------- voices
  // the act decides NEXUS's mood: "taunt3" is used in act III when it exists, else "taunt"
  nexus(kind, vars = {}, target = null) {
    const N = this.story.nexus || {};
    const lines = N[kind + (this.act || 1)] || N[kind];
    if (!lines?.length) return;
    const msg = { text: fill(pick(lines), vars), kind };
    if (target === null) this.io.emit('nexus', msg);
    else if (typeof target === 'number') this.io.to(`team:${target}`).emit('nexus', msg);
    else target.emit('nexus', msg);
  }

  juno(text, vars = {}, team = null) {
    if (!text) return;
    const msg = { from: this.story.setting?.handler || 'JUNO', text: fill(text, vars) };
    if (team === null) this.io.emit('radio', msg);
    else this.io.to(`team:${team}`).emit('radio', msg);
  }

  // ---------------------------------------------------------------- the night's three acts
  // An act moves on with time or with progress, whichever comes first, so a fast cell
  // drives the story forward and a slow night still reaches its climax.
  actNow(now) {
    const g = this.game;
    const frac = (now - (this.playStart || now)) / Math.max(1, g.endsAt - (this.playStart || now));
    const best = Math.max(0, ...g.teams.map((t) => t.hacked.size)) / Math.max(1, g.terminals.length);
    const breached = g.teams.some((t) => t.breachRank);
    return frac >= 0.75 || best >= 0.85 || breached ? 3 : frac >= 0.4 || best >= 0.5 ? 2 : 1;
  }

  tickAct(now) { this.setAct(this.actNow(now)); }

  setAct(act) {
    if (act <= (this.act || 1)) return;
    this.act = act;
    this.flags.act = act;
    const info = this.story.acts?.[act - 1];
    if (info) this.world({ type: 'act', act, title: info.title, name: info.name });
    this.nexus('act');
  }

  // ---------------------------------------------------------------- queries used by Game
  // drones and cameras see less inside a blacked-out district
  blackoutAt(x, y, now) {
    for (const r of this.relays) if (r.offUntil > now && d2(r, { x, y }) < r.radius ** 2) return true;
    return false;
  }

  emp(x, y, r, now) {
    for (const c of this.cams) {
      if (d2(c, { x, y }) < r * r) { c.offUntil = Math.max(c.offUntil, now + CAM_EMP_MS); this.world({ type: 'cam', id: c.id, offUntil: c.offUntil }); }
    }
  }

  onPhase(phase) {
    const now = Date.now();
    if (phase === 'playing') {
      this.playStart = now;
      this.act = 1; this.flags.act = 1;
      this.nextLullabyAt = now + 360000;
      this.nextDropAt = now + 180000;
      this.nextPurgeAt = now + 540000;
      this.nextTauntAt = now + 45000;
      this.nexus('start');
    }
  }

  onHack(team) {
    if (Math.random() < 0.6) this.nexus('hack', {}, team.id);
    if (team.hacked.size === (this.game.config.coreMinFragments ?? 8) && !team.saidEight) {
      team.saidEight = true;
      this.nexus('eight', {}, team.id);
      later(() => this.juno(this.story.juno?.eight, {}, team.id), 6000);
    }
  }

  onCapture(p) {
    if (p.socket && Math.random() < 0.7) this.nexus('capture', { name: p.name }, p.socket);
  }

  // the first breach wounds NEXUS: every drone drops for a moment and the city flickers
  onBreach() {
    this.setAct(3);
    this.nexus('breach');
    const now = Date.now();
    this.coreHitUntil = now + CORE_HIT_MS;
    for (const s of this.game.sentinels) { this.endHijack(s, false); s.frozenUntil = now + CORE_HIT_MS; s.state = 2; s.path = null; }
    this.world({ type: 'coreHit', until: this.coreHitUntil });
  }

  // ---------------------------------------------------------------- stealth tools
  // throw a bottle: it shatters where it lands and pulls nearby drones to the noise
  throwAt(p, d, ack) {
    const g = this.game, now = Date.now();
    if (g.phase !== 'playing' || p.stunUntil > now) return ack({ ok: false, error: 'Not now.' });
    if (p.hidden >= 0) return ack({ ok: false, error: 'You are hiding.' });
    if (!(p.throwables > 0)) return ack({ ok: false, error: 'Nothing left to throw. Power cells sometimes hold bottles.' });
    if (now - (p.lastThrow || 0) < THROW_CD || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return ack({ ok: false });
    let tx = d.x, ty = d.y;
    const dist = Math.hypot(tx - p.x, ty - p.y);
    if (dist > THROW_RANGE) { tx = p.x + ((tx - p.x) / dist) * THROW_RANGE; ty = p.y + ((ty - p.y) / dist) * THROW_RANGE; }
    p.lastThrow = now;
    p.throwables--;
    const flight = Math.max(250, (Math.min(dist, THROW_RANGE) / THROW_SPEED) * 1000);
    this.world({ type: 'throw', by: p.id, fx: p.x, fy: p.y, tx, ty, ms: flight });
    later(() => {
      this.world({ type: 'shatter', x: tx, y: ty });
      g.noise(tx, ty, THROW_NOISE, Date.now());
    }, flight);
    ack({ ok: true, left: p.throwables });
  }

  hide(p, id) {
    const spot = at(this.game.world.hideSpots, id);
    if (!spot || Math.hypot(spot.x - p.x, spot.y - p.y) > INTERACT_R + 1.5 * PX) return false;
    p.hidden = id;
    p.lit = false;
    return true;
  }

  unhide(p) {
    if (p.hidden < 0) return;
    p.hidden = -1;
    p.socket?.emit('hidden', { id: -1 });
  }

  // sneak up behind a drone that isn't hunting you and rewire it for a while
  hijack(p, id, ack) {
    const g = this.game, now = Date.now(), s = at(g.sentinels, id);
    if (!s || g.phase !== 'playing') return ack({ ok: false, error: 'No signal.' });
    if (now < (p.hijackAt || 0)) return ack({ ok: false, error: `Your rewiring kit is cooling down: ${Math.ceil((p.hijackAt - now) / 1000)}s` });
    if (s.state === 1 || s.state === 4 || s.frozenUntil > now) return ack({ ok: false, error: 'It is too alert to touch.' });
    if (Math.hypot(s.x - p.x, s.y - p.y) > HIJACK_R) return ack({ ok: false, error: 'Get closer.' });
    let da = Math.atan2(p.y - s.y, p.x - s.x) - s.look;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const C = CLASSES[p.cls] || {};
    if (Math.abs(da) < 1.9 && !C.hijackAnyAngle) return ack({ ok: false, error: 'It can see you. Come at it from behind (Engineers can rewire from any side).' });
    p.hijackAt = now + (C.hijackCd || HIJACK_CD);
    s.state = 4; s.owner = p.id; s.ownerTeam = p.team; s.hijackUntil = now + (C.hijackMs || HIJACK_MS); s.path = null; s.npc = undefined;
    this.world({ type: 'hijack', id: s.id, by: p.name, team: p.team, until: s.hijackUntil });
    g.event(`${p.name} hijacked a drone`, g.teams[p.team].color, 'hijack', p.team);
    if (Math.random() < 0.7) this.nexus('hijack', { name: p.name }, p.socket);
    ack({ ok: true, until: s.hijackUntil });
  }

  endHijack(s, announce = true) {
    if (s.state !== 4) return;
    s.state = 0; s.owner = 0; s.path = null;
    if (announce) this.world({ type: 'hijackEnd', id: s.id });
  }

  // a hijacked drone trails its new owner and lights the way
  driveHijacked(s, now, dt) {
    const g = this.game, o = g.players.get(s.owner);
    if (!o || !o.connected || now > s.hijackUntil || g.phase !== 'playing') { this.endHijack(s); return; }
    const tx = o.x - Math.cos(o.dir || 0) * 2.5 * PX, ty = o.y - Math.sin(o.dir || 0) * 2.5 * PX;
    const d = Math.hypot(tx - s.x, ty - s.y);
    if (d > 1.2 * PX) {
      if (d > 6 * PX) {
        if (now > s.repathAt || !s.path) { s.repathAt = now + 500; s.path = g.bfs(Math.floor(s.x / TILE), Math.floor(s.y / TILE), Math.floor(tx / TILE), Math.floor(ty / TILE), 6000); s.pathI = 0; }
        const wp = g.waypoint(s);
        g.steer(s, wp ? wp[0] : tx, wp ? wp[1] : ty, 7 * PX * dt);
      } else g.steer(s, tx, ty, Math.min(7 * PX, d * 2) * dt);
    }
    s.look = o.dir || 0;
  }

  // your team's hijacked drone vouches for you: other drones look straight past you
  escorted(p, now) {
    for (const s of this.game.sentinels) if (s.state === 4 && s.ownerTeam === p.team && (s.x - p.x) ** 2 + (s.y - p.y) ** 2 < ESCORT_R ** 2) return true;
    return false;
  }

  // ---------------------------------------------------------------- the upload finale
  // A team has the exit code running. NEXUS throws everything at the Core.
  onUploadStart(team) {
    const g = this.game, now = Date.now(), core = g.world.core;
    this.setAct(3);
    this.nexus('uploadStart', { team: team.name });
    this.juno(this.story.juno?.upload, { team: team.name });
    const r = 32 * PX, sector = sectorName(core.x, core.y);
    this.purge = { x: core.x, y: core.y, r, until: now + PURGE_MS, sector };
    this.world({ type: 'purge', ...this.purge });
    this.world({ type: 'uploadStart', team: team.id, name: team.name, color: team.color });
    this.surgeToCore(16, now);
  }

  onUploadStage(team, stage) {
    const now = Date.now();
    this.nexus(`upload${stage}`, { team: team.name });
    if (stage === 2 && !this.lullaby) {            // halfway: the Hush, right on top of them
      this.nextLullabyAt = now + LULLABY_WARN;
      this.flags.lullabyWarned = false;
    }
    this.surgeToCore(stage === 3 ? 20 : 10, now);
    this.glitchAll('tear');
  }

  // the nearest idle drones converge on the Core
  surgeToCore(n, now) {
    const g = this.game, core = g.world.core;
    [...g.sentinels].filter((s) => s.state !== 1 && s.state !== 4 && s.frozenUntil < now).sort((a, b) => d2(a, core) - d2(b, core)).slice(0, n)
      .forEach((s, i) => { const a = (i / n) * Math.PI * 2; g.investigate(s, core.x + Math.cos(a) * 8 * PX, core.y + Math.sin(a) * 8 * PX, now); });
  }

  // ---------------------------------------------------------------- the simulation slipping
  // From act II on, Halcyon glitches: rain falls up or hangs in the air, buildings flicker to
  // wireframe, a drone dissolves into code, the picture tears. More often in act III.
  tickGlitches(now) {
    const act = this.act || 1;
    if (act < 2) return;
    if (!this.nextGlitchAt) this.nextGlitchAt = now + 8000;
    if (now < this.nextGlitchAt) return;
    this.nextGlitchAt = now + (act >= 3 ? 20000 + Math.random() * 25000 : 35000 + Math.random() * 45000);
    this.glitchAll(pick(['rainUp', 'freeze', 'wire', 'drone', 'tear']));
    if (Math.random() < 0.35) this.nexus('glitch');
  }

  // every team sees the same slip, but a team still hunting its glitch password sees its own word in it
  glitchAll(kind) {
    for (const t of this.game.teams) if (t.active) this.io.to(`team:${t.id}`).emit('world', { type: 'glitch', kind, word: this.glitchWord(t) });
    this.io.to('screen').emit('world', { type: 'glitch', kind });
  }

  glitchWord(team) {
    const term = this.game.terminals.find((t) => t.puzzle.type === 'glitch' && !team.hacked.has(t.id));
    return term ? term.inst[team.variant].glitchWord : null;
  }

  // a team opened the glitch terminal before the city started slipping: give them a private slip soon
  requestGlitch(team) {
    const now = Date.now();
    if ((this.act || 1) >= 2 || now < (team.privateGlitchAt || 0)) return;
    team.privateGlitchAt = now + 60000;
    later(() => {
      if (this.game.phase !== 'playing' || !this.glitchWord(team)) return;
      this.io.to(`team:${team.id}`).emit('world', { type: 'glitch', kind: 'tear', word: this.glitchWord(team) });
    }, 6000 + Math.random() * 6000);
  }

  // ---------------------------------------------------------------- the Lullaby
  // indoors (ruin floors), your own base or hidden under a car counts as shelter
  sheltered(p) {
    if (p.hidden >= 0) return true;
    const w = this.game.world, t = tileAt(w, p.x, p.y);
    return t === T.FLOOR || t === T.YARD || baseIndexAt(w, p.x, p.y) === this.game.teams[p.team]?.base;
  }

  tickLullaby(now, active) {
    const L = this.lullaby;
    if (!L && now >= this.nextLullabyAt - LULLABY_WARN && !this.flags.lullabyWarned) {
      this.flags.lullabyWarned = true;
      this.world({ type: 'lullabyWarn', at: this.nextLullabyAt });
      this.juno(this.story.juno?.lullaby);
    }
    if (!L && now >= this.nextLullabyAt) {
      this.lullaby = { until: now + LULLABY_MS };
      this.world({ type: 'lullaby', until: this.lullaby.until });
      this.nexus('lullaby');
    }
    if (this.lullaby && now > this.lullaby.until) {
      this.lullaby = null;
      this.flags.lullabyWarned = false;
      this.nextLullabyAt = now + 420000 + Math.random() * 120000;
      this.world({ type: 'lullabyEnd' });
    }
    for (const p of active) p.drowsy = !!this.lullaby && !this.sheltered(p);
  }

  // ---------------------------------------------------------------- interactions
  use(p, d, ack) {
    const g = this.game, now = Date.now();
    const team = g.teams[p.team];
    const reach = (o, extra = 0) => d2(p, o) <= (INTERACT_R + extra) ** 2;
    if (g.phase !== 'playing') return ack({ ok: false, error: 'The city is still locked down.' });
    if (p.stunUntil > now) return ack({ ok: false, error: 'Rebooting…' });

    if (d.kind === 'echo') {
      const e = at(this.echoes, d.id);
      if (!e || !reach(e, 1.5 * PX)) return ack({ ok: false, error: 'Out of range.' });
      const fresh = !team.echoes.has(e.id);
      if (fresh) {
        team.echoes.add(e.id);
        g.addScore(team, ECHO_SCORE, p);
        g.scoresDirty = true;
        this.io.to(`team:${team.id}`).emit('echo', { id: e.id, by: p.name, story: e.story, count: team.echoes.size, total: this.echoes.length });
        // Juno remembers along with you
        const say = this.story.juno?.echoes?.[team.echoes.size === this.echoes.length ? 'all' : team.echoes.size];
        if (say) later(() => this.juno(say, {}, team.id), 4500);
      }
      return ack({ ok: true, fresh, story: e.story, count: team.echoes.size, total: this.echoes.length });
    }

    if (d.kind === 'npc') {
      const n = at(this.npcs, d.id);
      if (!n || n.state === 2 || !reach(n, 1.5 * PX)) return ack({ ok: false, error: 'Out of range.' });
      const sv = this.story.survivors || {};
      const droneNear = g.sentinels.some((s) => s.frozenUntil < now && d2(s, n) < (12 * PX) ** 2);
      if (droneNear) return ack({ ok: true, name: n.name, text: pick(sv.scared || ['Not now!']) });
      // the survivor Salim trusted with this team's password
      const pw = g.terminals.find((t) => t.puzzle.type === 'survivor' && !team.hacked.has(t.id) && t.inst[team.variant].npc === n.id);
      if (pw) return ack({ ok: true, name: n.name, text: fill(sv.password || 'Salim\'s password? “{word}”. He made me repeat it a hundred times. Don\'t lose it.', { word: pw.inst[team.variant].password }) });
      if (!n.told.has(team.id)) {
        const unknown = g.terminals.filter((t) => !team.knownTerminals.has(t.id) && !team.hacked.has(t.id));
        if (unknown.length) {
          n.told.add(team.id);
          unknown.sort((a, b) => d2(a, n) - d2(b, n));
          const t = unknown[Math.floor(Math.random() * Math.min(3, unknown.length))];
          team.knownTerminals.add(t.id);
          g.emitTeam(team);
          this.io.to(`team:${team.id}`).emit('discover', { kind: 'terminal', id: t.id, by: n.name, sector: sectorName(t.x, t.y) });
          return ack({ ok: true, name: n.name, text: fill(pick(sv.reveal || ['{sector}.']), { sector: sectorName(t.x, t.y) }), reveal: t.id });
        }
      }
      // each survivor tells their own story in order, then falls back to small talk
      const own = sv.personal?.[n.name] || [];
      n.talks ||= {};
      const k = n.talks[team.id] || 0;
      if (k < own.length) { n.talks[team.id] = k + 1; return ack({ ok: true, name: n.name, text: own[k] }); }
      const line = pick(sv.idle || ['…']);
      // a glitch in the simulation: sometimes they say it twice, word for word
      return ack({ ok: true, name: n.name, text: (this.act || 1) >= 2 && Math.random() < 0.3 ? `${line} ${line}` : line });
    }

    if (d.kind === 'relay') {
      const r = at(this.relays, d.id);
      if (!r || !reach(r, 1 * PX)) return ack({ ok: false, error: 'Out of range.' });
      if (r.cdUntil > now) return ack({ ok: false, error: `Relay rebooting: ${Math.ceil((r.cdUntil - now) / 1000)}s` });
      r.offUntil = now + BLACKOUT_MS;
      r.cdUntil = now + RELAY_CD_MS;
      const sector = sectorName(r.x, r.y);
      this.world({ type: 'relay', id: r.id, offUntil: r.offUntil, by: p.name, team: p.team });
      g.noise(r.x, r.y, 30 * PX, now);
      g.event(`${p.name} blacked out sector ${sector}`, team.color, 'blackout');
      this.nexus('blackout', { sector });
      return ack({ ok: true });
    }

    if (d.kind === 'cam') {
      const c = at(this.cams, d.id);
      if (!c || !reach(c, 1 * PX)) return ack({ ok: false, error: 'Out of range.' });
      c.offUntil = now + CAM_OFF_MS;
      this.world({ type: 'cam', id: c.id, offUntil: c.offUntil });
      return ack({ ok: true });
    }

    if (d.kind === 'drop') {
      const dr = this.drop;
      if (!dr || now < dr.landAt || !reach(dr, 1.5 * PX)) return ack({ ok: false, error: 'Out of range.' });
      this.drop = null;
      g.addScore(team, DROP_SCORE, p);
      p.battery = 1; p.stamina = 1;
      const unknown = g.terminals.filter((t) => !team.knownTerminals.has(t.id) && !team.hacked.has(t.id));
      let reveal = null;
      if (unknown.length) {
        const t = pick(unknown);
        team.knownTerminals.add(t.id);
        reveal = { id: t.id, sector: sectorName(t.x, t.y) };
      }
      g.emitTeam(team);
      g.emitScores();
      this.world({ type: 'dropTaken', by: p.name, team: p.team, x: dr.x, y: dr.y });
      g.event(`${p.name} (${team.name}) secured the supply drop`, team.color, 'drop');
      return ack({ ok: true, reward: DROP_SCORE, reveal });
    }
    return ack({ ok: false, error: 'Nothing to use.' });
  }

  // ---------------------------------------------------------------- simulation
  tick(now, dt, active) {
    const g = this.game;
    const playing = g.phase === 'playing';
    this.tickNpcs(now, dt, playing);
    if (!playing) return;
    const elapsed = (now - (this.playStart || now)) / 1000;
    const total = Math.max(1, (g.endsAt - (this.playStart || now)) / 1000);

    // Juno's timeline + time warnings
    for (const [i, j] of (this.story.juno?.timeline || []).entries()) {
      const due = j.atPct !== undefined ? j.atPct * total : j.at;
      if (!this.junoDone.has(i) && elapsed >= due) { this.junoDone.add(i); this.juno(j.text); }
    }
    this.act ||= this.flags.act || 1;
    this.tickAct(now);
    const left = g.endsAt - now;
    // countdown warnings only make sense in a night long enough to count down from
    if (left < 600000 && total > 900 && !this.flags.ten) { this.flags.ten = true; this.juno(this.story.juno?.tenLeft); }
    if (left < 300000 && total > 480 && !this.flags.five) { this.flags.five = true; this.nexus('final'); }

    // personal taunts: one player at a time, every minute or two
    if (now > this.nextTauntAt && active.length) {
      this.nextTauntAt = now + 60000 + Math.random() * 60000;
      const p = pick(active.filter((q) => baseIndexAt(g.world, q.x, q.y) < 0)) || null;
      if (p?.socket) this.nexus('taunt', { name: p.name, sector: sectorName(p.x, p.y) }, p.socket);
    }

    this.tickGlitches(now);
    this.tickLullaby(now, active);
    this.tickCameras(now, active);
    this.tickCars(now, active);
    this.tickDrop(now, active);
    this.tickPurge(now, active);
  }

  tickCameras(now, active) {
    if ((this._camT || 0) > now) return;
    this._camT = now + 200;
    const g = this.game, w = g.world;
    for (const c of this.cams) {
      if (c.offUntil > now || now - c.lastAlert < CAM_COOLDOWN_MS || this.blackoutAt(c.x, c.y, now)) continue;
      const ang = cameraAngle(c, now);
      for (const p of active) {
        if (p.invulnUntil > now || p.stunUntil > now || p.hidden >= 0 || this.escorted(p, now)) continue;
        const dx = p.x - c.x, dy = p.y - c.y, dd = Math.hypot(dx, dy);
        const still = !p.moving && p.mflags & 4;
        if (dd > c.range * (p.lit ? 1.2 : 1) || dd < 1 || still) continue;
        let da = Math.atan2(dy, dx) - ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > 0.42 || baseIndexAt(w, p.x, p.y) >= 0) continue;
        if (!lineOfSight(w, c.x, c.y, p.x, p.y, 3)) continue;
        c.lastAlert = now;
        p.socket?.emit('spotted', { cam: c.id });
        this.world({ type: 'camAlert', id: c.id, x: p.x, y: p.y });
        for (const s of g.sentinels) {
          if ((s.state === 0 || s.state === 3) && s.frozenUntil < now && d2(s, c) < (60 * PX) ** 2) g.investigate(s, p.x, p.y, now);
        }
        break;
      }
    }
  }

  tickCars(now, active) {
    const g = this.game;
    for (const p of active) {
      if (!p.moving || !(p.mflags & 2) || p.sprintUntil > now || p.stunUntil > now) continue; // overclock is silent
      for (const c of this.cars) {
        if (c.cdUntil > now || Math.abs(c.x - p.x) > ALARM_R || Math.abs(c.y - p.y) > ALARM_R) continue;
        c.until = now + ALARM_MS;
        c.cdUntil = now + ALARM_CD_MS;
        c.lastNoise = 0;
        this.world({ type: 'alarm', id: c.id, until: c.until });
        if (Math.random() < 0.5) this.nexus('alarm', { sector: sectorName(c.x, c.y) });
      }
    }
    for (const c of this.cars) {
      if (c.until > now && now - c.lastNoise > 3000) { c.lastNoise = now; g.noise(c.x, c.y, ALARM_NOISE, now); }
    }
  }

  spawnDrop(now) {
    const g = this.game, w = g.world;
    for (let tries = 0; tries < 60; tries++) {
      const k = pick(w.roadTiles);
      const x = (k % w.W + 0.5) * TILE, y = (Math.floor(k / w.W) + 0.5) * TILE;
      if (w.bases.some((b) => Math.hypot((b.x + b.w / 2) * TILE - x, (b.y + b.h / 2) * TILE - y) < 50 * PX)) continue;
      if (Math.hypot(w.core.x - x, w.core.y - y) < 30 * PX) continue;
      const sector = sectorName(x, y);
      this.drop = { x, y, landAt: now + DROP_WARN_MS, until: now + DROP_WARN_MS + DROP_LIFE_MS, sector, landed: false };
      this.world({ type: 'drop', ...this.dropInfo() });
      this.juno(this.story.juno?.drop, { sector });
      return;
    }
  }

  tickDrop(now) {
    const g = this.game;
    if (!this.drop && now > this.nextDropAt) { this.nextDropAt = now + 240000 + Math.random() * 120000; this.spawnDrop(now); }
    const d = this.drop;
    if (!d) return;
    if (!d.landed && now >= d.landAt) {
      d.landed = true;
      this.world({ type: 'dropLand', x: d.x, y: d.y });
      if (Math.random() < 0.6) this.nexus('drop', { sector: d.sector });
      // the nearest drones come to look
      [...g.sentinels].filter((s) => s.state !== 1 && s.state !== 4 && s.frozenUntil < now).sort((a, b) => d2(a, d) - d2(b, d)).slice(0, 4)
        .forEach((s) => g.investigate(s, d.x + (Math.random() - 0.5) * 6 * PX, d.y + (Math.random() - 0.5) * 6 * PX, now));
    }
    if (now > d.until) { this.drop = null; this.world({ type: 'dropGone' }); }
  }

  tickPurge(now, active) {
    const g = this.game, w = g.world;
    if (this.purge && now > this.purge.until) { this.purge = null; this.world({ type: 'purgeEnd' }); }
    if (this.purge || now < this.nextPurgeAt || !active.length) return;
    this.nextPurgeAt = now + 360000 + Math.random() * 180000;
    // sweep where the players are: the busiest spot outside the bases
    const out = active.filter((p) => baseIndexAt(w, p.x, p.y) < 0);
    if (!out.length) return;
    const c = pick(out);
    const r = 30 * PX;
    const sector = sectorName(c.x, c.y);
    this.purge = { x: c.x, y: c.y, r, until: now + PURGE_MS, sector };
    this.world({ type: 'purge', ...this.purge });
    this.nexus('purge', { sector });
    this.juno(this.story.juno?.purge, { sector });
    [...g.sentinels].filter((s) => s.state !== 1 && s.state !== 4 && s.frozenUntil < now).sort((a, b) => d2(a, c) - d2(b, c)).slice(0, 10).forEach((s, i) => {
      const a = (i / 10) * Math.PI * 2;
      g.investigate(s, c.x + Math.cos(a) * r * 0.5, c.y + Math.sin(a) * r * 0.5, now);
      s.invUntil = now + PURGE_MS;
    });
  }

  // Survivors hide, sometimes make a run for another hideout, and drones snatch them if they see them.
  tickNpcs(now, dt, playing) {
    const g = this.game, w = g.world;
    for (const n of this.npcs) {
      if (n.state === 2) {
        if (now > n.backAt) {
          const h = pick(w.hideouts);
          Object.assign(n, { state: 0, x: h.x, y: h.y, path: null, nextMove: now + 120000 + Math.random() * 180000 });
        }
        continue;
      }
      if (n.state === 0) {
        if (!playing || now < n.nextMove) continue;
        const dest = pick(w.hideouts.filter((h) => d2(h, n) > (30 * PX) ** 2 && d2(h, n) < (90 * PX) ** 2)) || pick(w.hideouts);
        n.path = g.bfs(Math.floor(n.x / TILE), Math.floor(n.y / TILE), dest.tx, dest.ty, 40000);
        n.pathI = 0;
        n.state = n.path ? 1 : 0;
        n.nextMove = now + 120000 + Math.random() * 200000;
        continue;
      }
      // moving
      let step = NPC_SPEED * dt;
      while (step > 0 && n.path && n.pathI < n.path.length) {
        const k = n.path[n.pathI];
        const tx = (k % w.W + 0.5) * TILE, ty = (Math.floor(k / w.W) + 0.5) * TILE;
        const dx = tx - n.x, dy = ty - n.y, dd = Math.hypot(dx, dy);
        if (dd <= step) { n.x = tx; n.y = ty; n.pathI++; step -= dd; }
        else { n.x += (dx / dd) * step; n.y += (dy / dd) * step; n.dir = Math.atan2(dy, dx); step = 0; }
      }
      if (!n.path || n.pathI >= n.path.length) { n.state = 0; n.path = null; }
      if (!playing || !g.sentinelsEnabled) continue;
      for (const s of g.sentinels) {
        if (s.state === 1 || s.state === 4 || s.frozenUntil > now) continue;
        if (d2(s, n) > (14 * PX) ** 2 || !lineOfSight(w, s.x, s.y, n.x, n.y, 4)) continue;
        s.state = 1; s.targetId = 0; s.npc = n.id; s.lastSeenAt = now; s.path = null;
        break;
      }
    }
  }

  // called by Game for a drone chasing a survivor
  chaseNpc(s, now, dt) {
    const g = this.game, n = this.npcs[s.npc];
    if (!n || n.state === 2 || now - s.lastSeenAt > 8000) { s.npc = undefined; g.toPatrol(s); return; }
    const d = Math.hypot(n.x - s.x, n.y - s.y);
    if (d < 1.4 * PX) {
      n.state = 2; n.backAt = now + 180000; n.path = null;
      s.npc = undefined; g.toPatrol(s);
      this.world({ type: 'npcTaken', id: n.id, x: n.x, y: n.y });
      g.event(`A survivor (${n.name}) was taken in sector ${sectorName(n.x, n.y)}`, '#ff4d6d', 'taken');
      if (Math.random() < 0.6) this.nexus('taken');
      return;
    }
    s.lastSeenAt = now;
    if (now > s.repathAt || !s.path) {
      s.repathAt = now + 500;
      s.path = g.bfs(Math.floor(s.x / TILE), Math.floor(s.y / TILE), Math.floor(n.x / TILE), Math.floor(n.y / TILE), 6000);
      s.pathI = 0;
    }
    const wp = d > 3 * PX ? g.waypoint(s) : null;
    g.steer(s, wp ? wp[0] : n.x, wp ? wp[1] : n.y, 5.5 * PX * dt);
    s.look = Math.atan2(n.y - s.y, n.x - s.x);
  }

  // survivors near a player, for the 's' packet
  npcsNear(p, r2) {
    const out = [];
    for (const n of this.npcs) {
      if (n.state === 2 || d2(n, p) > r2) continue;
      out.push(n.id, Math.round(n.x), Math.round(n.y), n.state, Math.round((n.dir || 0) * 100));
    }
    return out;
  }
}

