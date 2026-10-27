// Big-screen spectator view for the 2D edition: NEXUS's own surveillance feed of the city.
// A pre-rendered tactical map with every agent, drone cone, blackout, drop and purge on it,
// drifting slowly and zooming in on big moments.
import { generateWorld, TILE, PX, T, isSolid, sectorName, SECTOR } from '/shared/world.js';
import { playPrologue } from './prologue.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const PAL = { cyan: '#22e1ff', magenta: '#ff2bd6', amber: '#ffb02e', red: '#ff2a4a' };
const DRONE_COLS = ['rgba(255,200,120,0.22)', 'rgba(255,42,74,0.4)', 'rgba(90,180,255,0)', 'rgba(255,138,42,0.32)'];
const DOT_COLS = ['#ffb02e', '#ff2a4a', '#5ab4ff', '#ff7a1a'];
const MP = 4; // map px per tile

const joinUrl = new URLSearchParams(location.search).get('join') || location.origin + '/';
function qr(target, text) {
  if (!window.qrcode) return;
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  target.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}
qr($('#bigqr'), joinUrl);
qr($('#smallqr'), joinUrl);
$('#bigurl').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
$('#smallurl').textContent = $('#bigurl').textContent;

const S = { world: null, teams: [], terminals: [], phase: 'lobby', roster: new Map(), clockOffset: 0, live: { relays: new Map(), drop: null, purge: null } };
const agents = new Map();
let drones = [];
let rings = [];
let mapImg = null;

// ---------------------------------------------------------------- the tactical map (drawn once)
function buildMap(w, colors) {
  const c = document.createElement('canvas');
  c.width = w.W * MP; c.height = w.H * MP;
  const g = c.getContext('2d');
  g.fillStyle = '#04060b'; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    const k = y * w.W + x, t = w.tiles[k], h = w.heights[k];
    let col = null;
    if (t === T.ROAD) col = '#10141c';
    else if (t === T.SIDEWALK) col = '#171c25';
    else if (t === T.FLOOR || t === T.YARD) col = '#141820';
    else if (t === T.GRASS || t === T.TREE) col = '#121a14';
    else if (t === T.MUD || t === T.RUBBLE) col = '#15140f';
    else if (t === T.TOXIC) col = '#0f3a18';
    else if (t === T.CORE) col = '#1a0d1c';
    else if (t === T.BASE) col = '#1b1f28';
    else if (isSolid(t)) { const v = Math.min(1, h / 60); col = `rgb(${30 + v * 40},${36 + v * 46},${52 + v * 60})`; }
    if (col) { g.fillStyle = col; g.fillRect(x * MP, y * MP, MP, MP); }
  }
  // building outlines glow faintly cyan, like a scanner
  g.strokeStyle = 'rgba(34,225,255,0.18)'; g.lineWidth = 1;
  for (const b of w.buildings) if (b.kind !== 'perimeter') g.strokeRect(b.x * MP + 0.5, b.y * MP + 0.5, b.w * MP - 1, b.h * MP - 1);
  // sector grid + labels
  g.strokeStyle = 'rgba(34,225,255,0.08)';
  for (let x = SECTOR; x < w.W; x += SECTOR) { g.beginPath(); g.moveTo(x * MP, 0); g.lineTo(x * MP, c.height); g.stroke(); }
  for (let y = SECTOR; y < w.H; y += SECTOR) { g.beginPath(); g.moveTo(0, y * MP); g.lineTo(c.width, y * MP); g.stroke(); }
  g.fillStyle = 'rgba(34,225,255,0.35)'; g.font = '14px "Share Tech Mono", monospace';
  for (let x = 0; x * SECTOR < w.W; x++) for (let y = 0; y * SECTOR < w.H; y++) g.fillText(`${String.fromCharCode(65 + x)}${y + 1}`, x * SECTOR * MP + 6, y * SECTOR * MP + 16);
  // bases
  w.bases.forEach((b, i) => { g.strokeStyle = colors[i]; g.lineWidth = 3; g.strokeRect(b.x * MP, b.y * MP, b.w * MP, b.h * MP); g.fillStyle = colors[i] + '22'; g.fillRect(b.x * MP, b.y * MP, b.w * MP, b.h * MP); });
  return c;
}

