import {
  generateWorld, PX, PLAYER_R, CLASSES, moveSpeed, stepStamina, STAMINA_RULES, moveCircle, INTERACT_R, CORE_INTERACT_R, baseIndexAt,
} from '/shared/world.js';
import { View2D, detectQuality } from './game2d/view2d.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { playPrologue as runPrologue, prologuePlaying } from './prologue.js';
import { LivingClient } from './living.js';

const PAL = { cyan: '#22e1ff', magenta: '#ff2bd6', red: '#ff2a4a', amber: '#ffb02e', green: '#3dff8a' };

const touch = matchMedia('(pointer: coarse)').matches;
if (touch) document.body.classList.add('touch');

const S = {
  me: null, world: null, teams: [], teamColors: [], roster: new Map(), team: null, terminals: [], caches: [],
  phase: 'lobby', startAt: 0, endsAt: 0, others: new Map(), sentinels: new Map(), graffitiText: new Map(),
  pings: [], scanDrones: [], signals: new Set(), clockOffset: 0, abilityReadyAt: 0, sprintUntil: 0,
  meFlags: 0, target: null, passLen: 8, coreMin: 4,
};

const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000 });
const sfx = new Sfx();
const canvas = document.getElementById('game');
const quality = detectQuality();
document.querySelectorAll('#quality-list .card').forEach((b) => b.classList.toggle('sel', b.dataset.q === quality.level));
const renderer = new View2D(canvas, quality);
const loadBar = document.getElementById('load-bar');
const assetsReady = renderer.load((f) => { if (loadBar) loadBar.style.width = `${Math.round(f * 100)}%`; })
  .then(() => document.getElementById('loading')?.classList.add('done'));

const G = {
  S, socket, sfx, renderer,
  serverNow: () => Date.now() + S.clockOffset,
  interact, useAbility,
  ping(x, y) {
    socket.emit('mark', { x, y });
  },
};
G.input = new Input(canvas, {
  interact: () => interact(),
  interactUp: () => { S.hold = null; },
  throw: () => throwBottle(),
  ability: () => useAbility(),
  map: () => hud.toggleMap(),
  intel: () => hud.togglePanel('intel'),
  help: () => hud.togglePanel('help'),
  scores: (on) => hud.togglePanel('scores', on),
  chat: (scope) => hud.openChat(scope),
  ping: () => {
    if (!S.me) return;
    const p = renderer.aimPoint();
    if (p) G.ping(p.x, p.y);
  },
  light: () => { S.me && (S.me.light = !S.me.light); sfx.play('click'); },
  crouch: () => { S.me && (S.me.crouch = !S.me.crouch); },
  lockChange: (locked) => document.body.classList.toggle('locked', locked),
  escape: () => { hud.closeAll(); hud.closeChat(); G.live?.closeReader(); },
});
const hud = new Hud(G);
G.hud = hud;
const live = new LivingClient(G);
G.live = live;
renderer.live = live;
renderer.sfx = sfx;
const syncToggles = () => {
  document.getElementById('btn-light')?.classList.toggle('on', !!S.me?.light);
  document.getElementById('btn-crouch')?.classList.toggle('on', !!S.me?.crouch);
};
for (const [id, key] of [['btn-light', 'light'], ['btn-crouch', 'crouch']]) {
  document.getElementById(id)?.addEventListener('touchstart', (e) => { e.preventDefault(); if (S.me) S.me[key] = !S.me[key]; syncToggles(); }, { passive: false });
}
setInterval(() => {
  syncToggles();
  const hint = document.getElementById('click-to-look');
  hint?.classList.add('hidden');
}, 250);
if (new URLSearchParams(location.search).has('debug')) window.__G = G;
S.onThunder = () => sfx.play('thunder');

// ---------------------------------------------------------------- join flow
let token = null;
let profile = null;
try { token = localStorage.getItem('nexus_token'); profile = JSON.parse(localStorage.getItem('nexus_join') || 'null'); } catch {}
let lobby = null;
let started = false;
let introShown = false;

// the prologue brings its own narration and score: the game's music and rain step aside
function playPrologue(opts = {}) {
  if (prologuePlaying()) return;
  const back = sfx.scene;
  sfx.setScene('cinematic', 0.5);
  return runPrologue({ ...opts, onDone: () => { sfx.setScene(back === 'cinematic' ? 'menu' : back); opts.onDone?.(); } });
}

