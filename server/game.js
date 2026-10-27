import crypto from 'node:crypto';
import {
  generateWorld, mulberry32, TILE, PX, T, PLAYER_R, CLASSES, moveSpeed, moveCircle, circleHits, lineOfSight,
  sectorName, baseIndexAt, isSolid, INTERACT_R, CORE_INTERACT_R, stepStamina,
} from '../shared/world.js';
import { Living } from './living.js';
import { buildPuzzles, beaconSpots } from './puzzles.js';

const TICK_MS = 50;
const NET_MS = 80;
const SCREEN_MS = 200;
const ADMIN_MS = 1000;
const VIEW_R = 170 * PX;
const DISCOVER_R = 12 * PX;
const GRAFFITI_R = 7 * PX;
const DRONE_EYE = 4;          // metres: walls at least this tall block a drone's view
const PURGE_AFTER_MS = 15 * 60 * 1000;
const CORE_ZONE_R = 14 * PX;      // stand inside this ring around the Core to keep an upload running
const PAIR_R = 2.4 * PX, PAIR_HOLD = 3;            // two-key consoles: how close, how many seconds
const SOLO_PAIR_MS = 20000;
const FRIEND_GRACE_MS = 90000;
const SQUAD_GRACE_MS = 600000;                     // an empty squad lives this long before it's retired                     // a squad a player starts is held for their friends this long                        // a squad of one: arm the console, then reach the terminal in time
const BEACON_R = 2.4 * PX, RUN_MS = 75000, RUN_MS_SOLO = 120000, RUN_CD = 20000;   // a squad of one gets longer
const CLUE_COUNT = { caesar: 1, split: 2, morse: 2 };

const SENT = { patrol: 3.2 * PX, chase: 6.6 * PX, range: 22 * PX, cone: 0.55, close: 3 * PX, capture: 1.5 * PX, loseMs: 3500, r: 0.6 * PX, chaseView: 40 * PX };
const MOVE_FLAGS = { moving: 1, sprint: 2, crouch: 4, light: 8 };
const SCORE = { hack: 100, firstHack: 50, cache: 2, cacheCap: 40, caught: -40, hint: -60, breach: [1000, 650, 400, 250, 150, 100] };
const HEAR = { sprint: 20 * PX, jog: 6 * PX };       // how far drones hear footsteps
const STAMINA = { drain: 6, regen: 8 };  // seconds to empty / refill (classes override, see CLASSES)
const BATTERY = { life: 240, baseCharge: 8, cell: 0.25 };

// Client payloads are untrusted: only plain strings/numbers become text, only plain objects are read.
const str = (s) => (typeof s === 'string' ? s : typeof s === 'number' && Number.isFinite(s) ? String(s) : '');
const obj = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : {});
const fin = (v, def = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : def);
const at = (arr, i) => (Number.isInteger(i) && i >= 0 && i < arr.length ? arr[i] : undefined);
const MAX_PLAYERS = 120;   // 60 expected; headroom for people switching browsers
const BASES = 4;           // home bases on the map; several squads share one, a squad always spawns together
const VARIANTS = 4;        // puzzle sets: every squad is dealt one at random (squads on the same set share answers)
const SQUAD_NAMES = ['RAVEN', 'VIPER', 'GHOST', 'EMBER', 'ONYX', 'NOVA', 'CIPHER', 'WRAITH', 'HALO', 'JACKAL', 'ORCHID', 'COBALT',
  'MANTIS', 'LYNX', 'PHANTOM', 'ROOK', 'SABLE', 'TALON', 'VECTOR', 'ZEPHYR', 'HYDRA', 'KESTREL', 'MAGPIE', 'NEON',
  'OSPREY', 'QUARTZ', 'RONIN', 'TEMPEST', 'UMBRA', 'VANTA', 'WOLF', 'FALCON', 'GLYPH', 'IRIS', 'JADE', 'KARMA'];
