// Client side of the living city (shared by the 3D and 2D renderers): echoes, survivors,
// relays, cameras, car alarms, supply drops, purges, and the voices of NEXUS and Juno.
import { TILE, PX, T, INTERACT_R, sectorName, cameraAngle, tileAt, baseIndexAt } from '/shared/world.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export class LivingClient {
  constructor(G) {
    this.G = G;
    this.S = G.S;
    this.reset();
    this.buildDom();
    const so = G.socket;
    so.on('world', (e) => this.onWorld(e));
    so.on('nexus', (m) => this.nexusSays(m.text));
    so.on('radio', (m) => this.radio(m.from, m.text));
    so.on('echo', (e) => this.onEcho(e));
  }

  reset() {
    this.taken = new Set();      // echoes my team collected
    this.log = new Map();        // echo id -> story
    this.relays = new Map();     // id -> offUntil
    this.cams = new Map();       // id -> offUntil
    this.cars = new Map();       // id -> alarm until
    this.npcs = new Map();       // id -> {x,y,state,dir}
    this.drop = null;
    this.purge = null;
    this.names = [];
    this.total = 16;
    this.camAlerts = new Map();  // id -> time
    this.hijacks = new Map();    // drone id -> { until, team }
    this.lullaby = null;         // { until } while the Hush is on
    this.lullabyAt = 0;          // when the next Hush starts (after a warning)
    this.coreHitUntil = 0;
  }

  applyInit(live) {
    if (!live) return;
    const keepLog = this.log;
    this.reset();
    this.log = keepLog;
    for (const id of live.echoes) this.taken.add(id);
    for (const [id, t] of live.relays) this.relays.set(id, t);
    for (const [id, t] of live.cams) this.cams.set(id, t);
    for (const [id, t] of live.cars) this.cars.set(id, t);
    this.drop = live.drop;
    this.purge = live.purge;
    this.names = live.npcNames || [];
    this.lullaby = live.lullaby || null;
    for (const [id, until, team] of live.hijacks || []) this.hijacks.set(id, { until, team });
    this.total = live.echoTotal || 16;
    for (const id of [...this.log.keys()]) if (!this.taken.has(id)) this.log.delete(id);
    this.renderLog();
  }

  // survivors from the 's' packet: [id, x, y, state, dir*100] …
  readNpcs(arr) {
    if (!arr) return;
    const seen = new Set();
    for (let i = 0; i < arr.length; i += 5) {
      const id = arr[i];
      seen.add(id);
      let n = this.npcs.get(id);
      if (!n) { n = { id, x: arr[i + 1], y: arr[i + 2], dir: 0 }; this.npcs.set(id, n); }
      n.tx = arr[i + 1]; n.ty = arr[i + 2]; n.state = arr[i + 3]; n.tdir = arr[i + 4] / 100;
    }
    for (const id of this.npcs.keys()) if (!seen.has(id)) this.npcs.delete(id);
  }

  update(dt) {
    const k = Math.min(1, dt * 8);
    for (const n of this.npcs.values()) {
      const dx = n.tx - n.x, dy = n.ty - n.y;
      n.speed = Math.hypot(dx, dy) * k / Math.max(dt, 1e-3) / PX;
      n.x += dx * k; n.y += dy * k;
      if (n.state === 1 && Math.hypot(dx, dy) > 0.5) n.dir = Math.atan2(dy, dx);
    }
  }

  // ---------------------------------------------------------------- queries for renderers
  now() { return this.G.serverNow(); }
  relayOff(id) { return (this.relays.get(id) || 0) > this.now(); }
  camOn(id, now = this.now()) {
    const c = this.S.world.cameras[id];
    return (this.cams.get(id) || 0) < now && !this.blackoutAt(c.x, c.y, now);
  }
  camAngle(id, now = this.now()) { return cameraAngle(this.S.world.cameras[id], now); }
  carAlarm(id) { return (this.cars.get(id) || 0) > this.now(); }
  blackoutAt(x, y, now = this.now()) {
    for (const [id, until] of this.relays) {
      if (until < now) continue;
      const r = this.S.world.relays[id];
      if ((r.x - x) ** 2 + (r.y - y) ** 2 < r.radius ** 2) return true;
    }
    return false;
  }

  // the Hush only reaches you outdoors: ruin floors, your base and a hiding spot are safe
  sheltered(me) {
    if (me.hidden >= 0) return true;
    const w = this.S.world, t = tileAt(w, me.x, me.y);
    return t === T.FLOOR || t === T.YARD || baseIndexAt(w, me.x, me.y) === this.S.teams[me.team]?.base;
  }
  drowsy(me) { return !!this.lullaby && this.lullaby.until > this.now() && !this.sheltered(me); }

  // nearest living-world interactable within reach (or null)
  target(me) {
    const w = this.S.world, now = this.now();
    let best = (INTERACT_R + 0.5 * PX) ** 2, t = null;
    const consider = (kind, id, o, label, extra = 0) => {
      const d = (o.x - me.x) ** 2 + (o.y - me.y) ** 2 - extra;
      if (d < best) { best = d; t = { kind, id, x: o.x, y: o.y, label }; }
    };
    w.echoes.forEach((e, i) => { if (!this.taken.has(i)) consider('echo', i, e, 'Listen to the Echo', 2 * PX * PX); });
    for (const n of this.npcs.values()) consider('npc', n.id, n, `Talk to ${this.names[n.id] || 'the survivor'}`);
    w.relays.forEach((r, i) => consider('relay', i, r, this.relayOff(i) ? 'Relay is down' : 'Cut the district power'));
    w.cameras.forEach((c, i) => { if (this.camOn(i, now)) consider('cam', i, c, 'Jam the camera'); });
    if (this.drop && now >= this.drop.landAt) consider('drop', 0, this.drop, 'Open the supply drop', 4 * PX * PX);
    if (!(me.hidden >= 0)) w.hideSpots.forEach((h, i) => { if (Math.abs(h.x - me.x) < 120 && Math.abs(h.y - me.y) < 120) consider('hide', i, h, 'Hide under the tarp', -1.5 * PX * PX); });
    // drones you've crept up behind
    for (const s of this.S.sentinels.values()) {
      if (s.state === 1 || s.state === 2 || s.state === 4) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d > 2.4 * PX) continue;
      let da = Math.atan2(me.y - s.y, me.x - s.x) - s.look;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.9) { best = Infinity; t = { kind: 'hijack', id: s.id, x: s.x, y: s.y, label: 'Rewire the drone (hold E)' }; }
    }
    return t;
  }

  use(t) {
    const G = this.G, hud = G.hud;
    if (t.kind === 'relay' && this.relayOff(t.id)) { hud.toast('This relay is already down.'); return; }
    G.socket.emit('use', { kind: t.kind, id: t.id }, (res) => {
      if (!res?.ok) { hud.toast(res?.error || 'Nothing happens.'); G.sfx.play('error'); return; }
      if (t.kind === 'echo') { this.taken.add(t.id); if (res.story) this.log.set(t.id, res.story); this.read(t.id, res.story, res.fresh); this.renderLog(); }
      else if (t.kind === 'npc') this.say(res.name, res.text, !!res.reveal);
      else if (t.kind === 'relay') { G.sfx.play('powerdown'); G.renderer.shake(6); }
      else if (t.kind === 'cam') { G.sfx.play('jam'); hud.toast('Camera jammed for 60s.'); }
      else if (t.kind === 'drop') {
        G.sfx.play('success');
        hud.announce('SUPPLY DROP SECURED', `+${res.reward} · battery & stamina full${res.reveal ? ` · terminal located in ${res.reveal.sector}` : ''}`, '#ffb02e');
      }
    });
  }

  // ---------------------------------------------------------------- server events
  onWorld(e) {
    const G = this.G, S = this.S, hud = G.hud, R = G.renderer, sfx = G.sfx;
    if (!S.world || !S.me) return;
    const w = S.world;
    const near = (x, y, m) => Math.hypot(x - S.me.x, y - S.me.y) < m * PX;
    switch (e.type) {
      case 'relay': {
        this.relays.set(e.id, e.offUntil);
        const r = w.relays[e.id];
        R.liveEvent?.(e);
        if (near(r.x, r.y, 70)) sfx.play('powerdown', { x: r.x, y: r.y });
        break;
      }
      case 'cam': this.cams.set(e.id, e.offUntil); break;
      case 'camAlert': {
        this.camAlerts.set(e.id, performance.now());
        const c = w.cameras[e.id];
        if (near(c.x, c.y, 40)) sfx.play('camAlert', { x: c.x, y: c.y });
        R.liveEvent?.(e);
        break;
      }
      case 'alarm': {
        this.cars.set(e.id, e.until);
        const c = w.alarmCars[e.id];
        if (near(c.x, c.y, 120)) sfx.carAlarm?.(c, e.until - this.now());
        R.liveEvent?.(e);
        break;
      }
      case 'drop':
        this.drop = { x: e.x, y: e.y, landAt: e.landAt, until: e.until, sector: e.sector };
        hud.announce('SUPPLY DROP INBOUND', `Sector ${e.sector} · lands in 20s`, '#ffb02e');
        sfx.play('flyover');
        R.liveEvent?.(e);
        break;
      case 'dropLand':
        if (this.drop) this.drop.landed = true;
        R.liveEvent?.(e);
        if (near(e.x, e.y, 90)) { sfx.play('thud', { x: e.x, y: e.y }); R.shake(near(e.x, e.y, 25) ? 10 : 3); }
        break;
      case 'dropTaken':
        this.drop = null;
        R.liveEvent?.(e);
        if (e.team !== S.me.team) hud.toast(`${e.by} grabbed the supply drop.`);
        break;
      case 'dropGone': this.drop = null; R.liveEvent?.(e); break;
      case 'purge':
        this.purge = { x: e.x, y: e.y, r: e.r, until: e.until, sector: e.sector };
        hud.announce('PURGE SWEEP', `NEXUS is sweeping sector ${e.sector}`, '#ff2a4a');
        sfx.play('siren');
        R.liveEvent?.(e);
        break;
      case 'purgeEnd': this.purge = null; R.liveEvent?.(e); break;
      case 'throw': R.liveEvent?.(e); if (e.by !== S.me.id && near(e.fx, e.fy, 25)) sfx.play('whoosh'); break;
      case 'shatter': R.liveEvent?.(e); if (near(e.x, e.y, 60)) sfx.play('glass', { x: e.x, y: e.y }); break;
      case 'hijack':
        this.hijacks.set(e.id, { until: e.until, team: e.team });
        if (e.team === S.me.team && e.by !== S.me.name) hud.toast(`${e.by} rewired a drone. Stay close to it and the others won't see you.`, 4000);
        R.liveEvent?.(e);
        break;
      case 'hijackEnd': this.hijacks.delete(e.id); R.liveEvent?.(e); break;
      case 'lullabyWarn':
        this.lullabyAt = e.at;
        hud.announce('NEXUS IS RELEASING THE HUSH', 'Get inside a ruin, back to base, or under a tarp', '#ff2bd6');
        sfx.play('lullabyWarn');
        break;
      case 'lullaby':
        this.lullaby = { until: e.until };
        sfx.lullaby?.(e.until - this.now());
        R.liveEvent?.(e);
        break;
      case 'lullabyEnd': this.lullaby = null; R.liveEvent?.(e); break;
      case 'glitch':
        // the simulation slips (and a team hunting its glitch password sees its word)
        R.liveEvent?.(e);
        sfx.play('simGlitch');
        if (e.word) hud.glitchWord(e.word);
        break;
      case 'uploadStart':
        if (e.team !== S.me.team) hud.announce(`${e.name} IS UPLOADING`, 'Get to the Core and contest it: more of you in the ring stalls their upload', e.color);
        sfx.play('siren');
        break;
      case 'act':
        // a new act of the night: title card, the city shudders
        hud.announce(e.title, e.name, '#ff2bd6');
        sfx.play('echo');
        R.liveEvent?.(e);
        break;
      case 'coreHit':
        this.coreHitUntil = e.until;
        R.liveEvent?.(e);
        sfx.play('coreHit');
        hud.announce('THE CORE IS WOUNDED', 'Every drone is down for a moment', '#3dff8a');
        break;
      case 'npcTaken': {
        R.liveEvent?.(e);
        if (near(e.x, e.y, 60)) sfx.play('taken', { x: e.x, y: e.y });
        break;
      }
    }
  }

  onEcho(e) {
    this.taken.add(e.id);
    if (e.story) this.log.set(e.id, e.story);
    this.renderLog();
    if (e.by !== this.S.me.name) this.G.hud.toast(`${e.by} recovered an Echo: “${e.story?.title || '…'}” (${e.count}/${e.total})`, 4500);
  }

  // ---------------------------------------------------------------- voices + UI
  buildDom() {
    if ($('#nexus-line')) return;
    document.body.append(
      Object.assign(el('div', 'hidden'), { id: 'nexus-line' }),
      Object.assign(el('div', 'hidden'), { id: 'radio-box' }),
      Object.assign(el('div', 'hidden'), { id: 'npc-say' }),
      Object.assign(el('div', 'hidden'), { id: 'echo-reader' }),
    );
    $('#echo-reader').addEventListener('click', () => this.closeReader());
  }

  nexusSays(text) {
    const box = $('#nexus-line');
    box.innerHTML = '';
    box.append(el('div', 'who', 'NEXUS'), el('div', 'txt', text));
    box.classList.remove('hidden', 'out');
    void box.offsetWidth;
    box.classList.add('in');
    this.G.sfx.nexusVoice?.(text);
    this.G.renderer.glitch?.();
    this.G.renderer.nexusSays?.(text);
    clearTimeout(this.nexusT);
    this.nexusT = setTimeout(() => { box.classList.add('out'); setTimeout(() => box.classList.add('hidden'), 900); }, 4200 + text.length * 45);
  }

  radio(from, text) {
    const box = $('#radio-box');
    box.innerHTML = '';
    const head = el('div', 'who');
    head.append(el('span', 'dot'), document.createTextNode(`${from} · RADIO`));
    const body = el('div', 'txt');
    box.append(head, body);
    box.classList.remove('hidden');
    this.G.sfx.play('radio');
    let i = 0;
    clearInterval(this.radioTyping);
    this.radioTyping = setInterval(() => { body.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(this.radioTyping); }, 24);
    clearTimeout(this.radioT);
    this.radioT = setTimeout(() => box.classList.add('hidden'), 6000 + text.length * 45);
  }

  say(name, text, reveal) {
    const box = $('#npc-say');
    box.innerHTML = '';
    box.append(el('div', 'who', name), el('div', 'txt', `“${text}”`));
    if (reveal) box.append(el('div', 'tag', 'TERMINAL MARKED ON YOUR MAP'));
    box.classList.remove('hidden');
    this.G.sfx.play('murmur');
    clearTimeout(this.sayT);
    this.sayT = setTimeout(() => box.classList.add('hidden'), 5000 + text.length * 40);
  }

  read(id, story, fresh) {
    if (!story) return;
    const box = $('#echo-reader');
    box.innerHTML = '';
    const card = el('div', 'card');
    const n = [...this.log.keys()].length;
    card.append(
      el('div', 'idx', `ECHO ${String(id + 1).padStart(2, '0')} · ${n}/${this.total} RECOVERED${fresh ? ' · +15' : ''}`),
      el('h2', null, story.title),
      el('div', 'by', story.by),
    );
    const body = el('p', 'body');
    card.append(body, el('div', 'reader-hint', 'click or press E to close'));
    box.append(card);
    box.classList.remove('hidden');
    this.G.input?.unlock?.();
    this.G.sfx.play('echo');
    let i = 0;
    clearInterval(this.readT);
    this.readT = setInterval(() => { body.textContent = story.text.slice(0, i += 2); if (i >= story.text.length) clearInterval(this.readT); }, 18);
    this.readerOpen = true;
  }

  closeReader() {
    clearInterval(this.readT);
    $('#echo-reader')?.classList.add('hidden');
    this.readerOpen = false;
  }

  // collected echoes, listed in the INTEL panel
  renderLog() {
    const host = $('#echo-log');
    if (!host) return;
    host.innerHTML = '';
    host.append(el('h4', null, `ECHOES ${this.taken.size}/${this.total}`));
    const ids = [...this.log.keys()].sort((a, b) => a - b);
    if (!ids.length) host.append(el('div', 'empty', 'Pale blue lights flicker around the city. Find them to learn what happened.'));
    for (const id of ids) {
      const s = this.log.get(id);
      const row = el('button', 'echo-row');
      row.append(el('b', null, String(id + 1).padStart(2, '0')), document.createTextNode(` ${s.title} · ${s.by}`));
      row.addEventListener('click', () => this.read(id, s, false));
      host.append(row);
    }
  }

  // ---------------------------------------------------------------- minimap overlay
  drawMap(g, P, u, big, now) {
    const w = this.S.world, snow = this.now(), t = now / 1000;
    // blacked-out districts
    for (const [id, until] of this.relays) {
      if (until < snow) continue;
      const r = w.relays[id];
      const [x, y] = P(r.x, r.y);
      const [rx] = P(r.x + r.radius, r.y);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath(); g.arc(x, y, rx - x, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,140,255,0.5)'; g.setLineDash([3, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]);
    }
    // purge
    if (this.purge && this.purge.until > snow) {
      const [x, y] = P(this.purge.x, this.purge.y);
      const [rx] = P(this.purge.x + this.purge.r, this.purge.y);
      g.fillStyle = rgba('#ff2a4a', 0.12 + Math.sin(t * 6) * 0.06);
      g.strokeStyle = '#ff2a4a'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, rx - x, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // supply drop
    if (this.drop) {
      const [x, y] = P(this.drop.x, this.drop.y);
      const k = (t * 1.5) % 1;
      g.strokeStyle = rgba('#ffb02e', 1 - k); g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, u * (1.5 + k * 5), 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffb02e'; g.fillRect(x - u, y - u, u * 2, u * 2);
    }
    // echoes my team already has (so they know where they've been)
    g.fillStyle = 'rgba(140,200,255,0.8)';
    for (const id of this.taken) {
      const e = w.echoes[id];
      const [x, y] = P(e.x, e.y);
      g.beginPath(); g.arc(x, y, u * 0.6, 0, Math.PI * 2); g.fill();
    }
  }
}