function showIntro(quick) {
  if (introShown) return;
  introShown = true;
  let seen = false;
  try { seen = localStorage.getItem('nexus_prologue_seen') === '1'; } catch {}
  if (seen) { hud.runIntro(lobby, (params) => join(params), quick); return; }
  // first visit: one click (unlocks audio), then the prologue, then the boot sequence
  const gate = document.createElement('div');
  gate.className = 'pro-gate';
  gate.innerHTML = '<div>NEXUS BREACH</div><small>click to begin</small>';
  document.body.append(gate);
  gate.addEventListener('click', () => {
    gate.remove();
    try { localStorage.setItem('nexus_prologue_seen', '1'); } catch {}
    playPrologue({ onDone: () => hud.runIntro(lobby, (params) => join(params), quick) });
  }, { once: true });
}
document.getElementById('watch-prologue')?.addEventListener('click', () => playPrologue());
socket.on('prologue', () => { G.input.unlock(); playPrologue(); });

function join(params) {
  sfx.init();
  socket.emit('join', { ...params, token }, (res) => {
    if (!res?.ok) { hud.joinError(res?.error || 'Connection refused.'); return; }
    token = res.init.you.token;
    profile = { name: res.init.you.name, team: res.init.you.team, cls: res.init.you.cls };
    try { localStorage.setItem('nexus_token', token); localStorage.setItem('nexus_join', JSON.stringify(profile)); } catch {}
    start(res.init);
    const t = res.init.teams[res.init.you.team], code = res.init.team.code;
    if (params.squad?.mode === 'create') hud.announce(`SQUAD ${t.name}`, `Share your code: ${code}`, t.color);
    else hud.toast(`You're in squad ${t.name} (${t.size || 1}/4). Code: ${code}`, 6000);
  });
}

socket.on('lobby', (info) => {
  lobby = info;
});

socket.on('connect', () => {
  document.getElementById('conn-status').classList.add('hidden');
  if (started && token) {
    socket.emit('join', { token, ...profile }, (res) => {
      if (res?.ok) { token = res.init.you.token; try { localStorage.setItem('nexus_token', token); } catch {} applyInit(res.init); }
    });
  } else if (!started && token && profile) {
    // Returning player (page refresh / phone woke up): skip the intro.
    socket.emit('join', { token, ...profile }, (res) => {
      if (res?.ok) start(res.init);
      else showIntro(false);
    });
  } else {
    showIntro(false);
  }
});
socket.on('disconnect', () => { if (started) document.getElementById('conn-status').classList.remove('hidden'); });
socket.on('kicked', () => {
  try { localStorage.removeItem('nexus_token'); } catch {}
  token = null;
  hud.announce('DISCONNECTED BY HQ', null, PAL.red);
});

async function start(init) {
  await assetsReady;
  applyInit(init);
  hud.hideIntro();
  if (!started) {
    started = true;
    sfx.setScene(S.phase === 'ended' ? 'end' : 'game');
    document.addEventListener('pointerdown', () => sfx.init(), { once: true });
    requestAnimationFrame(loop);
    runTutorial();
    renderer.swoop(4200);
  }
}

function applyInit(init) {
  S.clockOffset = init.serverNow - Date.now();
  const same = S.world && S.world.seed === init.world.seed && S.world.bases.length === init.world.bases;
  if (!same) S.world = generateWorld(init.world.seed, init.world.bases, init.world.counts);
  S.teams = init.teams;
  S.teamColors = init.teams.map((t) => t.color);
  S.roster = new Map(init.roster.map((r) => [r.id, r]));
  const keepPos = S.me && same && S.me.id === init.you.id;
  S.me = { ...init.you, x: keepPos ? S.me.x : init.you.x, y: keepPos ? S.me.y : init.you.y, dir: S.me?.dir || 0, moving: false, light: S.me?.light ?? true, crouch: false, speed: 0 };
  S.team = init.team;
  S.terminals = init.terminals;
  S.caches = init.caches;
  S.graffitiText = new Map(init.graffitiText);
  S.passLen = init.passLen;
  S.coreMin = init.coreMin;
  S.uploads = init.uploads || [];
  renderer.setUploads(S.uploads);
  hud.renderUploads(S.uploads);
  live.applyInit(init.live);
  syncObjectives();
  S.others.clear();
  S.sentinels.clear();
  S.signals.clear();
  setPhase(init.phase, true);
  // bases are shared by several squads: yours glows in your colour, the others stay neutral
  const myBase = S.teams[S.me.team]?.base;
  S.baseColors = S.world.bases.map((_, i) => (i === myBase ? S.teamColors[S.me.team] : '#6b7894'));
  if (!same || !renderer.world || S.baseKey !== `${myBase}${S.baseColors[myBase]}`) {
    S.baseKey = `${myBase}${S.baseColors[myBase]}`;
    renderer.setWorld(S.world, S.teamColors, S.baseColors);
  }
  for (const [id, text] of S.graffitiText) renderer.setGraffiti(id, text);
  hud.setup(!same);
  if (!same) for (const e of init.events) hud.feed(e);
}