// ---------------------------------------------------------------- network
const socket = io();
socket.on('connect', () => socket.emit('screen'));
socket.on('screenInit', (d) => {
  S.clockOffset = d.serverNow - Date.now();
  S.teams = d.teams;
  S.terminals = d.terminals;
  renderUploads(d.uploads);
  S.passLen = d.passLen;
  S.roster = new Map(d.roster.map((r) => [r.id, r]));
  setPhase(d.phase, true);
  $('#s-feed').innerHTML = '';
  d.events.forEach(feed);
  renderTeams();
  const same = S.world && S.world.seed === d.world.seed && S.world.bases.length === d.world.bases;
  if (!same) { S.world = generateWorld(d.world.seed, d.world.bases, d.world.counts); mapImg = buildMap(S.world, ['#22e1ff', '#ff2bd6', '#ffd23f', '#3dff9a']); }
  if (d.live) {
    S.live.relays = new Map(d.live.relays);
    S.live.drop = d.live.drop; S.live.purge = d.live.purge;
  }
});

socket.on('ss', ([now, pl, se, teams]) => {
  S.clockOffset += (now - Date.now() - S.clockOffset) * 0.1;
  const seen = new Set();
  for (let i = 0; i < pl.length; i += 5) {
    const id = pl[i];
    seen.add(id);
    let a = agents.get(id);
    if (!a) { a = { x: pl[i + 1], y: pl[i + 2], trail: [] }; agents.set(id, a); }
    a.tx = pl[i + 1]; a.ty = pl[i + 2]; a.team = pl[i + 3]; a.stun = pl[i + 4];
  }
  for (const id of agents.keys()) if (!seen.has(id)) agents.delete(id);
  const n = se.length / 4;
  while (drones.length < n) drones.push({ x: 0, y: 0, init: false });
  drones.length = n;
  for (let i = 0; i < n; i++) {
    const d = drones[i];
    d.tx = se[i * 4]; d.ty = se[i * 4 + 1]; d.look = se[i * 4 + 2] / 100; d.state = se[i * 4 + 3];
    if (!d.init) { d.x = d.tx; d.y = d.ty; d.init = true; }
  }
  let changed = false;
  teams.forEach(([score, hacked, breach, letters], i) => {
    const t = S.teams[i];
    if (!t) return;
    if (t.score !== score || t.hacked !== hacked || t.breachRank !== breach) changed = true;
    Object.assign(t, { score, hacked, breachRank: breach, frags: letters });
  });
  if (changed) renderTeams();
});

