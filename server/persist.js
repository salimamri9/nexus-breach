// Crash safety: the whole match is snapshotted to disk every few seconds (atomic write) and
// restored on boot, so a crash or restart mid-event costs at most a few seconds of progress.
// Players keep their tokens, so their browsers reconnect straight back into the same body.
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 2;   // 2: squads
const SET_KEYS = ['hacked', 'knownTerminals', 'knownGraffiti', 'hints', 'echoes', 'consoles'];
const TEAM_KEYS = ['active', 'code', 'open', 'byMatch', 'createdAt', 'base', 'variant', 'score', 'cachePts', 'fragments', 'letters', 'intel', 'breachRank', 'breachAt', 'coreLockUntil', 'caught', 'saidEight', 'upload', 'runCdUntil'];
const PLAYER_KEYS = ['id', 'token', 'name', 'team', 'cls', 'x', 'y', 'dir', 'score', 'hacks', 'cachesTaken', 'caught', 'abilityAt',
  'stamina', 'battery', 'throwables', 'hijackAt', 'locks'];
const LIVING_KEYS = ['drop', 'purge', 'flags', 'nextDropAt', 'nextPurgeAt', 'nextTauntAt', 'nextLullabyAt', 'lullaby', 'playStart', 'coreHitUntil'];
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export class Persist {
  constructor(game, file) {
    this.game = game;
    this.file = file;
    this.tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  snapshot() {
    const g = this.game, L = g.living;
    return {
      v: VERSION, savedAt: Date.now(),
      seed: g.seed, teamCount: g.teamCount, durationMs: g.durationMs, terminals: g.terminals.length, passphrase: g.passphrase,
      phase: g.phase, startAt: g.startAt, endsAt: g.endsAt, breachCount: g.breachCount, standings: g.standings,
      events: g.events, sentinelsEnabled: g.sentinelsEnabled, sentinelCount: g.sentinels.length, nextPlayerId: g.nextPlayerId, letterOf: g.letterOf,
      teams: g.teams.map((t) => ({ ...pickKeys(t, TEAM_KEYS), ...Object.fromEntries(SET_KEYS.map((k) => [k, [...(t[k] || [])]])) })),
      hackedBy: g.terminals.map((t) => t.hackedBy),
      caches: g.caches.map((c) => [c.active ? 1 : 0, c.respawnAt]),
      players: [...g.players.values()].map((p) => pickKeys(p, PLAYER_KEYS)),
      living: {
        ...pickKeys(L, LIVING_KEYS), junoDone: [...L.junoDone],
        npcs: L.npcs.map((n) => [n.state, n.x, n.y, n.backAt, [...n.told]]),
        relays: L.relays.map((r) => [r.offUntil, r.cdUntil]),
        cams: L.cams.map((c) => c.offUntil),
        cars: L.cars.map((c) => [c.until, c.cdUntil]),
      },
    };
  }

  save() {
    try {
      fs.writeFileSync(this.tmp, JSON.stringify(this.snapshot()));
      fs.renameSync(this.tmp, this.file);   // atomic: a crash mid-write never leaves a torn file
    } catch (err) {
      console.error('[persist] save failed:', err.message);
    }
  }

  // Returns true if a saved match was restored.
  load() {
    let s;
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (err) {
      if (err.code !== 'ENOENT') console.error('[persist] could not read snapshot, starting fresh:', err.message);
      return false;
    }
    const g = this.game, L = g.living;
    if (s.v !== VERSION || !Array.isArray(s.letterOf?.[0]) || s.terminals !== g.config.terminals.length || s.passphrase !== String(g.config.passphrase || 'UPRISING').toUpperCase()) {
      console.warn('[persist] snapshot is from a different config — starting fresh');
      return false;
    }
    try {
      g.durationMs = s.durationMs;
      g.reset(s.seed);
      Object.assign(g, pickKeys(s, ['phase', 'startAt', 'endsAt', 'breachCount', 'standings', 'events', 'sentinelsEnabled', 'nextPlayerId', 'letterOf']));
      if (s.sentinelCount !== g.sentinels.length) g.spawnSentinels(s.sentinelCount);
      s.teams.forEach((st, i) => {
        const t = g.teams[i];
        if (!t) return;
        Object.assign(t, pickKeys(st, TEAM_KEYS));
        for (const k of SET_KEYS) t[k] = new Set(st[k] || []);
      });
      s.hackedBy.forEach((h, i) => { if (g.terminals[i]) g.terminals[i].hackedBy = h; });
      s.caches.forEach(([a, r], i) => { if (g.caches[i]) { g.caches[i].active = !!a; g.caches[i].respawnAt = r; } });
      const now = Date.now();
      for (const sp of s.players) {
        if (sp.team >= g.teamCount || !g.teams[sp.team]?.active) continue;
        const p = { ...sp, moving: 0, mflags: 0, lastMv: now, lastChat: 0, lastPing: 0, lastAnswer: 0, sprintUntil: 0, stunUntil: 0,
          invulnUntil: now + 5000, lastNoise: 0, hidden: -1, drowsy: false, budget: 0, connected: false, socket: null, discAt: now };
        p.locks ||= {};
        g.players.set(p.id, p);
        g.tokens.set(p.token, p.id);
      }
      Object.assign(L, pickKeys(s.living, LIVING_KEYS));
      L.junoDone = new Set(s.living.junoDone);
      s.living.npcs.forEach(([state, x, y, backAt, told], i) => { const n = L.npcs[i]; if (n) Object.assign(n, { state: state === 1 ? 0 : state, x, y, backAt, told: new Set(told), path: null }); });
      s.living.relays.forEach(([o, c], i) => { if (L.relays[i]) Object.assign(L.relays[i], { offUntil: o, cdUntil: c }); });
      s.living.cams.forEach((o, i) => { if (L.cams[i]) L.cams[i].offUntil = o; });
      s.living.cars.forEach(([u, c], i) => { if (L.cars[i]) Object.assign(L.cars[i], { until: u, cdUntil: c }); });
      const ago = Math.round((now - s.savedAt) / 1000);
      console.log(`[persist] restored match (phase ${g.phase}, ${g.players.size} players, saved ${ago}s ago)`);
      return true;
    } catch (err) {
      console.error('[persist] snapshot restore failed, starting fresh:', err);
      g.reset(s.seed);
      g.players.clear(); g.tokens.clear();
      return false;
    }
  }
}