function setPhase(p, silent) {
  const prev = S.phase;
  S.clockOffset = p.serverNow ? p.serverNow - Date.now() : S.clockOffset;
  S.phase = p.phase;
  S.startAt = p.startAt;
  S.endsAt = p.endsAt;
  document.getElementById('countdown').innerHTML = '';
  if (started && sfx.scene !== 'cinematic') sfx.setScene(p.phase === 'ended' ? 'end' : 'game');
  if (p.phase === 'ended') {
    hud.closeAll();
    document.getElementById('announce').innerHTML = '';
    // the ending plays out in the city before the scores appear
    if (!silent && prev !== 'ended' && p.standings?.finale) renderer.playFinale(p.standings.finale, () => hud.showEnd(p.standings));
    else hud.showEnd(p.standings);
  }
  else document.getElementById('endscreen').classList.add('hidden');
  if (silent || prev === p.phase) return;
  if (p.phase === 'countdown') { hud.closeAll(); hud.announce('LOCKDOWN LIFTING', 'Return to base · the hunt begins shortly', PAL.magenta); }
  if (p.phase === 'playing') {
    hud.cdShown = 0;
    sfx.play('go');
    renderer.shake(10);
    hud.announce('THE HUNT IS LIVE', 'Find the terminals · Breach the Core', PAL.cyan);
    renderer.swoop(3200);
  }
  if (p.phase === 'lobby') hud.announce('CITY RESET', 'New simulation loading…', PAL.amber);
}

// ---------------------------------------------------------------- network events
socket.on('init', (init) => applyInit(init));

socket.on('s', ([now, pl, se, abilityAt, sprintUntil, stamina, battery, npcs, throwables, hidden]) => {
  if (!S.me) return;
  live.readNpcs(npcs);
  if (throwables !== undefined) { S.me.throwables = throwables; S.me.hidden = hidden; }
  if (stamina !== undefined) { S.me.stamina = stamina / 100; S.me.battery = battery / 100; if (S.me.stamina <= 0.02) S.me.winded = true; }
  const off = now - Date.now();
  S.clockOffset += (off - S.clockOffset) * 0.1;
  S.abilityReadyAt = abilityAt;
  S.sprintUntil = sprintUntil;
  const seen = new Set();
  for (let i = 0; i < pl.length; i += 5) {
    const id = pl[i], x = pl[i + 1], y = pl[i + 2], dir = pl[i + 3] / 100, f = pl[i + 4];
    if (id === S.me.id) { S.meFlags = f; continue; }
    seen.add(id);
    let o = S.others.get(id);
    if (!o) { o = { id, x, y, dir, walk: 0 }; S.others.set(id, o); }
    o.tx = x; o.ty = y; o.tdir = dir;
    o.moving = !!(f & 1); o.stunned = !!(f & 2); o.sprint = !!(f & 4); o.invuln = !!(f & 8);
    o.crouch = !!(f & 16); o.light = !!(f & 32); o.drowsy = !!(f & 64); o.hidden = !!(f & 128);
    if (Math.hypot(o.x - x, o.y - y) > 300) { o.x = x; o.y = y; }
  }
  for (const id of S.others.keys()) if (!seen.has(id)) S.others.delete(id);
  const sseen = new Set();
  for (let i = 0; i < se.length; i += 5) {
    const id = se[i];
    sseen.add(id);
    let s = S.sentinels.get(id);
    if (!s) { s = { id, sentinel: true, x: se[i + 1], y: se[i + 2], look: se[i + 3] / 100 }; S.sentinels.set(id, s); }
    s.tx = se[i + 1]; s.ty = se[i + 2]; s.tlook = se[i + 3] / 100; s.state = se[i + 4];
  }
  for (const id of S.sentinels.keys()) if (!sseen.has(id)) S.sentinels.delete(id);
});

socket.on('pos', ([x, y]) => { if (S.me) { S.me.x = x; S.me.y = y; } });