socket.on('roster', (d) => {
  for (const r of d.upsert || []) S.roster.set(r.id, r);
  for (const id of d.remove || []) S.roster.delete(id);
  updateLobbyCount();
});
socket.on('scores', (teams) => { for (const t of teams) Object.assign(S.teams[t.id] || {}, t); renderTeams(); });
socket.on('terminal', ({ id, hackedBy }) => {
  if (S.terminals[id]) S.terminals[id].hackedBy = hackedBy;
  const p = S.world?.terminals[id];
  const t = S.teams[hackedBy[hackedBy.length - 1]];
  if (p && t) { ring(p.x, p.y, 40 * PX, t.color, 2); spotlight(p.x, p.y); }
});
socket.on('ev', feed);
socket.on('prologue', () => playPrologue());
socket.on('phase', (p) => setPhase(p));
socket.on('announce', (a) => announce(a.text, 'HQ BROADCAST', PAL.amber));
socket.on('nexus', (m) => {
  let box = document.getElementById('nexus-line');
  if (!box) { box = document.createElement('div'); box.id = 'nexus-line'; document.body.append(box); }
  box.innerHTML = '<div class="who">NEXUS</div><div class="txt"></div>';
  box.querySelector('.txt').textContent = m.text;
  box.className = 'in screen';
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.className = 'out screen'; }, 5000 + m.text.length * 45);
  glitchT = 0.6;
});
socket.on('world', (e) => {
  const L = S.live;
  if (e.type === 'relay') { L.relays.set(e.id, e.offUntil); const r = S.world?.relays[e.id]; if (r) { ring(r.x, r.y, r.radius, '#8fd3ff', 2); spotlight(r.x, r.y, 4000); } }
  else if (e.type === 'act') announce(e.title, e.name, PAL.magenta || '#ff2bd6');
  else if (e.type === 'drop') { L.drop = e; announce('SUPPLY DROP INBOUND', `Sector ${e.sector}`, PAL.amber); spotlight(e.x, e.y, 6000); }
  else if (e.type === 'dropTaken' || e.type === 'dropGone') L.drop = null;
  else if (e.type === 'purge') { L.purge = e; announce('PURGE SWEEP', `NEXUS is sweeping sector ${e.sector}`, PAL.red); spotlight(e.x, e.y, 7000); }
  else if (e.type === 'purgeEnd') L.purge = null;
  else if (e.type === 'uploadStart') { announce(`${e.name} IS UPLOADING`, 'The exit code is running. Hold the Core.', e.color); if (S.world) spotlight(S.world.core.x, S.world.core.y, 9000); }
  else if (e.type === 'npcTaken') ring(e.x, e.y, 10 * PX, '#9fd8ff', 1.5);
  else if (e.type === 'alarm') { const c = S.world?.alarmCars[e.id]; if (c) ring(c.x, c.y, 40 * PX, '#ffa020', 1.5); }
});
// Core uploads: a big bar per team over the map, so the whole room watches the finale
function renderUploads(list) {
  let bar = document.getElementById('s-upload');
  if (!bar) { bar = document.createElement('div'); bar.id = 's-upload'; document.getElementById('map').append(bar); }
  bar.classList.toggle('multi', (list || []).length > 1);
  bar.innerHTML = (list || []).map((u) => {
    const t = S.teams[u.team] || {}, pct = Math.floor(u.p * 100);
    const st = u.state === 'running' ? `UPLOADING · ${u.mine} holding` : u.state === 'contested' ? `CONTESTED · ${u.mine} vs ${u.enemies}` : 'STALLED · ring empty';
    return `<div class="up ${u.state}" style="--c:${t.color}"><b>${t.name || ''}</b><span class="track"><i style="width:${pct}%"></i></span><em>${pct}% · ${st}</em></div>`;
  }).join('');
  S.uploads = list || [];
}
socket.on('upload', renderUploads);
socket.on('breach', ({ team, rank, by }) => {
  const t = S.teams[team];
  announce(`${t.name} OPENED THE ARK`, `The exit code is through · ${by}`, t.color);
  if (S.world) { ring(S.world.core.x, S.world.core.y, 120 * PX, t.color, 3); spotlight(S.world.core.x, S.world.core.y, 8000); }
  flash = 0.8;
});
socket.on('fx', (f) => {
  if (f.type === 'emp') ring(f.x, f.y, f.r, '#5ab4ff', 1.2);
  if (f.type === 'capture') ring(f.x, f.y, 8 * PX, '#ff2a4a', 1);
});

function ring(x, y, r, color, dur) { rings.push({ x, y, r, color, t: 0, dur }); }

// ---------------------------------------------------------------- sidebar
function setPhase(p, silent) {
  const prev = S.phase;
  S.phase = p.phase; S.startAt = p.startAt; S.endsAt = p.endsAt;
  if (p.serverNow) S.clockOffset = p.serverNow - Date.now();
  $('#lobby-overlay').classList.toggle('hidden', p.phase !== 'lobby');
  updateLobbyCount();
  if (silent || prev === p.phase) return;
  if (p.phase === 'playing') announce('THE HUNT IS LIVE', 'Find the terminals · Breach the Core', PAL.cyan);
  if (p.phase === 'ended' && p.standings) {
    const w = p.standings.teams[0];
    announce(`${w.name} TAKES THE CITY`, `Passphrase: ${p.standings.passphrase}`, w.color);
  }
}

function updateLobbyCount() {
  const n = [...S.roster.values()].filter((r) => r.connected).length;
  $('#lobby-count').textContent = `${n} agent${n === 1 ? '' : 's'} connected`;
}

function feed(e) {
  const f = el('div', 'feed-item');
  f.style.color = e.color || '#9fb3c8';
  f.append(el('span', null, e.text));
  const box = $('#s-feed');
  box.append(f);
  while (box.children.length > 14) box.firstChild.remove();
}

function announce(text, sub, color) {
  const a = el('div', 'ann', text);
  a.style.setProperty('--c', color);
  if (sub) a.append(el('small', null, sub));
  $('#announce').innerHTML = '';
  $('#announce').append(a);
}