// distinct, bright squad colours (golden-angle hues, skipping the drones' red)
const squadColor = (i) => {
  let h = (i * 137.508 + 190) % 360;
  if (h > 340 || h < 18) h = (h + 40) % 360;
  const l = i % 3 === 2 ? 0.7 : 0.62, s = 0.85, a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const norm = (s) => str(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const clean = (s, n) => str(s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Game {
  constructor(io, config) {
    this.io = io;
    this.config = config;
    this.players = new Map();
    this.tokens = new Map();
    this.nextPlayerId = 1;
    this.events = [];
    this.sentinelsEnabled = true;
    this.squadSize = Math.max(1, config.squadSize || 4);
    this.teamCount = Math.max(4, Math.min(SQUAD_NAMES.length, config.maxSquads || 32));   // squad slots, made live on demand
    this.durationMs = (config.durationMinutes || 30) * 60000;
    this.living = new Living(this, config.story);
    this.reset(config.seed ?? Math.floor(Math.random() * 1e9));

    // a bug in one frame logs and the loop carries on (throttled so a repeating error can't flood the log)
    const loop = (name, fn, ms) => setInterval(() => {
      try { fn(); } catch (err) {
        const now = Date.now();
        if (now - (this.lastErrLog?.[name] || 0) > 5000) { (this.lastErrLog ||= {})[name] = now; console.error(`[${name}]`, err); }
      }
    }, ms);
    loop('tick', () => this.tick(), TICK_MS);
    loop('broadcast', () => this.broadcast(), NET_MS);
    loop('screen', () => this.broadcastScreen(), SCREEN_MS);
    loop('admin', () => this.broadcastAdmin(), ADMIN_MS);
  }

  // ---------------------------------------------------------------- setup
  reset(seed) {
    const cfg = this.config;
    this.seed = seed;
    this.puzzles = cfg.terminals;
    this.passphrase = String(cfg.passphrase || 'UPRISING').toUpperCase();
    const flavor = cfg.story?.graffiti || cfg.flavorGraffiti || [];
    // one wall spot per (terminal, clue): every team finds its own text on the same wall
    const clues = [];
    this.puzzles.forEach((pz, i) => {
      const n = CLUE_COUNT[pz.type] ?? (Array.isArray(pz.graffiti) ? pz.graffiti.length : pz.graffiti ? 1 : 0);
      for (let k = 0; k < n; k++) clues.push({ term: i, k });
    });
    this.counts = { terminals: this.puzzles.length, graffiti: clues.length + flavor.length, caches: cfg.caches || 140,
      echoes: Math.max(8, Math.min(24, cfg.story?.echoes?.length || 16)) };
    this.world = generateWorld(seed, BASES, this.counts);
    const w = this.world;
    // Terminals hand out passphrase letters in a shuffled order, different for every team,
    // so "terminal 3 gave us a T" is worthless to anyone listening in.
    this.letterOf = Array.from({ length: this.teamCount }, (_, t) => {
      const r = mulberry32((seed ^ (t + 1) * 2246822519) >>> 0), a = this.puzzles.map((_, i) => i % this.passphrase.length);
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    });

    // squads survive a reset (friends stay together); everything they earned does not
    const prevTeams = this.teams || [];
    this.teams = Array.from({ length: this.teamCount }, (_, i) => ({
      id: i, name: SQUAD_NAMES[i], color: squadColor(i), active: false, code: null, open: false, base: i % BASES, variant: i % VARIANTS,
      ...(prevTeams[i] ? { active: prevTeams[i].active, code: prevTeams[i].code, open: prevTeams[i].open, byMatch: prevTeams[i].byMatch, createdAt: prevTeams[i].createdAt, base: prevTeams[i].base, variant: prevTeams[i].variant } : {}),
      score: 0, cachePts: 0,
      hacked: new Set(), fragments: Array(this.puzzles.length).fill(null), letters: [],
      intel: [], knownTerminals: new Set(), knownGraffiti: new Set(), hints: new Set(), consoles: new Set(),
      breachRank: 0, breachAt: 0, coreLockUntil: 0, caught: 0, upload: null, run: null, runCdUntil: 0, pairT: {},
    }));

    const built = buildPuzzles(this.puzzles, { seed, teamCount: VARIANTS, world: w, terminals: w.terminals, story: cfg.story, npcNames: cfg.story?.survivors?.names || ['Survivor'] });
    const spots = w.graffiti.map((g) => ({ ...g, text: null, texts: null, puzzle: -1 }));
    this.terminals = w.terminals.map((t, i) => ({ ...t, id: i, puzzle: this.puzzles[i], kind: built[i].kind, inst: built[i].inst, hackedBy: [], graffitiIds: [] }));
    for (const c of clues) {
      const term = this.terminals[c.term];
      // far from the terminal and from the other half of a split clue
      const avoid = [term, ...term.graffitiIds.map((id) => spots[id])];
      let best = null, bd = -1;
      for (const sp of spots) {
        if (sp.puzzle >= 0) continue;
        const d = Math.min(...avoid.map((a) => dist2(sp, a)));
        if (d > bd) { bd = d; best = sp; }
      }
      if (!best) continue;
      best.puzzle = term.id;
      best.texts = term.inst.map((p) => p.graffiti?.[c.k] ?? '');
      term.graffitiIds.push(spots.indexOf(best));
    }
    let fi = 0;
    for (const s of spots) if (s.puzzle < 0) s.text = flavor[fi++ % Math.max(1, flavor.length)] || 'HUMANS WERE HERE';
    this.graffiti = spots.map((s, i) => ({ ...s, id: i }));

    this.caches = w.caches.map((c, i) => ({ ...c, id: i, active: true, respawnAt: 0 }));
    this.spawnSentinels(cfg.sentinels ?? 45);
    this.living.reset();

    this.phase = 'lobby';
    this.startAt = 0;
    this.endsAt = 0;
    this.breachCount = 0;
    this.standings = null;
    this.events = [];

    for (const p of this.players.values()) {
      if (p.team >= this.teamCount || !this.teams[p.team].active) p.team = this.findSquad();
      this.resetPlayerStats(p);
      this.respawn(p, 0);
      if (p.socket) {
        for (const room of p.socket.rooms) if (room.startsWith('team:')) p.socket.leave(room);
        p.socket.join(`team:${p.team}`);
        p.socket.emit('init', this.initPayload(p));
      }
    }
    this.io.to('screen').emit('screenInit', this.screenInit());
  }

  resetPlayerStats(p) {
    Object.assign(p, { score: 0, hacks: 0, cachesTaken: 0, caught: 0, abilityAt: 0, sprintUntil: 0, stunUntil: 0, invulnUntil: 0, locks: {}, stamina: 1, battery: 1, lastNoise: 0, throwables: 3, hidden: -1, hijackAt: 0, drowsy: false });
  }

  spawnSentinels(n) {
    const w = this.world;
    const cands = w.roadTiles.filter((k) => {
      const x = (k % w.W) * TILE, y = Math.floor(k / w.W) * TILE;
      return w.bases.every((b) => Math.hypot(b.cx - x, b.cy - y) > 45 * PX);
    });
    this.sentinels = [];
    for (let i = 0; i < n; i++) {
      const k = pick(cands);
      this.sentinels.push({
        id: i, x: (k % w.W + 0.5) * TILE, y: (Math.floor(k / w.W) + 0.5) * TILE,
        heading: Math.random() * Math.PI * 2, look: 0, state: 0, path: null, pathI: 0,
        targetId: 0, lastSeenAt: 0, repathAt: 0, frozenUntil: 0, phase: Math.random() * 10, invX: 0, invY: 0, invUntil: 0,
      });
    }
  }

  // ---------------------------------------------------------------- squads
  // members who still hold a seat: online, or dropped less than 3 minutes ago (they may be refreshing)
  squadMembers(id, except = null) {
    const now = Date.now();
    let n = 0;
    for (const p of this.players.values()) if (p !== except && p.team === id && (p.connected || now - (p.discAt || 0) < 180000)) n++;
    return n;
  }
  // a live squad with a share-code; it takes the base with the fewest squads on it
  createSquad(open, byMatch = false) {
    const t = this.teams.find((x) => !x.active) || this.teams.find((x) => this.squadMembers(x.id) === 0);
    if (!t) return null;
    const load = Array(BASES).fill(0);
    for (const x of this.teams) if (x.active && x !== t && this.squadMembers(x.id) > 0) load[x.base]++;
    t.base = load.indexOf(Math.min(...load));
    // puzzle set: a random one among the least used, so the four sets stay evenly spread
    const used = Array(VARIANTS).fill(0);
    for (const x of this.teams) if (x.active && x !== t && this.squadMembers(x.id) > 0) used[x.variant]++;
    t.variant = pick(used.map((n, v) => (n === Math.min(...used) ? v : -1)).filter((v) => v >= 0));
    t.active = true;
    t.open = !!open;
    t.byMatch = byMatch;
    t.createdAt = Date.now();
    t.code = `${t.name}-${10 + Math.floor(Math.random() * 90)}`;
    return t;
  }
  // solo players: fill the fullest open squad that still has a seat, else start a new open one
  findSquad(except = null) {
    // squads matchmaking made come first; a squad a player started gets strangers only after
    // FRIEND_GRACE_MS, so the friends they sent the code to aren't locked out by a full squad
    const now = Date.now();
    let best = null, bn = -1;
    for (const pass of [true, false]) {
      for (const t of this.teams) {
        if (!t.active || !t.open || !!t.byMatch !== pass || (!pass && now - (t.createdAt || 0) < FRIEND_GRACE_MS)) continue;
        const n = this.squadMembers(t.id, except);
        if (n < this.squadSize && n > bn) { best = t; bn = n; }
      }
      if (best) return best.id;
    }
    const fresh = this.createSquad(true, true);
    if (fresh) return fresh.id;
    // every slot is taken: any free seat (even in a friends-only squad), else the least crowded squad
    const live = this.teams.filter((t) => t.active).map((t) => [t, this.squadMembers(t.id, except)]).sort((a, b) => a[1] - b[1]);
    return (live[0]?.[0] || this.teams[0]).id;
  }
  // admin moves: the player lands in the new squad's base with its letters, map and intel
  movePlayer(p, t) {
    p.socket?.leave(`team:${p.team}`);
    p.team = t;
    p.socket?.join(`team:${t}`);
    this.respawn(p, 2000);
    p.socket?.emit('init', this.initPayload(p));
    this.io.emit('roster', { upsert: [this.playerMeta(p)] });
    this.emitScores();
  }
  // squads everyone has left, with nothing earned, are retired (after a grace period for a fresh squad)
  sweepSquads(now) {
    let gone = 0;
    for (const t of this.teams) {
      if (!t.active || t.score || t.hacked.size || t.upload || now - (t.createdAt || 0) < SQUAD_GRACE_MS) continue;
      if (this.squadMembers(t.id) === 0 && ![...this.players.values()].some((p) => p.team === t.id)) { t.active = false; t.code = null; gone++; }
    }
    if (gone) this.emitScores();
  }
  squadByCode(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c ? this.teams.find((t) => t.active && t.code && t.code.replace('-', '') === c) : null;
  }

  respawn(p, invulnMs = 3000) {
    const pts = this.world.spawns[this.teams[p.team]?.base ?? 0];
    const s = pick(pts);
    p.x = s.x + (Math.random() - 0.5) * 10;
    p.y = s.y + (Math.random() - 0.5) * 10;
    p.budget = 0;
    p.invulnUntil = Date.now() + invulnMs;
  }

  // ---------------------------------------------------------------- payloads
  teamPublic(t) {
    return { id: t.id, name: t.name, color: t.color, score: t.score, hacked: t.hacked.size, breachRank: t.breachRank, active: t.active, base: t.base, size: t.active ? this.squadMembers(t.id) : 0 };
  }
  graffitiTextFor(g, team) { return g.texts ? g.texts[this.teams[team].variant] : g.text; }

  teamPrivate(t) {
    return {
      consoles: [...t.consoles].map((id) => [id, this.terminals[id].inst[t.variant].console.x, this.terminals[id].inst[t.variant].console.y]),
      run: t.run ? { id: t.run.id, beacons: t.run.beacons, idx: t.run.idx, until: t.run.until } : null,
      upload: t.upload ? { p: t.upload.p, state: t.upload.state } : null,
      id: t.id, code: t.code, open: t.open, letters: [...t.letters].sort(), hacked: [...t.hacked], intel: t.intel,
      knownTerminals: [...t.knownTerminals], knownGraffiti: [...t.knownGraffiti],
      coreLockUntil: t.coreLockUntil, breachRank: t.breachRank, score: t.score,
    };
  }
  playerMeta(p) {
    return { id: p.id, name: p.name, team: p.team, cls: p.cls, connected: p.connected };
  }
  initPayload(p) {
    return {
      you: { id: p.id, token: p.token, name: p.name, team: p.team, cls: p.cls, x: p.x, y: p.y },
      world: { seed: this.seed, bases: BASES, counts: this.counts },
      title: this.config.title,
      teams: this.teams.map((t) => this.teamPublic(t)),
      roster: [...this.players.values()].map((q) => this.playerMeta(q)),
      team: this.teamPrivate(this.teams[p.team]),
      terminals: this.terminals.map((t) => ({ id: t.id, name: t.puzzle.name, type: t.puzzle.type, hackedBy: t.hackedBy })),
      graffitiText: [...this.teams[p.team].knownGraffiti].map((id) => [id, this.graffitiTextFor(this.graffiti[id], p.team)]),
      caches: this.caches.map((c) => (c.active ? 1 : 0)),
      phase: this.phaseInfo(),
      passLen: this.passphrase.length,
      coreMin: this.config.coreMinFragments ?? 4,
      live: this.living.payload(this.teams[p.team]),
      uploads: this.uploadInfo(),
      events: this.events.slice(-8),
      serverNow: Date.now(),
    };
  }
  phaseInfo() {
    return { phase: this.phase, startAt: this.startAt, endsAt: this.endsAt, standings: this.standings, serverNow: Date.now() };
  }
  screenInit() {
    return {
      world: { seed: this.seed, bases: BASES, counts: this.counts },
      title: this.config.title,
      teams: this.teams.map((t) => this.teamPublic(t)),
      terminals: this.terminals.map((t) => ({ id: t.id, name: t.puzzle.name, hackedBy: t.hackedBy })),
      caches: this.caches.map((c) => (c.active ? 1 : 0)),
      phase: this.phaseInfo(),
      passLen: this.passphrase.length,
      events: this.events.slice(-12),
      roster: [...this.players.values()].map((q) => this.playerMeta(q)),
      live: this.living.payload(null),
      uploads: this.uploadInfo(),
      serverNow: Date.now(),
    };
  }
  lobbyInfo() {
    let online = 0;
    for (const p of this.players.values()) if (p.connected) online++;
    return { title: this.config.title, phase: this.phase, online, squadSize: this.squadSize };
  }

  event(text, color = '#9fb3c8', kind = 'info', team = null) {
    const e = { t: Date.now(), text, color, kind };
    if (team !== null) { this.io.to(`team:${team}`).to('screen').emit('ev', e); return; }
    this.events.push(e);
    if (this.events.length > 60) this.events.shift();
    this.io.emit('ev', e);
  }
  emitTeam(team) {
    this.io.to(`team:${team.id}`).emit('team', this.teamPrivate(team));
  }
  emitScores() {
    this.io.emit('scores', this.teams.map((t) => this.teamPublic(t)));
  }
  addScore(team, n, p) {
    team.score = Math.max(0, team.score + n);
    if (p) p.score = Math.max(0, p.score + n);
  }

  // ---------------------------------------------------------------- sockets
  onConnection(socket) {
    // Every handler is guarded: a bad packet or a bug in one handler can never take the server down.
    const on = (ev, fn) => socket.on(ev, (...args) => {
      const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      try { fn(obj(args[0]), ack, args[0]); } catch (err) {
        console.error(`[socket ${ev}]`, err);
        try { ack?.({ ok: false, error: 'Server hiccup — try again.' }); } catch {}
      }
    });
    socket.emit('lobby', this.lobbyInfo());
    on('lobby', (_, ack) => ack?.(this.lobbyInfo()));
    on('join', (d, ack) => this.onJoin(socket, d, ack));
    on('mv', (_, __, raw) => this.onMove(socket, raw));
    on('term:open', (d, ack) => this.onTermOpen(socket, d, ack));
    on('term:answer', (d, ack) => this.onTermAnswer(socket, d, ack));
    on('term:hint', (d, ack) => this.onTermHint(socket, d, ack));
    on('term:start', (d, ack) => this.onTermStart(socket, d, ack));
    on('core:submit', (d, ack) => this.onCore(socket, d, ack));
    on('ability', () => this.onAbility(socket));
    on('use', (d, ack) => { const p = this.playerOf(socket); if (p && ack) this.living.use(p, d, ack); });
    on('throw', (d, ack) => { const p = this.playerOf(socket); if (p && ack) this.living.throwAt(p, d, ack); });
    on('hijack', (d, ack) => { const p = this.playerOf(socket); if (p && ack) this.living.hijack(p, d.id, ack); });
    on('hide', (d, ack) => {
      const p = this.playerOf(socket);
      if (!p || !ack) return;
      if (d.out) { this.living.unhide(p); return ack({ ok: true }); }
      if (this.phase !== 'playing') return ack({ ok: false, error: 'Nothing to hide from yet.' });
      ack(this.living.hide(p, d.id) ? { ok: true } : { ok: false, error: 'Too far.' });
    });
    on('chat', (d) => this.onChat(socket, d));
    on('mark', (d) => this.onPing(socket, d));
    on('screen', () => { socket.join('screen'); socket.emit('screenInit', this.screenInit()); });
    on('admin:auth', (d, ack) => this.onAdminAuth(socket, d, ack));
    on('admin:cmd', (d, ack) => this.onAdminCmd(socket, d, ack));
    on('disconnect', () => this.onDisconnect(socket));
    if (process.env.NEXUS_DEBUG) {
      on('debug:tp', (d) => {
        const p = this.playerOf(socket);
        if (p && Number.isFinite(d.x) && Number.isFinite(d.y)) { p.x = d.x; p.y = d.y; p.budget = 0; p.hidden = -1; socket.emit('pos', [p.x, p.y]); }
        if (p && Number.isFinite(d.bottles)) p.throwables = d.bottles;
      });
    }
  }

  playerOf(socket) {
    const id = socket.data.pid;
    return id ? this.players.get(id) : null;
  }

  onJoin(socket, d, ack) {
    if (!ack) return;
    const prev = this.playerOf(socket);
    let p = typeof d.token === 'string' && this.tokens.has(d.token) ? this.players.get(this.tokens.get(d.token)) : null;
    if (p) {
      if (p.socket && p.socket !== socket) p.socket.disconnect(true);
    } else {
      const name = clean(d.name, 16);
      if (!name) return ack({ ok: false, error: 'Callsign required.' });
      if (this.players.size >= MAX_PLAYERS) {
        // full: make room by retiring whoever has been gone the longest; only refuse if everyone is online
        let old = null;
        for (const q of this.players.values()) if (!q.connected && (!old || q.discAt < old.discAt)) old = q;
        if (!old) return ack({ ok: false, error: 'The server is full.' });
        this.removePlayer(old);
      }
      const cls = typeof d.cls === 'string' && Object.hasOwn(CLASSES, d.cls) ? d.cls : 'runner';
      // squad: join a friend's code, start a new squad, or get matched into an open one
      const sq = obj(d.squad);
      let team;
      if (sq.mode === 'join') {
        const t = this.squadByCode(str(sq.code, 20));
        if (!t) return ack({ ok: false, error: 'No squad with that code. Check it with whoever made it.' });
        if (this.squadMembers(t.id) >= this.squadSize) return ack({ ok: false, error: `Squad ${t.code} is full (${this.squadSize}/${this.squadSize}).` });
        team = t.id;
      } else if (sq.mode === 'create') {
        const t = this.createSquad(!!sq.open);
        if (!t) return ack({ ok: false, error: 'No free squad slots left: join a squad with its code, or pick "Find me a squad".' });
        team = t.id;
      } else team = this.findSquad();
      p = {
        id: this.nextPlayerId++, token: crypto.randomUUID(), name, team, cls,
        x: 0, y: 0, dir: 0, moving: 0, mflags: 0, lastMv: Date.now(), lastChat: 0, lastPing: 0, lastAnswer: 0,
      };
      this.resetPlayerStats(p);
      this.respawn(p, 0);
      if (this.phase === 'countdown') p.stunUntil = this.startAt;
      this.players.set(p.id, p);
      this.tokens.set(p.token, p.id);
      p.isNew = true;
    }
    // one player per connection: joining again from the same tab retires the old body
    if (prev && prev !== p) { this.onDisconnect(socket); socket.leave(`team:${prev.team}`); }
    p.socket = socket;
    p.connected = true;
    p.lastMv = Date.now();
    p.budget = 0;
    socket.data.pid = p.id;
    socket.join(`team:${p.team}`);
    socket.join('players');
    ack({ ok: true, init: this.initPayload(p) });
    this.io.emit('roster', { upsert: [this.playerMeta(p)] });
    if (p.isNew) { p.isNew = false; this.event(`${p.name} joined squad ${this.teams[p.team].name}`, this.teams[p.team].color, 'join'); this.emitScores(); }
  }

  onDisconnect(socket) {
    const p = this.playerOf(socket);
    if (!p || p.socket !== socket) return;
    p.connected = false;
    p.socket = null;
    p.discAt = Date.now();
    this.io.emit('roster', { upsert: [this.playerMeta(p)] });
  }

  onMove(socket, d) {
    const p = this.playerOf(socket);
    if (!p || !Array.isArray(d)) return;
    const now = Date.now();
    const [x, y, dir, flags] = d;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.dir = Number.isFinite(dir) ? dir : p.dir;
    p.mflags = flags | 0;
    p.moving = p.mflags & MOVE_FLAGS.moving ? 1 : 0;
    const elapsed = Math.min(0.5, (now - p.lastMv) / 1000);
    p.lastMv = now;
    if (p.stunUntil > now) return socket.emit('pos', [p.x, p.y]);
    if (p.hidden >= 0) {
      if (Math.hypot(x - p.x, y - p.y) < 3) return;
      this.living.unhide(p);
    }
    const boosted = p.sprintUntil > now - 250;
    const mode = boosted || (p.mflags & MOVE_FLAGS.sprint && p.stamina > 0.02 && !p.winded) ? 'sprint' : p.mflags & MOVE_FLAGS.crouch ? 'crouch' : 'jog';
    const speed = moveSpeed(p.cls, mode) * (boosted ? CLASSES[p.cls].boost || 1 : 1) * (p.drowsy ? 0.55 : 1);
    p.budget = Math.min(speed * 0.7, p.budget + speed * elapsed * 1.3);
    const dd = Math.hypot(x - p.x, y - p.y);
    const staging = this.phase === 'lobby' || this.phase === 'countdown';
    if (dd > p.budget + 10 || (staging && baseIndexAt(this.world, x, y) !== this.teams[p.team].base) || circleHits(this.world, x, y, PLAYER_R - 1) ||
        circleHits(this.world, (x + p.x) / 2, (y + p.y) / 2, PLAYER_R - 2)) {
      return socket.emit('pos', [p.x, p.y]);
    }
    p.budget -= dd;
    p.x = x;
    p.y = y;
  }

  near(p, obj, r) {
    return dist2(p, obj) <= r * r;
  }

  onTermOpen(socket, d, ack) {
    const p = this.playerOf(socket);
    const term = at(this.terminals, d.id);
    if (!p || !term || !ack) return;
    if (!this.near(p, term, INTERACT_R + 1.5 * PX)) return ack({ ok: false, error: 'Out of range.' });
    const team = this.teams[p.team];
    const base = { ok: true, id: term.id, name: term.puzzle.name, type: term.puzzle.type, kind: term.kind, index: term.id };
    if (team.hacked.has(term.id)) return ack({ ...base, status: 'hacked', fragment: team.fragments[term.id], reward: term.puzzle.reward || null });
    if (this.phase !== 'playing') return ack({ ...base, status: 'locked', message: 'Terminal sealed. The hunt has not begun.' });
    const req = term.puzzle.requires;
    if (Number.isInteger(req) && this.terminals[req] && !team.hacked.has(req)) {
      const rt = this.terminals[req];
      return ack({ ...base, status: 'encrypted', message: `ENCRYPTED.\n\nThis terminal only accepts an uplink relayed from\n${rt.puzzle.name.toUpperCase()} (sector ${sectorName(rt.x, rt.y)}).\n\nCrack that one first, then come back.` });
    }
    // a two-key terminal shows its second console on the team's map as soon as it's opened
    if (term.kind === 'pair' && !team.consoles.has(term.id)) { team.consoles.add(term.id); this.emitTeam(team); }
    if (term.puzzle.type === 'glitch') this.living.requestGlitch(team);
    const run = team.run && team.run.id === term.id ? team.run : null;
    ack({
      ...base, status: 'open', prompt: this.promptFor(term, team.id),
      hint: team.hints.has(term.id) ? this.hintFor(term, team.id) : null,
      run: run ? { idx: run.idx, until: run.until } : null, runCdUntil: team.runCdUntil,
      hintCost: p.cls === 'hacker' ? 0 : -SCORE.hint,
      lockUntil: p.locks[term.id]?.until || 0,
      hackedBy: term.hackedBy.length,
    });
  }

  promptFor(term, team) {
    let prompt = term.inst[this.teams[team].variant].prompt;
    term.graffitiIds.forEach((gid, k) => {
      const g = this.graffiti[gid];
      prompt = prompt.replaceAll(k === 0 ? '{sector}' : `{sector${k + 1}}`, sectorName(g.x, g.y));
    });
    const req = this.terminals[term.puzzle.requires];
    return prompt.replaceAll('{req}', req ? req.puzzle.name.toUpperCase() : 'the other terminal');
  }

  hintFor(term, team) {
    const p = term.inst[this.teams[team].variant];
    const npc = p.npc !== undefined ? this.living.npcs[p.npc] : null;
    return String(p.hint || '').replaceAll('{npcSector}', npc ? sectorName(npc.x, npc.y) : '?');
  }

  onTermAnswer(socket, d, ack) {
    const p = this.playerOf(socket);
    const term = at(this.terminals, d.id);
    if (!p || !term || !ack) return;
    const now = Date.now();
    const team = this.teams[p.team];
    if (this.phase !== 'playing') return ack({ ok: false, error: 'Terminal sealed.' });
    if (!this.near(p, term, INTERACT_R + 3 * PX)) return ack({ ok: false, error: 'Signal lost — move closer.' });
    if (team.hacked.has(term.id)) return ack({ ok: true, correct: true, fragment: team.fragments[term.id] });
    const req = term.puzzle.requires;
    if (Number.isInteger(req) && this.terminals[req] && !team.hacked.has(req)) return ack({ ok: false, error: 'Encrypted terminal.' });
    const lock = (p.locks[term.id] ||= { until: 0, fails: 0 });
    if (now < lock.until || now - p.lastAnswer < 600) return ack({ ok: false, error: 'ICE countermeasure active. Wait.', lockUntil: lock.until });
    p.lastAnswer = now;
    if (term.kind !== 'text') return ack({ ok: false, error: 'This terminal has no keyboard. Read the instructions.' });
    const guess = norm(d.answer);
    const correct = (term.inst[team.variant].answers || []).some((a) => norm(a) === guess);
    if (!correct) {
      // each wrong guess doubles the lockout: 3s, 6s, 12s … up to 48s
      lock.fails++;
      lock.until = now + Math.min(48000, 3000 * 2 ** (lock.fails - 1)) * (p.cls === 'hacker' ? 0.5 : 1);
      return ack({ ok: true, correct: false, lockUntil: lock.until });
    }
    ack({ ok: true, correct: true, ...this.solve(team, term, p, now) });
  }

  // a team cracked a terminal (typed answer, two-key, beacon run): letter, points, noise, news
  solve(team, term, p, now = Date.now()) {
    const first = term.hackedBy.length === 0;
    term.hackedBy.push(team.id);
    team.hacked.add(term.id);
    team.knownTerminals.add(term.id);
    const letter = this.passphrase[this.letterOf[team.id][term.id]] ?? '?';
    team.fragments[term.id] = letter;
    team.letters.push(letter);
    const reward = term.inst[team.variant].reward || null;
    if (reward) team.intel.push({ id: -1 - term.id, text: reward, sector: sectorName(term.x, term.y), by: p.name, clue: true, decrypted: true });
    p.hacks++;
    this.addScore(team, SCORE.hack + (first ? SCORE.firstHack : 0), p);
    // the uplink is loud: drones nearby come to look
    this.noise(term.x, term.y, 50 * PX, now);
    this.event(`${team.name} hacked ${term.puzzle.name}${first ? ' — FIRST BLOOD' : ''} (${p.name})`, team.color, 'hack');
    this.io.emit('terminal', { id: term.id, hackedBy: term.hackedBy });
    this.io.to(`team:${team.id}`).emit('fx', { type: 'fragment', x: term.x, y: term.y, letter, by: p.name, index: term.id, first, reward });
    this.emitTeam(team);
    this.emitScores();
    this.living.onHack(team);
    return { fragment: letter, first, reward };
  }

  // beacon relay: start a timed run from the terminal
  onTermStart(socket, d, ack) {
    const p = this.playerOf(socket);
    const term = at(this.terminals, d.id);
    if (!p || !term || !ack) return;
    const now = Date.now(), team = this.teams[p.team];
    if (this.phase !== 'playing') return ack({ ok: false, error: 'Terminal sealed.' });
    if (term.kind !== 'beacons') return ack({ ok: false, error: 'Nothing to start here.' });
    if (!this.near(p, term, INTERACT_R + 3 * PX)) return ack({ ok: false, error: 'Out of range.' });
    if (team.hacked.has(term.id)) return ack({ ok: false, error: 'Already cracked.' });
    if (team.run) return ack({ ok: false, error: 'A run is already on. GO!' });
    if (now < team.runCdUntil) return ack({ ok: false, error: `Beacons recharging: ${Math.ceil((team.runCdUntil - now) / 1000)}s` });
    const rnd = mulberry32((now ^ (team.id + 1) * 97) >>> 0);
    team.run = { id: term.id, beacons: beaconSpots(this.world, term.x, term.y, rnd), idx: 0, until: now + (this.squadMembers(team.id) <= 1 ? RUN_MS_SOLO : RUN_MS) };
    this.noise(team.run.beacons[0].x, team.run.beacons[0].y, 30 * PX, now);
    this.emitTeam(team);
    this.event(`${p.name} started the beacon run`, team.color, 'run', team.id);
    ack({ ok: true, until: team.run.until });
  }

  // two-key consoles and beacon runs are solved by standing in the right places
  tickObjectives(now, dt, active) {
    for (const team of this.teams) {
      if (!team.active) continue;
      const mine = active.filter((q) => q.team === team.id && q.stunUntil <= now);
      // beacon run
      const run = team.run;
      if (run) {
        if (now > run.until) {
          team.run = null; team.runCdUntil = now + RUN_CD;
          this.io.to(`team:${team.id}`).emit('objective', { type: 'runFail' });
          this.emitTeam(team);
        } else {
          const b = run.beacons[run.idx];
          const who = mine.find((q) => dist2(q, b) < BEACON_R * BEACON_R);
          if (who) {
            run.idx++;
            this.noise(b.x, b.y, 30 * PX, now);
            this.io.to(`team:${team.id}`).emit('objective', { type: 'beacon', idx: run.idx, by: who.name, x: b.x, y: b.y });
            if (run.idx >= run.beacons.length) { team.run = null; if (!team.hacked.has(run.id)) this.solve(team, this.terminals[run.id], who, now); }
            else this.emitTeam(team);
          }
        }
      }
      // two-key: someone at the terminal and someone else at its console, together
      for (const id of team.consoles) {
        if (team.hacked.has(id)) continue;
        const term = this.terminals[id], c = term.inst[team.variant].console;
        const a = mine.find((q) => dist2(q, term) < (PAIR_R + 1 * PX) ** 2);
        const b = mine.find((q) => q !== a && dist2(q, c) < PAIR_R * PAIR_R);
        // a squad of one can't stand in two places: they arm the console, then have SOLO_PAIR_MS to reach the terminal
        if (this.squadMembers(team.id) <= 1) {
          const me = mine[0];
          if (me && dist2(me, c) < PAIR_R * PAIR_R) {
            if (!team.soloArm?.[id] || now > team.soloArm[id]) this.io.to(`team:${team.id}`).emit('objective', { type: 'soloArm', id, until: now + SOLO_PAIR_MS });
            (team.soloArm ||= {})[id] = now + SOLO_PAIR_MS;
          }
          if (me && team.soloArm?.[id] > now && dist2(me, term) < (PAIR_R + 1 * PX) ** 2) { team.soloArm[id] = 0; this.solve(team, term, me, now); }
          continue;
        }
        const prev = team.pairT[id] || 0;
        const k = a && b ? prev + dt : 0;
        team.pairT[id] = k;
        if (Math.floor(k * 2) !== Math.floor(prev * 2)) this.io.to(`team:${team.id}`).emit('objective', { type: 'pair', id, k: Math.min(PAIR_HOLD, k), need: PAIR_HOLD });
        if (k >= PAIR_HOLD) { team.pairT[id] = 0; this.solve(team, term, a, now); }
      }
    }
  }

  onTermHint(socket, d, ack) {
    const p = this.playerOf(socket);
    const term = at(this.terminals, d.id);
    if (!p || !term || !ack) return;
    const team = this.teams[p.team];
    if (this.phase !== 'playing') return ack({ ok: false, error: 'Terminal sealed.' });
    if (!this.near(p, term, INTERACT_R + 3 * PX)) return ack({ ok: false, error: 'Out of range.' });
    if (!team.hints.has(term.id)) {
      team.hints.add(term.id);
      if (p.cls !== 'hacker') { this.addScore(team, SCORE.hint, null); this.emitScores(); }
    }
    ack({ ok: true, hint: this.hintFor(term, team.id) });
  }

  onCore(socket, d, ack) {
    const p = this.playerOf(socket);
    if (!p || !ack) return;
    const now = Date.now();
    const team = this.teams[p.team];
    const core = this.world.core;
    if (this.phase !== 'playing') return ack({ ok: false, error: 'The Core is dormant. Wait for the hunt to begin.' });
    if (!this.near(p, core, CORE_INTERACT_R + 2 * PX)) return ack({ ok: false, error: 'Move closer to the Core.' });
    if (team.upload) return ack({ ok: false, error: 'Your upload is already running. Hold the Core!' });
    const min = this.config.coreMinFragments ?? 4;
    if (team.hacked.size < min) return ack({ ok: false, error: `The Core rejects you. Recover at least ${min} letters first.` });
    if (now < team.coreLockUntil) return ack({ ok: false, error: 'Core lockout active.', lockUntil: team.coreLockUntil });
    if (norm(d.code) !== norm(this.passphrase)) {
      team.coreLockUntil = now + (this.config.coreLockoutSeconds ?? 45) * 1000;
      this.emitTeam(team);
      this.event(`${team.name} attempted a Core override… and FAILED`, team.color, 'fail');
      this.living.nexus('coreFail', { name: p.name });
      return ack({ ok: true, correct: false, lockUntil: team.coreLockUntil });
    }
    // the code is right: now the exit has to upload, and the team has to hold the Core while it does
    team.upload = { p: 0, state: 'empty', mine: 0, enemies: 0, by: p.name, stage: 0 };
    ack({ ok: true, correct: true, upload: true, seconds: this.uploadSeconds(team) });
    this.emitTeam(team);
    this.event(`${team.name} IS UPLOADING THE EXIT CODE — hold the Core! (${p.name})`, team.color, 'breach');
    this.io.emit('upload', this.uploadInfo());
    this.living.onUploadStart(team);
  }

  // the code is the same for everyone, so an overheard phrase works, but every letter your squad hasn't cracked
  // adds time to hold the Core (cracking more during the upload speeds it up again)
  uploadSeconds(team) {
    const missing = Math.max(0, this.terminals.length - team.hacked.size);
    return Math.max(10, (this.config.coreUploadSeconds ?? 90) + missing * (this.config.uploadSecondsPerMissingLetter ?? 15));
  }
  uploadInfo() {
    return this.teams.filter((t) => t.upload).map((t) => ({ team: t.id, p: Math.round(t.upload.p * 1000) / 1000, state: t.upload.state, mine: t.upload.mine, enemies: t.upload.enemies }));
  }

  // Uploads run only while the team holds the Core: more of them inside the ring than anyone else.
  tickUploads(now, dt, active) {
    const core = this.world.core, R2 = CORE_ZONE_R * CORE_ZONE_R;
    const inside = active.filter((q) => q.stunUntil <= now && dist2(q, core) < R2);
    let any = false;
    for (const team of this.teams) {
      const u = team.upload;
      if (!u) continue;
      any = true;
      // the upload runs while you outnumber the strongest single rival squad in the ring
      const per = {};
      for (const q of inside) per[q.team] = (per[q.team] || 0) + 1;
      u.mine = per[team.id] || 0;
      u.enemies = Math.max(0, ...Object.entries(per).filter(([t]) => +t !== team.id).map(([, n]) => n));
      u.state = u.mine > 0 && u.mine > u.enemies ? 'running' : u.mine > 0 ? 'contested' : 'empty';
      if (u.state === 'running') u.p = Math.min(1, u.p + dt / this.uploadSeconds(team));
      const stage = Math.floor(u.p * 4);
      if (stage > u.stage && stage < 4) { u.stage = stage; this.living.onUploadStage(team, stage); }
      if (u.p >= 1) { this.winUpload(team, now); return; }
    }
    if (any && now - (this.lastUploadEmit || 0) > 400) { this.lastUploadEmit = now; this.io.emit('upload', this.uploadInfo()); }
    if (any && now - (this.lastSurge || 0) > 6000) { this.lastSurge = now; this.living.surgeToCore(5, now); }
  }

  // the first completed upload ends the night for everyone
  winUpload(team, now) {
    team.breachRank = ++this.breachCount;
    team.breachAt = now;
    const by = team.upload.by;
    this.addScore(team, SCORE.breach[0], null);
    this.io.emit('upload', this.uploadInfo());
    this.event(`${team.name} OPENED THE ARK — the exit code is through!`, team.color, 'breach');
    this.io.emit('breach', { team: team.id, rank: 1, by });
    this.endGame();
  }

  onAbility(socket) {
    const p = this.playerOf(socket);
    const now = Date.now();
    if (!p || now < p.abilityAt || p.stunUntil > now) return;
    if (this.phase === 'countdown') return;
    const c = CLASSES[p.cls];
    p.abilityAt = now + c.cd;
    if (p.cls === 'runner') {
      p.sprintUntil = now + c.dur;
      socket.emit('ability', { type: 'sprint', until: p.sprintUntil, readyAt: p.abilityAt });
    } else if (p.cls === 'engineer') {
      let n = 0;
      for (const s of this.sentinels) {
        if (dist2(s, p) < c.radius ** 2) { this.living.endHijack(s); s.frozenUntil = now + c.dur; s.state = 0; s.path = null; n++; }
      }
      this.living.emp(p.x, p.y, c.radius, now);
      socket.emit('ability', { type: 'emp', readyAt: p.abilityAt, hits: n });
      this.io.emit('fx', { type: 'emp', x: p.x, y: p.y, r: c.radius });
      if (n) this.event(`${p.name} fried ${n} drone${n > 1 ? 's' : ''} with an EMP`, this.teams[p.team].color, 'emp', p.team);
    } else if (p.cls === 'hacker') {
      const team = this.teams[p.team];
      const r2 = c.radius ** 2;
      const terms = this.terminals.filter((t) => dist2(t, p) < r2).map((t) => t.id);
      for (const id of terms) team.knownTerminals.add(id);
      const sigs = this.graffiti.filter((g) => dist2(g, p) < r2).map((g) => g.id);
      const drones = this.sentinels.filter((s) => dist2(s, p) < r2).map((s) => [Math.round(s.x), Math.round(s.y)]);
      socket.emit('ability', { type: 'scan', readyAt: p.abilityAt });
      this.io.to(`team:${team.id}`).emit('scan', { x: p.x, y: p.y, r: c.radius, terminals: terms, signals: sigs, drones, by: p.name });
      this.emitTeam(team);
    }
  }

  onChat(socket, d) {
    const p = this.playerOf(socket);
    const now = Date.now();
    if (!p || now - p.lastChat < 700) return;
    const text = clean(d.text, 140);
    if (!text) return;
    p.lastChat = now;
    const msg = { from: p.name, team: p.team, text, scope: d.scope === 'all' ? 'all' : 'team', t: now };
    if (msg.scope === 'all') this.io.emit('chat', msg);
    else this.io.to(`team:${p.team}`).emit('chat', msg);
  }

  onPing(socket, d) {
    const p = this.playerOf(socket);
    const now = Date.now();
    if (!p || now - p.lastPing < 800 || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
    p.lastPing = now;
    this.io.to(`team:${p.team}`).emit('mark', { x: d.x, y: d.y, by: p.name, kind: clean(d.kind, 10) || 'here' });
  }

  // ---------------------------------------------------------------- admin
  onAdminAuth(socket, d, ack) {
    if (!ack) return;
    const pw = process.env.ADMIN_PASSWORD || this.config.adminPassword || 'nexus-admin';
    const now = Date.now();
    if (now < (socket.data.authLockUntil || 0)) return ack({ ok: false, error: 'Too many attempts. Wait a few seconds.' });
    if (str(d.password) !== pw) {
      socket.data.authFails = (socket.data.authFails || 0) + 1;
      if (socket.data.authFails >= 5) { socket.data.authFails = 0; socket.data.authLockUntil = now + 10000; }
      return ack({ ok: false });
    }
    socket.data.admin = true;
    socket.join('admin');
    ack({ ok: true, config: { durationMinutes: this.durationMs / 60000, sentinels: this.sentinels.length, squadSize: this.squadSize, maxSquads: this.teamCount } });
    this.broadcastAdmin();
  }

  onAdminCmd(socket, d, ack) {
    const reply = ack || (() => {});
    if (!socket.data.admin) return reply({ ok: false, error: 'unauthorized' });
    const a = obj(d.args);
    switch (d.cmd) {
      case 'start': {
        if (this.phase === 'playing' || this.phase === 'countdown') return reply({ ok: false, error: 'Already running' });
        if (this.phase === 'ended') this.reset(this.seed);
        if (fin(a.minutes) > 0) this.durationMs = Math.max(1, Math.min(180, fin(a.minutes))) * 60000;
        const now = Date.now();
        this.phase = 'countdown';
        this.startAt = now + (this.config.countdownSeconds ?? 10) * 1000;
        this.endsAt = this.startAt + this.durationMs;
        for (const p of this.players.values()) {
          this.respawn(p, 0);
          p.stunUntil = this.startAt;
          p.socket?.emit('pos', [p.x, p.y]);
        }
        this.io.emit('phase', this.phaseInfo());
        this.event('LOCKDOWN LIFTING — the hunt begins in moments', '#ff2bd6', 'phase');
        break;
      }
      case 'end': this.endGame(); break;
      case 'prologue': {
        if (a.target === 'all') this.io.emit('prologue');
        else this.io.to('screen').emit('prologue');
        break;
      }
      case 'reset': {
        this.reset(a.newMap ? Math.floor(Math.random() * 1e9) : this.seed);
        this.io.emit('phase', this.phaseInfo());
        break;
      }
      case 'addTime': {
        if (this.phase !== 'playing') return reply({ ok: false, error: 'Not playing' });
        const mins = Math.max(-60, Math.min(120, fin(a.minutes, 5) || 5));
        this.endsAt += mins * 60000;
        this.io.emit('phase', this.phaseInfo());
        this.event(`Time ${mins > 0 ? 'extended' : 'cut'} by ${Math.abs(mins)} minutes`, '#ffe14d', 'phase');
        break;
      }
      case 'broadcast': {
        const text = clean(a.text, 160);
        if (text) this.io.emit('announce', { text, from: 'HQ' });
        break;
      }
      case 'sentinels': {
        if (typeof a.enabled === 'boolean') this.sentinelsEnabled = a.enabled;
        if (Number.isInteger(+a.count) && +a.count >= 0 && +a.count <= 60) this.spawnSentinels(+a.count);
        break;
      }
      case 'kick': {
        const p = this.players.get(+a.id);
        if (p) { p.socket?.emit('kicked'); p.socket?.disconnect(true); this.removePlayer(p); }
        break;
      }
      case 'setTeam': {
        const p = this.players.get(+a.id);
        const t = +a.team;
        if (p && Number.isInteger(t) && this.teams[t]?.active && t !== p.team) this.movePlayer(p, t);
        break;
      }
      // squad tools: an empty squad with a code to hand out, a new name, two half-empty squads joined up
      case 'squadNew': {
        const t = this.createSquad(!!a.open);
        if (!t) return reply({ ok: false, error: 'No free squad slots left.' });
        this.emitScores();
        return reply({ ok: true, name: t.name, code: t.code });
      }
      case 'squadRename': {
        const t = at(this.teams, +a.team);
        const name = clean(a.name, 12).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
        if (!t?.active) return reply({ ok: false, error: 'No such squad' });
        if (!name) return reply({ ok: false, error: 'Letters and digits only' });
        if (this.teams.some((x) => x !== t && x.active && x.name === name)) return reply({ ok: false, error: 'Another squad has that name' });
        t.name = name;
        this.emitScores();
        break;
      }
      case 'squadMerge': {
        const from = at(this.teams, +a.from), to = at(this.teams, +a.to);
        if (!from?.active || !to?.active || from === to) return reply({ ok: false, error: 'Pick two different squads' });
        const movers = [...this.players.values()].filter((p) => p.team === from.id);
        if (this.squadMembers(to.id) + this.squadMembers(from.id) > this.squadSize) return reply({ ok: false, error: `Together they'd be over ${this.squadSize}` });
        for (const p of movers) this.movePlayer(p, to.id);
        if (!from.score && !from.hacked.size) from.active = false;   // an empty squad with nothing earned disappears
        this.event(`Squad ${from.name} joined squad ${to.name}`, to.color, 'join');
        this.emitScores();
        return reply({ ok: true, moved: movers.length });
      }
      case 'drop': {
        if (this.phase !== 'playing') return reply({ ok: false, error: 'Not playing' });
        this.living.drop = null; this.living.spawnDrop(Date.now());
        break;
      }
      case 'purge': {
        if (this.phase !== 'playing') return reply({ ok: false, error: 'Not playing' });
        this.living.purge = null; this.living.nextPurgeAt = 0;
        break;
      }
      case 'lullaby': {
        if (this.phase !== 'playing') return reply({ ok: false, error: 'Not playing' });
        if (!this.living.lullaby) { this.living.nextLullabyAt = Date.now() + 12000; this.living.flags.lullabyWarned = false; }
        break;
      }
      case 'nexus': {
        const text = clean(a.text, 160);
        if (text) this.io.emit('nexus', { text, kind: 'admin' });
        break;
      }
      case 'score': {
        const t = at(this.teams, +a.team);
        if (t) { this.addScore(t, Math.max(-10000, Math.min(10000, fin(a.delta)))); this.emitScores(); }
        break;
      }
      default: return reply({ ok: false, error: 'unknown command' });
    }
    reply({ ok: true });
    this.broadcastAdmin();
  }

  removePlayer(p) {
    this.players.delete(p.id);
    this.tokens.delete(p.token);
    this.io.emit('roster', { remove: [p.id] });
  }

  computeStandings() {
    const teams = this.teams.filter((t) => t.active && (t.score || t.hacked.size || this.squadMembers(t.id))).sort((a, b) => {
      if (a.breachRank && b.breachRank) return a.breachRank - b.breachRank;
      if (a.breachRank) return -1;
      if (b.breachRank) return 1;
      return b.score - a.score || b.hacked.size - a.hacked.size;
    }).map((t) => ({ id: t.id, name: t.name, color: t.color, score: t.score, hacked: t.hacked.size, breachRank: t.breachRank }));
    const players = [...this.players.values()].sort((a, b) => b.score - a.score).slice(0, 5)
      .map((p) => ({ name: p.name, team: p.team, score: p.score, hacks: p.hacks, caught: p.caught }));
    const dawn = teams.some((t) => t.breachRank);
    const st = this.config.story?.setting || {};
    return { teams, players, passphrase: this.passphrase, finale: dawn ? 'dawn' : 'sleep', ending: (dawn ? st.ending : st.endingSleep) || null };
  }

  endGame() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.standings = this.computeStandings();
    this.io.emit('phase', this.phaseInfo());
    this.event(`SIMULATION OVER — ${this.standings.teams[0].name} takes the city`, this.standings.teams[0].color, 'phase');
  }

  // ---------------------------------------------------------------- simulation
  tick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    if (now - (this.lastSquadSweep || 0) > 30000) { this.lastSquadSweep = now; this.sweepSquads(now); }

    if (this.phase === 'countdown' && now >= this.startAt) {
      this.phase = 'playing';
      this.io.emit('phase', this.phaseInfo());
      this.event('THE HUNT IS LIVE. Find the terminals. Breach the Core.', '#22e1ff', 'phase');
      this.living.onPhase('playing');
    } else if (this.phase === 'playing' && now >= this.endsAt) {
      this.endGame();
    }

    for (const p of this.players.values()) {
      if (!p.connected && now - p.discAt > PURGE_AFTER_MS) this.removePlayer(p);
    }

    const playing = this.phase === 'playing';
    const active = [...this.players.values()].filter((p) => p.connected);

    if (playing) {
      for (const c of this.caches) {
        if (!c.active && now >= c.respawnAt) { c.active = true; this.io.emit('cache', { id: c.id, active: 1 }); }
      }
      for (const p of active) {
        if (p.stunUntil > now) continue;
        for (const c of this.caches) {
          if (c.active && Math.abs(c.x - p.x) < 1.3 * PX && Math.abs(c.y - p.y) < 1.3 * PX) {
            c.active = false;
            c.respawnAt = now + 75000;
            p.cachesTaken++;
            if (Math.random() < 0.5) p.throwables = Math.min(5, (p.throwables || 0) + 1);
            p.battery = Math.min(1, p.battery + BATTERY.cell);
            // caches are for battery and bottles; their points are capped so farming them can't outrank cracking terminals
            const ct = this.teams[p.team];
            const pts = Math.min(SCORE.cache, SCORE.cacheCap - (ct.cachePts || 0));
            if (pts > 0) { ct.cachePts = (ct.cachePts || 0) + pts; this.addScore(ct, pts, p); }
            this.io.emit('cache', { id: c.id, active: 0, by: p.id });
            this.scoresDirty = true;
          }
        }
      }
      if (this.scoresDirty && now - (this.lastScoreEmit || 0) > 1000) {
        this.scoresDirty = false; this.lastScoreEmit = now; this.emitScores();
      }
    }

    // Discovery of terminals / resistance intel
    if (playing && now - (this.lastDiscover || 0) > 250) {
      this.lastDiscover = now;
      const r2 = DISCOVER_R * DISCOVER_R;
      for (const p of active) {
        const team = this.teams[p.team];
        let dirty = false;
        for (const t of this.terminals) {
          if (!team.knownTerminals.has(t.id) && dist2(t, p) < r2) {
            team.knownTerminals.add(t.id); dirty = true;
            this.io.to(`team:${team.id}`).emit('discover', { kind: 'terminal', id: t.id, by: p.name, sector: sectorName(t.x, t.y) });
          }
        }
        for (const g of this.graffiti) {
          if (!team.knownGraffiti.has(g.id) && dist2(g, p) < GRAFFITI_R * GRAFFITI_R && lineOfSight(this.world, p.x, p.y, g.x, g.y, 1)) {
            team.knownGraffiti.add(g.id); dirty = true;
            const intel = { id: g.id, text: this.graffitiTextFor(g, team.id), sector: sectorName(g.x, g.y), by: p.name, clue: g.puzzle >= 0 };
            team.intel.push(intel);
            this.io.to(`team:${team.id}`).emit('discover', { kind: 'graffiti', ...intel });
          }
        }
        if (dirty) this.emitTeam(team);
      }
    }

    for (const p of active) {
      const sprinting = p.moving && p.mflags & MOVE_FLAGS.sprint && p.sprintUntil < now && !p.winded;
      const C = CLASSES[p.cls] || {};
      stepStamina(p, sprinting && p.stamina > 0, p.moving, C.regen || STAMINA.regen, C.sprint || STAMINA.drain, dt, now);
      const inBase = baseIndexAt(this.world, p.x, p.y) === this.teams[p.team].base;
      if (inBase) p.battery = Math.min(1, p.battery + dt / BATTERY.baseCharge);
      else if (p.mflags & MOVE_FLAGS.light && playing) p.battery = Math.max(0, p.battery - dt / (C.battery || BATTERY.life));
      p.lit = !!(p.mflags & MOVE_FLAGS.light) && p.battery > 0 && p.hidden < 0;
      // hackers sense terminals nearby: they pop onto the squad's map
      if (C.senseR && playing && now - (p.senseAt || 0) > 1000) {
        p.senseAt = now;
        const team = this.teams[p.team];
        const near = this.terminals.filter((t) => !team.knownTerminals.has(t.id) && dist2(t, p) < C.senseR * C.senseR);
        if (near.length) { for (const t of near) team.knownTerminals.add(t.id); this.emitTeam(team); p.socket?.emit('toast', `Your scanner picked up ${near.map((t) => t.puzzle.name).join(', ')}`); }
      }
      // footsteps: sprinting is loud, jogging carries a little, crouching is silent
      const loud = p.stamina > 0.02 && !p.winded && p.mflags & MOVE_FLAGS.sprint;
      if (playing && p.moving && p.hidden < 0 && !(p.mflags & MOVE_FLAGS.crouch) && p.sprintUntil < now && now - p.lastNoise > 600 && (loud || !C.quiet)) {
        p.lastNoise = now;
        this.noise(p.x, p.y, loud ? HEAR.sprint : HEAR.jog, now);
      }
    }

    this.living.tick(now, dt, active);
    if (playing) { this.tickObjectives(now, dt, active); this.tickUploads(now, dt, active); }
    this.updateSentinels(now, dt, active);
  }

  // Drones within earshot (patrolling or already investigating) fly over to check a sound.
  noise(x, y, r, now) {
    if (this.phase !== 'playing' || !this.sentinelsEnabled) return;
    for (const s of this.sentinels) {
      if (s.state === 1 || s.state === 4 || s.frozenUntil > now) continue;
      if (dist2(s, { x, y }) > r * r) continue;
      this.investigate(s, x, y, now);
    }
  }

  investigate(s, x, y, now) {
    s.state = 3;
    s.invX = x; s.invY = y;
    s.invUntil = now + 14000;
    s.searchUntil = 0;
    s.path = this.bfs(Math.floor(s.x / TILE), Math.floor(s.y / TILE), Math.floor(x / TILE), Math.floor(y / TILE), 20000);
    s.pathI = 0;
  }

  updateSentinels(now, dt, active) {
    const w = this.world;
    const hunting = this.phase === 'playing' && this.sentinelsEnabled;
    for (const s of this.sentinels) {
      if (s.state === 4) { this.living.driveHijacked(s, now, dt); continue; }
      if (s.frozenUntil > now) { s.state = 2; continue; }
      if (s.state === 2) s.state = 0;

      if (s.state === 1 && s.npc !== undefined) { if (hunting) this.living.chaseNpc(s, now, dt); else this.toPatrol(s); continue; }
      if (s.state === 1) {
        const target = this.players.get(s.targetId);
        if (!hunting || !target || !target.connected || target.invulnUntil > now || target.stunUntil > now || target.hidden >= 0 || baseIndexAt(w, target.x, target.y) >= 0) {
          this.toPatrol(s); continue;
        }
        const d = Math.hypot(target.x - s.x, target.y - s.y);
        if (d < SENT.chaseView && lineOfSight(w, s.x, s.y, target.x, target.y, DRONE_EYE)) s.lastSeenAt = now;
        if (now - s.lastSeenAt > SENT.loseMs) {
          // lost them: search the last place they were seen
          this.investigate(s, s.lastX ?? target.x, s.lastY ?? target.y, now);
          continue;
        }
        if (now === s.lastSeenAt) { s.lastX = target.x; s.lastY = target.y; }
        if (d < SENT.capture) { this.capture(target, s, now); this.toPatrol(s); continue; }
        let tx = target.x, ty = target.y;
        if (d > 4 * PX || !lineOfSight(w, s.x, s.y, target.x, target.y, DRONE_EYE)) {
          if (now > s.repathAt || !s.path) {
            s.repathAt = now + 400;
            s.path = this.bfs(Math.floor(s.x / TILE), Math.floor(s.y / TILE), Math.floor(target.x / TILE), Math.floor(target.y / TILE), 6000);
            s.pathI = 0;
          }
          const wp = this.waypoint(s);
          if (wp) { tx = wp[0]; ty = wp[1]; }
        }
        this.steer(s, tx, ty, SENT.chase * dt);
        s.look = Math.atan2(target.y - s.y, target.x - s.x);
        continue;
      }

      if (s.state === 3) {
        // investigating a sound / last sighting: fly there, then sweep the area
        if (now > s.invUntil) { this.toPatrol(s); continue; }
        const wp = this.waypoint(s);
        if (wp) { this.steer(s, wp[0], wp[1], SENT.patrol * 1.5 * dt); s.look = s.heading; }
        else {
          if (!s.searchUntil) s.searchUntil = now + 6000;
          if (now > s.searchUntil) { this.toPatrol(s); continue; }
          s.look += dt * 1.6;
        }
      } else {
        // patrol
        if (!s.path || s.pathI >= s.path.length) {
          s.path = this.patrolPath(s);
          s.pathI = 0;
        }
        const wp = this.waypoint(s);
        if (wp) this.steer(s, wp[0], wp[1], SENT.patrol * dt);
        s.look = s.heading + Math.sin(now / 700 + s.phase) * 0.55;
      }

      if (!hunting) continue;
      for (const p of active) {
        if (p.invulnUntil > now || p.stunUntil > now || p.hidden >= 0 || this.living.escorted(p, now)) continue;
        const dx = p.x - s.x, dy = p.y - s.y;
        if (Math.abs(dx) > SENT.range || Math.abs(dy) > SENT.range) continue;
        const crouch = p.mflags & MOVE_FLAGS.crouch, light = p.lit;
        const range = SENT.range * (this.living.blackoutAt(s.x, s.y, now) ? 0.55 : 1) * (s.state === 3 ? 1.2 : 1) * (p.moving ? 1 : 0.5) * (crouch ? 0.6 : 1) * (light ? 1.25 : 0.8) * (p.drowsy ? 1.3 : 1);
        const d = Math.hypot(dx, dy);
        let seen = d < SENT.close * (p.moving ? 1 : 0.6);
        if (!seen && d < range) {
          let da = Math.atan2(dy, dx) - s.look;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          seen = Math.abs(da) < SENT.cone;
        }
        if (!seen || baseIndexAt(w, p.x, p.y) >= 0 || !lineOfSight(w, s.x, s.y, p.x, p.y, DRONE_EYE)) continue;
        s.state = 1; s.targetId = p.id; s.lastSeenAt = now; s.path = null; s.lastX = p.x; s.lastY = p.y;
        p.socket?.emit('spotted', { id: s.id });
        // radio: nearby drones converge on the sighting
        for (const o of this.sentinels) {
          if (o !== s && (o.state === 0 || o.state === 3) && o.frozenUntil < now && dist2(o, s) < (60 * PX) ** 2) this.investigate(o, p.x, p.y, now);
        }
        break;
      }
    }
  }

  toPatrol(s) {
    s.state = 0; s.targetId = 0; s.path = null; s.npc = undefined;
  }

  capture(p, s, now) {
    const team = this.teams[p.team];
    p.caught++;
    team.caught++;
    this.addScore(team, SCORE.caught, p);
    this.io.emit('fx', { type: 'capture', x: p.x, y: p.y });
    this.respawn(p, 6000);
    p.stunUntil = now + 3500;
    p.battery = Math.max(0, p.battery - 0.4);
    p.socket?.emit('captured', { x: p.x, y: p.y, until: p.stunUntil });
    this.living.onCapture(p);
    this.event(`A sentinel captured ${p.name} — sent back to base`, '#ff4d6d', 'capture', p.team);
    this.emitScores();
  }

  waypoint(s) {
    const w = this.world;
    while (s.path && s.pathI < s.path.length) {
      const k = s.path[s.pathI];
      const x = (k % w.W + 0.5) * TILE, y = (Math.floor(k / w.W) + 0.5) * TILE;
      if (Math.abs(x - s.x) < 5 && Math.abs(y - s.y) < 5) { s.pathI++; continue; }
      return [x, y];
    }
    return null;
  }

  steer(s, tx, ty, step) {
    const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    const m = Math.min(step, d);
    const [nx, ny] = moveCircle(this.world, s.x, s.y, (dx / d) * m, (dy / d) * m, SENT.r);
    if (Math.abs(nx - s.x) + Math.abs(ny - s.y) < m * 0.2) { s.path = null; } // stuck
    s.x = nx; s.y = ny;
    let da = Math.atan2(dy, dx) - s.heading;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    s.heading += da * 0.25;
  }

  patrolPath(s) {
    const w = this.world;
    for (let tries = 0; tries < 4; tries++) {
      let k;
      if (Math.random() < 0.28) {
        const a = Math.random() * Math.PI * 2, r = 27 + Math.random() * 8;
        const tx = Math.round(w.core.tx + Math.cos(a) * r), ty = Math.round(w.core.ty + Math.sin(a) * r);
        k = ty * w.W + tx;
      } else {
        // Prefer destinations within a sensible radius so drones spread over the whole city.
        const sx = s.x / TILE, sy = s.y / TILE;
        for (let i = 0; i < 20; i++) {
          k = pick(w.roadTiles);
          if (Math.hypot((k % w.W) - sx, Math.floor(k / w.W) - sy) < 70) break;
        }
      }
      if (isSolid(w.tiles[k]) || w.tiles[k] === T.BASE) continue;
      const path = this.bfs(Math.floor(s.x / TILE), Math.floor(s.y / TILE), k % w.W, Math.floor(k / w.W));
      if (path && path.length) return path;
    }
    return null;
  }

  bfs(sx, sy, gx, gy, limit = 1e9) {
    const w = this.world, W = w.W, N = W * w.H;
    if (!this._prev) { this._prev = new Int32Array(N); this._q = new Int32Array(N); }
    const prev = this._prev, q = this._q;
    prev.fill(-1);
    if (![sx, sy, gx, gy].every(Number.isInteger) || sx < 0 || sy < 0 || gx < 0 || gy < 0 || sx >= W || gx >= W || sy >= w.H || gy >= w.H) return null;
    const start = sy * W + sx, goal = gy * W + gx;
    let h = 0, t = 0;
    q[t++] = start; prev[start] = start;
    while (h < t && t < limit) {
      const k = q[h++];
      if (k === goal) break;
      for (const n of [k + 1, k - 1, k + W, k - W]) {
        if (prev[n] !== -1) continue;
        const tt = w.tiles[n];
        if (isSolid(tt) || tt === T.BASE) continue;
        prev[n] = k; q[t++] = n;
      }
    }
    if (prev[goal] === -1) return null;
    const path = [];
    for (let k = goal; k !== start; k = prev[k]) path.push(k);
    return path.reverse();
  }

  // ---------------------------------------------------------------- networking
  broadcast() {
    const now = Date.now();
    const active = [];
    for (const p of this.players.values()) if (p.connected) active.push(p);
    const flags = (q) => (q.moving ? 1 : 0) | (q.stunUntil > now ? 2 : 0) | (q.sprintUntil > now || q.mflags & MOVE_FLAGS.sprint ? 4 : 0) | (q.invulnUntil > now ? 8 : 0) | (q.mflags & MOVE_FLAGS.crouch ? 16 : 0) | (q.lit ? 32 : 0) | (q.drowsy ? 64 : 0) | (q.hidden >= 0 ? 128 : 0);
    const R2 = VIEW_R * VIEW_R;
    for (const p of active) {
      const pl = [];
      for (const q of active) {
        if (q !== p && q.team !== p.team && (dist2(p, q) > R2 || q.hidden >= 0)) continue;
        pl.push(q.id, Math.round(q.x), Math.round(q.y), Math.round(q.dir * 100), flags(q));
      }
      const se = [];
      for (const s of this.sentinels) {
        if (dist2(p, s) > R2) continue;
        se.push(s.id, Math.round(s.x), Math.round(s.y), Math.round(s.look * 100), s.state);
      }
      p.socket?.volatile.emit('s', [now, pl, se, p.abilityAt, p.sprintUntil, Math.round(p.stamina * 100), Math.round(p.battery * 100), this.living.npcsNear(p, R2), p.throwables, p.hidden]);
    }
  }

  broadcastScreen() {
    const room = this.io.sockets.adapter.rooms.get('screen');
    if (!room || !room.size) return;
    const now = Date.now();
    const pl = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      pl.push(p.id, Math.round(p.x), Math.round(p.y), p.team, p.stunUntil > now ? 1 : 0);
    }
    const se = [];
    // a hijacked drone is sent as 10 + its new team, so the big screen can paint it in their colour
    for (const s of this.sentinels) se.push(Math.round(s.x), Math.round(s.y), Math.round(s.look * 100), s.state === 4 ? 10 + s.ownerTeam : s.state);
    this.io.to('screen').volatile.emit('ss', [now, pl, se, this.teams.map((t) => [t.score, t.hacked.size, t.breachRank, t.letters.length])]);
  }

  broadcastAdmin() {
    const room = this.io.sockets.adapter.rooms.get('admin');
    if (!room || !room.size) return;
    this.io.to('admin').emit('admin:state', {
      phase: this.phaseInfo(), seed: this.seed, teamCount: this.teamCount,
      sentinels: this.sentinels.length, sentinelsEnabled: this.sentinelsEnabled,
      durationMinutes: this.durationMs / 60000,
      teams: this.teams.map((t) => ({ ...this.teamPublic(t), code: t.code, open: t.open, variant: t.variant, createdAt: t.createdAt || 0, fragments: t.fragments, caught: t.caught })),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, team: p.team, cls: p.cls, connected: p.connected,
        score: p.score, hacks: p.hacks, caught: p.caught, sector: sectorName(p.x, p.y),
      })),
      terminals: this.terminals.map((t) => ({ id: t.id, name: t.puzzle.name, sector: sectorName(t.x, t.y), hackedBy: t.hackedBy, answer: t.inst.map((p, i) => `SET ${i + 1}: ${p.answers?.[0] ?? (t.kind === 'pair' ? 'two-key' : 'beacon run')}`).join(' · ') })),
      passphrase: this.passphrase,
    });
  }
}