socket.on('roster', (d) => {
  for (const r of d.upsert || []) S.roster.set(r.id, r);
  for (const id of d.remove || []) { S.roster.delete(id); S.others.delete(id); }
  if (!document.getElementById('panel-scores').classList.contains('hidden')) hud.renderScores();
});

// two-key consoles and the live beacon of a run, as markers in the city and on the map
function syncObjectives() {
  const t = S.team, list = [];
  for (const [id, x, y] of t?.consoles || []) if (!t.hacked.includes(id)) list.push({ key: `c${id}`, kind: 'console', x, y, color: '#ffb02e', label: 'second console' });
  if (t?.run) { const b = t.run.beacons[t.run.idx]; if (b) list.push({ key: `b${t.run.id}`, kind: 'beacon', x: b.x, y: b.y, color: '#3dff8a', label: `beacon ${t.run.idx + 1}/3` }); }
  S.objectives = list;
  renderer.setObjectives(list);
}

socket.on('team', (t) => {
  const before = S.team?.hacked.length || 0;
  S.team = t;
  hud.renderTeam();
  syncObjectives();
  hud.renderTeam();
  if (t.hacked.length > before) renderer.shake(4);
});

socket.on('toast', (text) => hud.toast(String(text), 4500));
socket.on('scores', (teams) => {
  for (const t of teams) Object.assign(S.teams[t.id] || {}, t);
  hud.renderTeam();
});

// progress on the stand-in-the-right-place challenges
socket.on('objective', (o) => {
  if (!S.me) return;
  if (o.type === 'pair') { S.pair = { id: o.id, k: o.k, need: o.need, at: performance.now() }; if (o.k > 0) sfx.play('type'); }
  else if (o.type === 'beacon') {
    renderer.ring(o.x, o.y, 120, PAL.green, 1); renderer.burst(o.x, o.y, PAL.green, 30, 220, 0.8);
    sfx.play('success');
    hud.toast(o.idx >= 3 ? `${o.by} lit the last beacon!` : `${o.by} lit beacon ${o.idx}/3. Next one is on your map: GO!`);
  } else if (o.type === 'runFail') { sfx.play('fail'); hud.toast('The beacon run timed out. The array needs 20 seconds to recharge.', 4000); }
});

// Core uploads in progress (any team)
socket.on('upload', (list) => { S.uploads = list; renderer.setUploads(list); hud.renderUploads(list); });

socket.on('terminal', ({ id, hackedBy }) => { if (S.terminals[id]) S.terminals[id].hackedBy = hackedBy; });

socket.on('cache', ({ id, active, by }) => {
  S.caches[id] = active;
  if (by === S.me?.id) {
    const c = S.world.caches[id];
    sfx.play('pickup');
    renderer.burst(c.x, c.y, '#ffe14d', 14, 120, 0.6);
    renderer.floatText(c.x, c.y - 20, '+10 · +25% battery', '#ffe14d', 1.4);
  }
});

socket.on('ev', (e) => hud.feed(e));
socket.on('phase', (p) => setPhase(p));

socket.on('discover', (d) => {
  if (!S.me) return;
  sfx.play('discover');
  if (d.kind === 'terminal') {
    hud.toast(`${d.by === S.me.name ? 'You' : d.by} located a terminal in sector ${d.sector}`);
  } else {
    S.graffitiText.set(d.id, d.text);
    renderer.setGraffiti(d.id, d.text);
    const g = S.world.graffiti[d.id];
    if (d.clue) {
      hud.announce('INTEL RECOVERED', `“${d.text}” · sector ${d.sector}`, PAL.amber);
      renderer.ring(g.x, g.y, 120, PAL.amber, 1.2);
    } else {
      hud.toast(`Resistance message in ${d.sector}: “${d.text}”`, 4500);
    }
  }
});

socket.on('fx', (f) => {
  if (!S.me) return;
  if (f.type === 'emp') {
    renderer.ring(f.x, f.y, f.r, '#5ab4ff', 0.7, 8);
    renderer.burst(f.x, f.y, '#8fd3ff', 40, 380, 0.6);
    if (Math.hypot(f.x - S.me.x, f.y - S.me.y) < 700) { renderer.shake(8); sfx.play('emp'); }
  } else if (f.type === 'capture') {
    renderer.burst(f.x, f.y, '#ff2a4a', 30, 260, 0.8, 3);
    renderer.ring(f.x, f.y, 90, '#ff2a4a', 0.6);
  } else if (f.type === 'fragment') {
    renderer.floatText(f.x, f.y - 50, f.letter, PAL.green, 2.5, 46);
    renderer.ring(f.x, f.y, 160, PAL.green, 1);
    renderer.burst(f.x, f.y, PAL.green, 40, 260, 1);
    if (f.by !== S.me.name) hud.toast(`${f.by} recovered fragment “${f.letter}”`);
    else if (hud.term?.id !== f.index) { hud.toast(`Fragment “${f.letter}” secured!${f.reward ? ` ${f.reward}` : ''}`, f.reward ? 7000 : 3500); sfx.play('success'); }
  }
});