function renderTeams() {
  const box = $('#s-teams');
  box.innerHTML = '';
  // up to 10 squads fit on the big screen: the leaders
  const sorted = S.teams.filter((t) => t.active && (t.size || t.score)).sort((a, b) => (a.breachRank && b.breachRank ? a.breachRank - b.breachRank : a.breachRank ? -1 : b.breachRank ? 1 : b.score - a.score)).slice(0, 10);
  // more than 5 squads: one tight row each (rank, name, letters, score) so ten fit under the timer
  box.classList.toggle('compact', sorted.length > 5);
  for (const [i, t] of sorted.entries()) {
    const d = el('div', 'st');
    d.style.setProperty('--c', t.color);
    const top = el('div', 'st-top');
    const nm = el('div', 'st-name', `${i + 1}. ${t.name}`);
    if (t.breachRank) nm.append(el('span', 'badge', `BREACHED #${t.breachRank}`));
    top.append(nm, el('div', 'st-score', String(t.score)));
    const slots = el('div', 'st-slots');
    const frags = t.frags ?? t.hacked ?? 0;
    for (let i = 0; i < (S.passLen || 12); i++) slots.append(el('i', i < frags ? 'on' : ''));
    const members = [...S.roster.values()].filter((r) => r.team === t.id && r.connected).length;
    d.append(top, slots, el('div', 'st-sub', `${t.hacked}/${S.passLen} terminals · ${members} agents`));
    box.append(d);
  }
}

// ---------------------------------------------------------------- render
const canvas = $('#screen-canvas');
const g = canvas.getContext('2d');
let focus = null, flash = 0, glitchT = 0;
function spotlight(x, y, ms = 5000) { focus = { x, y, until: performance.now() + ms }; }
const cam = { x: 0, y: 0, z: 1, first: true };