let alertTimer = 0;
socket.on('spotted', () => {
  sfx.play('alarm');
  renderer.shake(5);
  hud.alert(true);
  S.alertUntil = performance.now() + 2600;
  hud.toast('SPOTTED! Break line of sight or get back to base.', 2200);
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => hud.alert(false), 2600);
});

socket.on('captured', ({ x, y }) => {
  hud.alert(false);
  hud.closeAll();
  sfx.play('capture');
  hud.glitch();
  renderer.glitch();
  renderer.shake(16);
  S.me.x = x; S.me.y = y;
  hud.announce('CAPTURED', 'Rebooting at base…  −40 pts · battery drained', PAL.red);
});

socket.on('ability', (a) => {
  S.abilityReadyAt = a.readyAt;
  hud.abWasUsed = true;
  if (a.type === 'sprint') { S.sprintUntil = a.until; sfx.play('sprint'); renderer.burst(S.me.x, S.me.y, '#ffffff', 18); }
  else if (a.type === 'emp') hud.toast(a.hits ? `EMP hit ${a.hits} drone${a.hits > 1 ? 's' : ''}` : 'EMP fired. No drones in range.');
  else if (a.type === 'scan') sfx.play('scan');
});

socket.on('scan', (d) => {
  renderer.ring(d.x, d.y, d.r, PAL.cyan, 1.4, 6);
  const now = performance.now();
  for (const [x, y] of d.drones) S.scanDrones.push({ x, y, t: now });
  for (const id of d.signals) S.signals.add(id);
  if (d.by !== S.me.name) sfx.play('scan');
  hud.toast(`${d.by === S.me.name ? 'Scan' : d.by + '’s scan'}: ${d.terminals.length} terminal${d.terminals.length === 1 ? '' : 's'}, ${d.signals.length} signal${d.signals.length === 1 ? '' : 's'}, ${d.drones.length} drone${d.drones.length === 1 ? '' : 's'}`, 4000);
});

socket.on('breach', ({ team, rank, by }) => {
  const t = S.teams[team];
  const ours = team === S.me.team;
  sfx.play('breach');
  renderer.shake(ours ? 22 : 8);
  document.body.classList.remove('flash-breach');
  void document.body.offsetWidth;
  if (ours) document.body.classList.add('flash-breach');
  hud.announce(ours ? 'THE ARK IS OPEN' : `${t.name} OPENED THE ARK`, ours ? 'Your cell uploaded the exit code. You won the night.' : 'Their upload went through. The night is over.', t.color);
});

socket.on('chat', (m) => { hud.chat(m); sfx.play('chat'); renderer.say(m.from, m.text); });
socket.on('mark', (p) => {
  if (!S.me) return;
  S.pings.push({ ...p, t: performance.now() });
  renderer.ping(p.x, p.y, p.by, S.teamColors[S.me.team]);
  sfx.play('ping');
});
socket.on('announce', (a) => hud.announce(a.text, 'HQ BROADCAST', PAL.amber));

// ---------------------------------------------------------------- actions
function interact() {
  if (live.readerOpen) { live.closeReader(); return; }
  const t = S.target;
  if (!t) return;
  sfx.init();
  if (t.kind === 'terminal') socket.emit('term:open', { id: t.id }, (res) => hud.openTerminal(res));
  else if (t.kind === 'core') hud.openCore();
  else if (t.kind === 'hijack') S.hold = { t, start: performance.now(), ms: 1200 };
  else if (t.kind === 'hide') {
    socket.emit('hide', { id: t.id }, (res) => {
      if (!res?.ok) { hud.toast(res?.error || 'Too far.'); return; }
      sfx.play('tarp');
      hud.toast('Hidden under the tarp. Drones and cameras can\'t see you. Move to come out.', 3500);
    });
  } else live.use(t);
}

// left click: lob a bottle where you aim; it shatters and drones go to look
function throwBottle() {
  if (!S.me || S.phase !== 'playing') return;
  const p = renderer.aimPoint();
  if (!p) return;
  sfx.init();
  socket.emit('throw', { x: p.x, y: p.y }, (res) => {
    if (!res?.ok) { if (res?.error) hud.toast(res.error); return; }
    S.me.throwables = res.left;
    sfx.play('whoosh');
  });
}

// hold E behind a drone to rewire it
function tickHold(now) {
  const h = S.hold, ring = document.getElementById('hold-ring');
  if (!h || S.target?.kind !== 'hijack' || S.target.id !== h.t.id) { S.hold = null; ring?.classList.add('hidden'); return; }
  const k = (now - h.start) / h.ms;
  if (ring) { ring.classList.remove('hidden'); ring.style.setProperty('--k', String(Math.min(1, k))); }
  if (k >= 1) {
    S.hold = null;
    ring?.classList.add('hidden');
    socket.emit('hijack', { id: h.t.id }, (res) => {
      if (!res?.ok) { hud.toast(res?.error || 'It slipped away.'); sfx.play('error'); return; }
      sfx.play('rewire');
      hud.announce('DRONE REWIRED', 'It follows you for 25s · other drones look straight past your cell near it', '#3dff8a');
    });
  }
}