let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  const t = ts / 1000;
  const now = Date.now() + S.clockOffset;
  let txt = 'LOBBY', label = 'WAITING FOR HOST', low = false;
  if (S.phase === 'countdown') { txt = fmt(S.startAt - now); label = 'LOCKDOWN LIFTS IN'; }
  else if (S.phase === 'playing') { txt = fmt(S.endsAt - now); label = 'TIME REMAINING'; low = S.endsAt - now < 120000; }
  else if (S.phase === 'ended') { txt = 'OVER'; label = 'SIMULATION'; }
  $('#s-timer').textContent = txt;
  $('#s-timer').classList.toggle('low', low);
  $('#s-phase').textContent = label;
  const r = $('#map').getBoundingClientRect();
  const W = Math.round(r.width), H = Math.round(r.height);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#020306'; g.fillRect(0, 0, W, H);
  const w = S.world;
  if (!w || !mapImg) return;

  // camera: whole city with a slow drift, or a close look at the action
  const fit = Math.min(W / (w.W * TILE), H / (w.H * TILE));
  let tx, ty, tz;
  if (focus && ts < focus.until) { tx = focus.x; ty = focus.y; tz = fit * 3.2; }
  else {
    focus = null;
    tx = w.core.x + Math.cos(t * 0.05) * w.W * TILE * 0.06; ty = w.core.y + Math.sin(t * 0.04) * w.H * TILE * 0.06;
    tz = fit * (1.0 + Math.sin(t * 0.03) * 0.05);
  }
  const k = cam.first ? 1 : Math.min(1, dt * 0.9);
  cam.first = false;
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
  g.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
  g.imageSmoothingEnabled = true;
  g.drawImage(mapImg, 0, 0, w.W * TILE, w.H * TILE);
  const u = 1 / cam.z; // one screen pixel in world px

  // blackouts
  for (const [id, until] of S.live.relays) {
    if (until < now) continue;
    const rl = w.relays[id];
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(rl.x, rl.y, rl.radius, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,160,255,0.6)'; g.setLineDash([8 * u, 6 * u]); g.lineWidth = 2 * u; g.stroke(); g.setLineDash([]);
  }
  // purge
  const pg = S.live.purge;
  if (pg && pg.until > now) {
    g.fillStyle = `rgba(255,42,74,${0.12 + Math.sin(t * 6) * 0.06})`; g.strokeStyle = '#ff2a4a'; g.lineWidth = 3 * u;
    g.beginPath(); g.arc(pg.x, pg.y, pg.r, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  // core
  g.save(); g.globalCompositeOperation = 'lighter';
  const cr = (14 + Math.sin(t * 3) * 3) * PX;
  const cg = g.createRadialGradient(w.core.x, w.core.y, 0, w.core.x, w.core.y, cr * 2);
  cg.addColorStop(0, 'rgba(255,43,214,0.8)'); cg.addColorStop(1, 'rgba(255,43,214,0)');
  g.fillStyle = cg; g.fillRect(w.core.x - cr * 2, w.core.y - cr * 2, cr * 4, cr * 4);
  g.restore();
  // terminals: diamonds in the colour of the last team to crack them
  w.terminals.forEach((p, i) => {
    const hb = S.terminals[i]?.hackedBy || [];
    const col = hb.length ? S.teams[hb[hb.length - 1]]?.color : '#22e1ff';
    const s = 9 * u * (1 + Math.sin(t * 3 + i) * 0.15);
    g.save(); g.translate(p.x, p.y); g.rotate(Math.PI / 4);
    g.fillStyle = col; g.globalAlpha = 0.85; g.fillRect(-s / 2, -s / 2, s, s);
    g.restore();
  });
  // supply drop
  const dr = S.live.drop;
  if (dr) {
    const kk = (t * 1.2) % 1;
    g.strokeStyle = `rgba(255,176,46,${1 - kk})`; g.lineWidth = 3 * u;
    g.beginPath(); g.arc(dr.x, dr.y, (10 + kk * 40) * u, 0, Math.PI * 2); g.stroke();
  }
  // drones: searchlight wedges + dots
  const ka = Math.min(1, dt * 5);
  for (const d of drones) {
    d.x += (d.tx - d.x) * ka; d.y += (d.ty - d.y) * ka;
    const team = d.state >= 10 ? S.teams[d.state - 10] : null;   // hijacked: flies for a team now
    if (d.state !== 2) {
      if (team) { g.globalAlpha = 0.3; g.fillStyle = team.color; } else g.fillStyle = DRONE_COLS[d.state] || DRONE_COLS[0];
      g.beginPath(); g.moveTo(d.x, d.y); g.arc(d.x, d.y, 22 * PX, d.look - 0.55, d.look + 0.55); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = team ? team.color : DOT_COLS[d.state] || DOT_COLS[0];
    g.beginPath(); g.arc(d.x, d.y, 4 * u, 0, Math.PI * 2); g.fill();
  }
  // agents with short trails
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const a of agents.values()) {
    a.x += (a.tx - a.x) * ka; a.y += (a.ty - a.y) * ka;
    if (!a.lt || ts - a.lt > 250) { a.lt = ts; a.trail.push([a.x, a.y]); if (a.trail.length > 14) a.trail.shift(); }
    const col = a.stun ? '#ff2a4a' : S.teams[a.team]?.color || '#fff';
    g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 2 * u;
    g.beginPath(); a.trail.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); g.lineTo(a.x, a.y); g.stroke();
    g.globalAlpha = 1;
    const gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, 14 * u);
    gr.addColorStop(0, col); gr.addColorStop(0.3, col + '88'); gr.addColorStop(1, col + '00');
    g.fillStyle = gr; g.fillRect(a.x - 14 * u, a.y - 14 * u, 28 * u, 28 * u);
  }
  g.restore();
  // rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const rg = rings[i];
    rg.t += dt;
    if (rg.t > rg.dur) { rings.splice(i, 1); continue; }
    const kk = rg.t / rg.dur;
    g.strokeStyle = rg.color; g.globalAlpha = 1 - kk; g.lineWidth = 3 * u;
    g.beginPath(); g.arc(rg.x, rg.y, rg.r * (0.2 + kk * 0.8), 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }

  // screen space: scanlines, sweep line, flash, glitch
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  const sweep = ((t * 0.12) % 1) * H;
  const sg = g.createLinearGradient(0, sweep - 60, 0, sweep);
  sg.addColorStop(0, 'rgba(34,225,255,0)'); sg.addColorStop(1, 'rgba(34,225,255,0.07)');
  g.fillStyle = sg; g.fillRect(0, sweep - 60, W, 60);
  g.fillStyle = 'rgba(255,43,214,0.7)'; g.font = '13px "Share Tech Mono", monospace';
  g.fillText(`NEXUS // SURVEILLANCE FEED // ${focus ? 'SECTOR ' + sectorName(cam.x, cam.y) : 'HALCYON OVERVIEW'} // ${new Date(now).toISOString().slice(11, 19)}`, 16, H - 16);
  if (flash > 0) { flash = Math.max(0, flash - dt); g.fillStyle = `rgba(255,255,255,${flash * 0.4})`; g.fillRect(0, 0, W, H); }
  if (glitchT > 0) {
    glitchT -= dt;
    for (let i = 0; i < 6; i++) { const y = Math.random() * H, h = 4 + Math.random() * 24; g.drawImage(canvas, 0, y, W, h, (Math.random() - 0.5) * 50, y, W, h); }
  }
}
requestAnimationFrame(frame);