function useAbility() {
  sfx.init();
  if (G.serverNow() < S.abilityReadyAt) { hud.toast(`${CLASSES[S.me.cls].ability} recharging`); return; }
  socket.emit('ability');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let lastSend = 0, lastSent = '';
let lastExplore = 0;
let fpsFrames = 0, fpsT = 0;

function loop(ts) {
  const dt = Math.min(0.25, (ts - last) / 1000); // movement runs in substeps, so low FPS doesn't mean slow motion
  last = ts;
  fpsFrames++;
  if (ts - fpsT > 1000) { document.getElementById('fps').textContent = `${Math.round((fpsFrames * 1000) / (ts - fpsT))} FPS · ${quality.level}${renderer.engine.scale < 1 ? ` · ${Math.round(renderer.engine.scale * 100)}% res` : ''}`; fpsFrames = 0; fpsT = ts;
    if (renderer.engine.struggling && quality.level !== 'low' && !G.suggestedLow) {
      G.suggestedLow = true;
      const lower = quality.level === 'high' ? 'medium' : 'low';
      try { localStorage.setItem('nexus_quality', lower); } catch {}
      hud.toast(`Low frame rate: graphics set to ${lower.toUpperCase()}. Press F5 to apply (you keep your squad and score).`, 9000);
    }
  }
  update(dt, ts);
  renderer.frame(S, dt, ts, () => sfx.play('thunder'));
  hud.update(ts);
  requestAnimationFrame(loop);
}

function angLerp(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

function update(dt, now) {
  const me = S.me, w = S.world;
  if (!me || !w) return;
  const snow = G.serverNow();
  const stunned = !!(S.meFlags & 2);
  renderer.zoomBy(G.input.consumeZoom());
  renderer.mouse.x = G.input.mouseX; renderer.mouse.y = G.input.mouseY;

  const mv = G.input.move();
  const moving = !stunned && mv.mag > 0;
  const boosted = snow < S.sprintUntil;
  if (me.stamina === undefined) { me.stamina = 1; me.battery = 1; }
  const wantSprint = G.input.sprinting();
  if (wantSprint && me.crouch && mv.mag > 0) me.crouch = false;   // sprinting stands you up
  const sprinting = moving && !me.crouch && (boosted || (wantSprint && me.stamina > 0.02 && !me.winded));
  // predict stamina between server updates (server is authoritative)
  const C = CLASSES[me.cls] || {};
  if (!boosted) stepStamina(me, sprinting, moving, C.regen || 8, C.sprint || 6, dt, now);
  if (wantSprint && moving && me.winded && now - (S.staminaToast || 0) > 5000) { S.staminaToast = now; hud.toast(`Winded: no sprinting until your breath is back to ${STAMINA_RULES.recoverAt * 100}%. Standing still recovers faster.`, 4500); }
  me.lit = me.light && me.battery > 0;
  if (me.light && me.battery <= 0 && now - (S.batteryToast || 0) > 8000) { S.batteryToast = now; hud.toast('Flashlight dead. Grab a power cell or get back to base to recharge.', 4500); }
  else if (me.light && me.battery > 0 && me.battery < 0.15 && now - (S.batteryToast || 0) > 20000) { S.batteryToast = now; hud.toast('Battery low.'); }
  if (now - (S.vitalsT || 0) > 100) { S.vitalsT = now; hud.vitals(me.stamina, me.battery, me.winded); statusLine(me); }
  const mode = sprinting ? 'sprint' : me.crouch ? 'crouch' : mv.mag < 1 ? 'walk' : 'jog';
  let speed = 0;
  // you always face the mouse (your flashlight goes where you look)
  const aim = renderer.aimPoint();
  const aimD = aim ? Math.hypot(aim.x - me.x, aim.y - me.y) : 0;
  // with the cursor right on top of you the angle is noise: keep the current heading
  const aimA = aim && G.input.enabled && aimD > 0.8 * PX ? Math.atan2(aim.y - me.y, aim.x - me.x) : me.dir;
  if (moving) {
    // aim-relative: W walks toward the mouse (where the light points), S backs off, A/D sidestep
    const fx = Math.cos(aimA), fy = Math.sin(aimA);
    const dx = fx * mv.y - fy * mv.x, dy = fy * mv.y + fx * mv.x;
    const sp = moveSpeed(me.cls, mode) * (boosted ? C.boost || 1 : 1) * (live.drowsy(me) ? 0.55 : 1);
    let nx = me.x, ny = me.y;
    const steps = Math.ceil(dt / 0.05);
    for (let i = 0; i < steps; i++) [nx, ny] = moveCircle(w, nx, ny, (dx * sp * dt) / steps, (dy * sp * dt) / steps, PLAYER_R);
    if ((S.phase === 'lobby' || S.phase === 'countdown') && baseIndexAt(w, nx, ny) !== S.teams[me.team]?.base) {
      [nx, ny] = [me.x, me.y];
      if (now - (S.fenceToast || 0) > 4000) { S.fenceToast = now; hud.toast('The city is locked down until the host starts the hunt.'); }
    }
    speed = Math.hypot(nx - me.x, ny - me.y) / PX / Math.max(dt, 1e-3);
    me.x = nx; me.y = ny;
  }
  if (aim && G.input.enabled) me.dir = angLerp(me.dir, aimA, Math.min(1, dt * 18));
  // adaptive music (footsteps follow the animation, see view.js)
  let danger = S.phase === 'playing' ? 0.12 : 0.04;
  for (const s of S.sentinels.values()) {
    const d = Math.hypot(s.x - me.x, s.y - me.y) / PX;
    if (s.state === 1 && d < 45) danger = Math.max(danger, 0.85);
    else if (d < 25) danger = Math.max(danger, 0.4);
  }
  if ((S.alertUntil || 0) > now) danger = 1;
  if (S.phase === 'playing' && S.endsAt - snow < 180000) danger = Math.max(danger, 0.65);
  if (live.purge && Math.hypot(live.purge.x - me.x, live.purge.y - me.y) < live.purge.r * 1.3) danger = Math.max(danger, 0.7);
  sfx.setIntensity(danger);

  me.speed = speed;
  me.moving = moving;
  me.sprinting = sprinting;
  me.stunned = stunned;
  me.invuln = !!(S.meFlags & 8);

  if (now - lastSend > 66 && !stunned) {
    const flags = (moving ? 1 : 0) | (sprinting ? 2 : 0) | (me.crouch ? 4 : 0) | (me.light ? 8 : 0);
    const pkt = [Math.round(me.x * 10) / 10, Math.round(me.y * 10) / 10, Math.round(me.dir * 100) / 100, flags];
    const key = pkt.join(',');
    if (key !== lastSent || now - lastSend > 1000) {
      socket.emit('mv', pkt);
      lastSent = key;
      lastSend = now;
    }
  }

  const k = Math.min(1, dt * 10);
  for (const o of S.others.values()) {
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
    o.dir = angLerp(o.dir, o.tdir, k);
  }
  for (const s of S.sentinels.values()) {
    s.x += (s.tx - s.x) * k;
    s.y += (s.ty - s.y) * k;
    s.look = angLerp(s.look, s.tlook, k);
  }

  // nearest interactable
  let target = null, best = INTERACT_R * INTERACT_R;
  w.terminals.forEach((p, i) => {
    const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
    if (d < best) { best = d; target = { kind: 'terminal', id: i, x: p.x, y: p.y }; }
  });
  if (!target && Math.hypot(w.core.x - me.x, w.core.y - me.y) < CORE_INTERACT_R) target = { kind: 'core', id: 0, x: w.core.x, y: w.core.y };
  // echoes, survivors, relays, cameras, drops: whichever is closer wins
  live.update(dt);
  const lt = live.target(me);
  if (lt && (!target || target.kind === 'core' || (lt.x - me.x) ** 2 + (lt.y - me.y) ** 2 < best)) target = lt;
  S.target = target;
  tickHold(now);

  if (now - lastExplore > 250) {
    lastExplore = now;
    hud.reveal(me.x, me.y, 22);
    for (const o of S.others.values()) {
      const meta = S.roster.get(o.id);
      if (meta && meta.team === me.team) hud.reveal(o.x, o.y, 16);
    }
  }
}

// one line under the vitals: bottles, and whatever state you're in right now
function statusLine(me) {
  const el = document.getElementById('status-line');
  if (!el) return;
  const snow = G.serverNow(), bits = [];
  const n = me.throwables ?? 3;
  bits.push(`<span class="kit">BOTTLES ${'●'.repeat(n)}${'○'.repeat(Math.max(0, 5 - n))}</span>`);
  if (me.hidden >= 0) bits.push('<span class="st hid">HIDDEN · move to leave</span>');
  else if (me.crouch) bits.push('<span class="st hid">CROUCHED · C or Shift to stand</span>');
  if (live.drowsy(me)) bits.push('<span class="st sleep">DROWSY · get indoors!</span>');
  else if (live.lullaby && live.lullaby.until > snow) bits.push(`<span class="st safe">SHELTERED · the Hush ends in ${Math.ceil((live.lullaby.until - snow) / 1000)}s</span>`);
  else if (live.lullabyAt > snow) bits.push(`<span class="st sleep">THE HUSH IN ${Math.ceil((live.lullabyAt - snow) / 1000)}s</span>`);
  if (S.team?.run && S.team.run.until > snow) bits.push(`<span class="st esc">BEACON ${S.team.run.idx + 1}/3 · ${Math.ceil((S.team.run.until - snow) / 1000)}s</span>`);
  if (S.pair && performance.now() - S.pair.at < 1200 && S.pair.k > 0) bits.push(`<span class="st esc">TWO-KEY ${S.pair.k.toFixed(1)}/${S.pair.need}s · hold still</span>`);
  const myUp = (S.uploads || []).find((u) => u.team === me.team);
  if (myUp) bits.push(`<span class="st ${myUp.state === 'running' ? 'safe' : 'sleep'}">UPLOAD ${Math.floor(myUp.p * 100)}% · ${myUp.state === 'running' ? 'HOLD THE CORE' : myUp.state === 'contested' ? 'CONTESTED: bring more of your cell' : 'NOBODY IN THE RING!'}</span>`);
  for (const [, h] of live.hijacks) if (h.team === me.team && h.until > snow) { bits.push(`<span class="st esc">DRONE ESCORT ${Math.ceil((h.until - snow) / 1000)}s</span>`); break; }
  const html = bits.join('');
  if (el._h !== html) { el._h = html; el.innerHTML = html; }
}

function runTutorial() {
  let seen = false;
  try { seen = localStorage.getItem('nexus_tut') === '1'; localStorage.setItem('nexus_tut', '1'); } catch {}
  if (seen) return;
  const tips = [
    'Press H any time for the field manual: every control and trick in the game.',
    'W / ↑ walks toward your mouse (where your light points) · S / ↓ backs off · A D / ← → sidestep · Shift to sprint.',
    touch ? 'Toggle your flashlight and crouch with the buttons on the right.' : 'F toggles your flashlight · C to crouch. Darkness and crouching keep you hidden.',
    'Terminals glow cyan in the dark. Stand next to one and press HACK.',
    'Each hacked terminal reveals one letter of the Core passphrase.',
    'Drones sweep searchlights. Lights off + crouched + still = nearly invisible.',
    'Pale blue lights are Echoes: memories of what happened here. Press E to listen.',
    'Left-click throws a bottle: drones go to check the noise. Creep up BEHIND a drone and hold E to rewire it.',
    'Hide under tarp-covered cars (E). When NEXUS releases the Hush, get indoors or it will slow you down.',
    'Yellow grid relays on walls cut a district\'s power: drones and cameras go half-blind.',
    `Your ability: ${CLASSES[S.me.cls].ability}. ${touch ? 'Tap the round button.' : 'Press SPACE.'}`,
  ];
  tips.forEach((t, i) => setTimeout(() => hud.toast(t, 4600), 1500 + i * 5200));
}
