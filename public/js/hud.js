import { TILE, T, SECTOR, CLASSES, classStats, sectorName, isSolid } from '/shared/world.js';
import { drawPlayer, rgba, PAL } from './art.js';


const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const MAP_COLORS = {
  [T.ROAD]: [32, 36, 48], [T.SIDEWALK]: [40, 44, 56], [T.FLOOR]: [52, 56, 68], [T.RUBBLE]: [38, 38, 44], [T.GRASS]: [30, 30, 24],
  [T.BASE]: [30, 40, 56], [T.CORE]: [60, 14, 54], [T.MUD]: [44, 40, 30], [T.YARD]: [42, 42, 46],
  [T.WALL]: [92, 96, 110], [T.TOWER]: [12, 13, 18], [T.TREE]: [40, 34, 24], [T.BARRIER]: [120, 100, 40], [T.CAR]: [60, 46, 40],
  [T.CORE_SOLID]: [255, 43, 214], [T.TOXIC]: [40, 160, 70], [T.CONTAINER]: [110, 50, 36], [T.ROCK]: [22, 22, 24], [T.FENCE]: [80, 84, 90],
};

export class Hud {
  constructor(G) {
    this.G = G;
    this.S = G.S;
    this.lastMap = 0;
    this.timerText = '';
    this.chatScope = 'team';
    this.bindStatic();
  }

  // ---------------------------------------------------------------- wiring
  bindStatic() {
    const G = this.G;
    $('#toolbar').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      G.sfx.play('click');
      if (act === 'intel') this.togglePanel('intel');
      else if (act === 'scores') this.togglePanel('scores');
      else if (act === 'help') this.togglePanel('help');
      else if (act === 'chat') this.openChat('team');
      else if (act === 'mute') { G.sfx.setMuted(!G.sfx.muted); this.syncMute(); }
    });
    $('#minimap-wrap').addEventListener('click', () => this.toggleMap());
    // field manual: tabs, the class list, and the button on the join screen
    document.querySelectorAll('.help-tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.help-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.help-body section').forEach((sec) => { sec.hidden = sec.dataset.tab !== b.dataset.tab; });
    }));
    $('#help-classes').replaceChildren(...Object.keys(CLASSES).map((k) => { const d = el('div', 'help-cls'); d.append(el('h4', null, CLASSES[k].name), this.classSheet(k)); return d; }));
    document.querySelectorAll('.help-open').forEach((b) => b.addEventListener('click', () => this.togglePanel('help', true)));
    document.querySelectorAll('.panel .close').forEach((b) => b.addEventListener('click', () => this.closePanels()));
    $('#bigmap .close').addEventListener('click', () => this.toggleMap(false));
    $('#bigmap').addEventListener('click', (e) => { if (e.target.id === 'bigmap') this.toggleMap(false); });
    $('#bigmap-canvas').addEventListener('click', (e) => {
      const c = e.currentTarget, r = c.getBoundingClientRect(), w = this.S.world;
      const x = ((e.clientX - r.left) / r.width) * w.W * TILE, y = ((e.clientY - r.top) / r.height) * w.H * TILE;
      G.ping(x, y);
    });
    $('#btn-ability').addEventListener('click', () => G.useAbility());
    $('#btn-act').addEventListener('click', () => G.interact());

    $('#chat-scope').addEventListener('click', () => { this.chatScope = this.chatScope === 'team' ? 'all' : 'team'; this.syncChatScope(); $('#chat-input').focus(); });
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#chat-input').value.trim();
      if (v) G.socket.emit('chat', { text: v, scope: this.chatScope });
      $('#chat-input').value = '';
      this.closeChat();
    });
    $('#chat-input').addEventListener('blur', () => setTimeout(() => this.closeChat(), 100));

    // terminal
    $('#terminal .close').addEventListener('click', () => this.closeTerminal());
    $('#terminal .term-form').addEventListener('submit', (e) => { e.preventDefault(); this.submitAnswer(); });
    $('#terminal .term-hint-btn').addEventListener('click', () => this.buyHint());
    $('#terminal .term-prompt').addEventListener('click', () => { if (this.typing) this.typing.skip = true; });
    // core
    $('#core-modal .close').addEventListener('click', () => this.closeCore());
    $('#core-form').addEventListener('submit', (e) => { e.preventDefault(); this.submitCore(); });
    this.syncMute();
  }

  syncMute() { $('#btn-mute').classList.toggle('off', this.G.sfx.muted); }
  syncChatScope() { const b = $('#chat-scope'); b.textContent = this.chatScope === 'team' ? 'TEAM' : 'ALL'; b.classList.toggle('all', this.chatScope === 'all'); }

  get modalOpen() {
    return !$('#terminal').classList.contains('hidden') || !$('#core-modal').classList.contains('hidden');
  }
  updateInputLock() {
    const typing = !$('#chat-form').classList.contains('hidden');
    this.G.input.setEnabled(!this.modalOpen && !typing);
  }

  // ---------------------------------------------------------------- setup per world
  setup(newWorld) {
    const S = this.S;
    const team = S.teams[S.me.team];
    document.documentElement.style.setProperty('--team', team.color);
    $('#team-name').textContent = `SQUAD ${team.name}`;
    const slots = $('#passslots');
    slots.innerHTML = '';
    for (let i = 0; i < S.passLen; i++) slots.append(el('div', 'slot', '·'));
    $('.ab-name').textContent = CLASSES[S.me.cls].ability;
    if (newWorld || !this.mapBase) this.buildMapBase();
    this.renderTeam(true);
    $('#hud').classList.remove('hidden');
    if (!$('#panel-scores').classList.contains('hidden')) this.renderScores();
  }

  buildMapBase() {
    const w = this.S.world;
    const c = document.createElement('canvas');
    c.width = w.W; c.height = w.H;
    const g = c.getContext('2d');
    const img = g.createImageData(w.W, w.H);
    for (let k = 0; k < w.W * w.H; k++) {
      const col = MAP_COLORS[w.tiles[k]] || [0, 0, 0];
      img.data[k * 4] = col[0]; img.data[k * 4 + 1] = col[1]; img.data[k * 4 + 2] = col[2]; img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c;
    this.fog = document.createElement('canvas');
    this.fog.width = w.W; this.fog.height = w.H;
    const fg = this.fog.getContext('2d');
    fg.fillStyle = 'rgba(0,0,0,0.88)';
    fg.fillRect(0, 0, w.W, w.H);
    this.fogCtx = fg;
    this.explored = new Uint8Array(w.W * w.H);
    // bases and the core are always known
    w.bases.forEach((b) => this.reveal((b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE, 9));
    this.reveal(w.core.x, w.core.y, 11);
  }

  reveal(px, py, r) {
    const w = this.S.world;
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w.W || y >= w.H) continue;
      const k = y * w.W + x;
      if (this.explored[k] || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      this.explored[k] = 1;
      this.fogCtx.clearRect(x, y, 1, 1);
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(now) {
    const S = this.S, G = this.G;
    const snow = G.serverNow();
    // timer
    let label = 'STANDBY', text = '--:--', low = false;
    if (S.phase === 'lobby') { label = 'WAITING FOR HOST'; text = 'LOBBY'; }
    else if (S.phase === 'countdown') { label = 'LOCKDOWN LIFTS IN'; text = fmt(S.startAt - snow); }
    else if (S.phase === 'playing') { label = 'TIME REMAINING'; text = fmt(S.endsAt - snow); low = S.endsAt - snow < 120000; }
    else if (S.phase === 'ended') { label = 'SIMULATION'; text = 'OVER'; }
    if (text !== this.timerText) {
      this.timerText = text;
      $('#timer').textContent = text;
      $('#phase-label').textContent = label;
      $('#timer').classList.toggle('low', low);
    }
    // countdown big numbers
    if (S.phase === 'countdown') {
      const n = Math.ceil((S.startAt - snow) / 1000);
      if (n !== this.cdShown && n <= 5 && n > 0) {
        this.cdShown = n;
        $('#countdown').innerHTML = `<div class="n">${n}</div>`;
        G.sfx.play('tick');
      }
    }
    // ability ring
    const cls = CLASSES[S.me.cls];
    const left = Math.max(0, S.abilityReadyAt - snow);
    const frac = left > 0 ? left / cls.cd : 0;
    const btn = $('#btn-ability');
    btn.querySelector('.cd').style.strokeDashoffset = String(283 * frac);
    const ready = left <= 0;
    if (ready !== this.abReady) {
      this.abReady = ready;
      btn.classList.toggle('ready', ready);
      btn.classList.toggle('cooling', !ready);
      if (ready && this.abWasUsed) this.toast(`${cls.ability} ready`);
    }
    // interaction prompt
    const tgt = S.target;
    const key = tgt ? `${tgt.kind}:${tgt.id}` : '';
    if (key !== this.promptKey) {
      this.promptKey = key;
      const p = $('#interact-prompt');
      const act = $('#btn-act');
      if (!tgt) { p.classList.add('hidden'); act.classList.add('hidden'); }
      else {
        let txt, verb;
        if (tgt.kind === 'terminal') {
          const hacked = S.team.hacked.includes(tgt.id);
          verb = hacked ? 'VIEW' : 'HACK';
          txt = `${hacked ? 'View' : 'Hack'} ${S.terminals[tgt.id].name}`;
        } else if (tgt.kind === 'core') { verb = 'CORE'; txt = 'Override the Nexus Core'; }
        else { verb = 'USE'; txt = tgt.label; }
        p.innerHTML = '';
        p.append(el('kbd', null, 'E'), document.createTextNode(txt));
        p.classList.remove('hidden');
        act.textContent = verb;
        act.classList.toggle('hidden', !document.body.classList.contains('touch'));
      }
    }
    // minimap @ 10 Hz
    if (now - this.lastMap > 100) {
      this.lastMap = now;
      const mm = $('#minimap');
      const r = mm.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (mm.width !== Math.round(r.width * dpr)) { mm.width = Math.round(r.width * dpr); mm.height = Math.round(r.height * dpr); }
      this.drawMap(mm.getContext('2d'), mm.width, mm.height, false, now);
      $('#sector-label').textContent = `SECTOR ${sectorName(S.me.x, S.me.y)}`;
      if (!$('#bigmap').classList.contains('hidden')) {
        const bm = $('#bigmap-canvas');
        this.drawMap(bm.getContext('2d'), bm.width, bm.height, true, now);
      }
    }
    // fade feed / chat
    for (const f of document.querySelectorAll('.feed-item:not(.fade)')) if (now - f._t > 9000) { f.classList.add('fade'); setTimeout(() => f.remove(), 1000); }
    for (const c of document.querySelectorAll('.chat-line:not(.fade)')) if (now - c._t > 14000) c.classList.add('fade');
  }

  drawMap(g, w, h, big, now) {
    const S = this.S, world = S.world, colors = S.teamColors;
    const sx = w / world.W, sy = h / world.H;
    const P = (x, y) => [(x / TILE) * sx, (y / TILE) * sy];
    const t = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapBase, 0, 0, w, h);
    g.drawImage(this.fog, 0, 0, w, h);
    g.imageSmoothingEnabled = true;
    // sector grid
    g.strokeStyle = 'rgba(34,225,255,0.1)'; g.lineWidth = 1;
    g.beginPath();
    for (let c = SECTOR; c < world.W; c += SECTOR) { g.moveTo(c * sx + 0.5, 0); g.lineTo(c * sx + 0.5, h); }
    for (let r = SECTOR; r < world.H; r += SECTOR) { g.moveTo(0, r * sy + 0.5); g.lineTo(w, r * sy + 0.5); }
    g.stroke();
    const fs = big ? Math.max(11, sx * 3) : 0;
    if (big) {
      g.fillStyle = 'rgba(34,225,255,0.55)';
      g.font = `${fs}px "Share Tech Mono", monospace`;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let c = 0; c * SECTOR < world.W; c++) g.fillText(String.fromCharCode(65 + c), (c + 0.5) * SECTOR * sx, 4);
      g.textAlign = 'left'; g.textBaseline = 'middle';
      for (let r = 0; r * SECTOR < world.H; r++) g.fillText(String(r + 1), 4, (r + 0.5) * SECTOR * sy);
    }
    const u = Math.max(2, sx * (big ? 1.2 : 1.6));
    // bases
    world.bases.forEach((b, i) => {
      g.strokeStyle = S.baseColors?.[i] || '#6b7894'; g.lineWidth = i === S.teams[S.me.team]?.base ? 2 : 1;
      g.strokeRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy);
    });
    // core
    {
      const [x, y] = P(world.core.x, world.core.y);
      g.strokeStyle = rgba(PAL.magenta, 0.6 + Math.sin(t * 4) * 0.4); g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 3 * u + Math.sin(t * 4) * u * 0.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = PAL.magenta; g.beginPath(); g.arc(x, y, u * 1.2, 0, Math.PI * 2); g.fill();
    }
    // scan signals (unread intel)
    for (const id of S.signals) {
      if (S.graffitiText.has(id)) continue;
      const gr = world.graffiti[id];
      const [x, y] = P(gr.x, gr.y);
      g.strokeStyle = rgba(PAL.amber, 0.5 + Math.sin(t * 5) * 0.3); g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, u * 1.4, 0, Math.PI * 2); g.stroke();
    }
    // intel found
    for (const m of S.team.intel) {
      if (m.id < 0) continue;
      const gr = world.graffiti[m.id];
      const [x, y] = P(gr.x, gr.y);
      g.fillStyle = m.clue ? PAL.amber : 'rgba(255,43,214,0.7)';
      g.fillRect(x - u * 0.6, y - u * 0.6, u * 1.2, u * 1.2);
    }
    this.G.live?.drawMap(g, P, u, big, now);
    // terminals
    for (const id of S.team.knownTerminals) {
      const p = world.terminals[id];
      const [x, y] = P(p.x, p.y);
      const ours = S.team.hacked.includes(id);
      const s = u * 1.7;
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
      g.fillStyle = ours ? PAL.green : rgba(PAL.cyan, 0.25 + (Math.sin(t * 4 + id) + 1) * 0.3);
      g.strokeStyle = ours ? PAL.green : PAL.cyan; g.lineWidth = 1.2;
      g.fillRect(-s / 2, -s / 2, s, s); g.strokeRect(-s / 2, -s / 2, s, s);
      g.restore();
      if (big) {
        g.fillStyle = ours ? PAL.green : PAL.cyan;
        g.font = `${Math.max(10, fs * 0.8)}px "Share Tech Mono", monospace`;
        g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText(S.terminals[id].name, x, y + s);
      }
    }
    // objectives: two-key consoles, the live beacon
    for (const o of S.objectives || []) {
      const [x, y] = P(o.x, o.y);
      g.strokeStyle = o.color; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, u * 2.2 + Math.sin(t * 6) * u * 0.6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = o.color; g.fillRect(x - u * 0.7, y - u * 0.7, u * 1.4, u * 1.4);
      if (big) { g.font = `${Math.max(10, fs * 0.8)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(o.label, x, y + u * 2.6); }
    }
    // uploads: the Core ring in the uploader's colour
    for (const up of S.uploads || []) {
      const [x, y] = P(world.core.x, world.core.y);
      g.strokeStyle = rgba(S.teamColors[up.team] || '#ffffff', 0.5 + Math.sin(t * 6) * 0.4); g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, (14 * 21.333 / TILE) * sx, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, up.p)); g.stroke();
    }
    // drones from a recent scan
    S.scanDrones = S.scanDrones.filter((d) => now - d.t < 6000);
    for (const d of S.scanDrones) {
      const [x, y] = P(d.x, d.y);
      g.strokeStyle = rgba(PAL.red, 1 - (now - d.t) / 6000); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - u, y - u); g.lineTo(x + u, y + u); g.moveTo(x + u, y - u); g.lineTo(x - u, y + u); g.stroke();
    }
    // pings
    for (const p of S.pings) {
      const [x, y] = P(p.x, p.y);
      const k = ((now - p.t) / 700) % 1;
      g.strokeStyle = rgba(colors[S.me.team], 1 - k); g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, u + k * u * 4, 0, Math.PI * 2); g.stroke();
    }
    // teammates
    for (const o of S.others.values()) {
      const meta = S.roster.get(o.id);
      if (!meta || meta.team !== S.me.team) continue;
      const [x, y] = P(o.x, o.y);
      g.fillStyle = colors[meta.team];
      g.beginPath(); g.arc(x, y, u * 0.9, 0, Math.PI * 2); g.fill();
    }
    // me
    {
      const [x, y] = P(S.me.x, S.me.y);
      g.save(); g.translate(x, y); g.rotate(S.me.dir);
      g.fillStyle = '#fff';
      const a = u * 2;
      g.beginPath(); g.moveTo(a, 0); g.lineTo(-a * 0.7, a * 0.7); g.lineTo(-a * 0.3, 0); g.lineTo(-a * 0.7, -a * 0.7); g.closePath(); g.fill();
      g.restore();
    }
  }

  vitals(stamina, battery, winded) {
    const vs = $('#v-stamina');
    if (vs.classList.contains('winded') !== !!winded) { vs.classList.toggle('winded', !!winded); vs.querySelector('.lbl span').textContent = winded ? 'WINDED · NO SPRINT' : 'STAMINA'; }
    for (const [id, v] of [['v-stamina', stamina], ['v-battery', battery]]) {
      const e = document.getElementById(id);
      if (!e) continue;
      e.querySelector('.fill').style.width = `${Math.round(v * 100)}%`;
      e.querySelector('.v').textContent = `${Math.round(v * 100)}%`;
      e.classList.toggle('low', v < 0.15);
    }
  }

  // ---------------------------------------------------------------- team / scores
  renderTeam(initial) {
    const S = this.S;
    if (!S.me || !S.team) return;
    const team = S.teams[S.me.team];
    $('#team-score').textContent = String(team.score);
    if ($('#team-name').textContent !== `SQUAD ${team.name}`) $('#team-name').textContent = `SQUAD ${team.name}`;   // renamed by the host
    const info = `CODE ${S.team.code || '—'} · ${team.size || 1}/4${S.team.open ? ' · open' : ''}`;
    if ($('#squad-info').textContent !== info) $('#squad-info').textContent = info;
    const slots = $('#passslots').children;
    // letters arrive scrambled: show the bag (alphabetical), not positions
    const letters = S.team.letters || [];
    [...slots].forEach((s, i) => {
      const f = letters[i];
      if (f && s.textContent !== f) {
        s.textContent = f;
        s.classList.add('on');
        if (initial) s.style.animation = 'none'; else { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }
      } else if (!f) { s.textContent = '·'; s.classList.remove('on'); }
    });
    const n = S.team.hacked.length;
    const cs = $('#core-status');
    if (S.team.breachRank) { cs.textContent = `CORE BREACHED · #${S.team.breachRank}`; cs.className = 'ready'; }
    else if (n >= S.coreMin) { cs.textContent = `${n}/${S.passLen} — Core override available`; cs.className = 'ready'; }
    else { cs.textContent = `${n}/${S.passLen} — need ${S.coreMin} to attempt the Core`; cs.className = ''; }
    if (!$('#panel-scores').classList.contains('hidden')) this.renderScores();
    if (!$('#panel-intel').classList.contains('hidden')) this.renderIntel();
  }

  togglePanel(which, force) {
    const p = $(`#panel-${which}`);
    const show = force ?? p.classList.contains('hidden');
    this.closePanels();
    if (!show) return;
    if (which === 'scores') this.renderScores();
    if (which === 'intel') this.renderIntel();
    p.classList.remove('hidden');
  }
  closePanels() { document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden')); }

  renderScores() {
    const S = this.S;
    const body = $('#scores-body');
    body.innerHTML = '';
    const teams = S.teams.filter((t) => t.active && (t.size || t.score)).sort((a, b) => (a.breachRank && b.breachRank ? a.breachRank - b.breachRank : a.breachRank ? -1 : b.breachRank ? 1 : b.score - a.score));
    teams.forEach((t, i) => {
      const row = el('div', 'rank-team' + (t.id === S.me.team ? ' me' : ''));
      row.style.setProperty('--c', t.color);
      row.append(el('div', 'rank-pos', String(i + 1)));
      const mid = el('div');
      const nm = el('div', 'rank-name', t.name);
      if (t.breachRank) nm.append(el('span', 'badge', `BREACHED #${t.breachRank}`));
      mid.append(nm, el('div', 'rank-sub', `${t.hacked}/${S.passLen} terminals`));
      row.append(mid, el('div', 'rank-score', String(t.score)));
      const mem = el('div', 'rank-members');
      const members = [...S.roster.values()].filter((p) => p.team === t.id && p.connected);
      const shown = members.slice(0, 14);
      shown.forEach((p, j) => {
        mem.append(el('span', null, `${p.name} (${CLASSES[p.cls]?.name[0] || '?'})`));
        if (j < shown.length - 1) mem.append(document.createTextNode(' · '));
      });
      if (members.length > shown.length) mem.append(document.createTextNode(` · +${members.length - shown.length} more`));
      if (!members.length) mem.textContent = 'no agents online';
      row.append(mem);
      body.append(row);
    });
  }

  renderIntel() {
    const S = this.S;
    const tl = $('#intel-terminals');
    tl.innerHTML = '';
    if (!S.team.knownTerminals.length) tl.append(el('div', 'empty', 'None yet. Explore the city. Terminals glow cyan in the dark.'));
    for (const id of [...S.team.knownTerminals].sort((a, b) => a - b)) {
      const p = S.world.terminals[id];
      const row = el('div', 'intel-row');
      row.append(el('span', 'sec', sectorName(p.x, p.y)), el('span', 'txt', S.terminals[id].name));
      const hacked = S.team.hacked.includes(id);
      row.append(el('span', hacked ? 'ok' : 'by', hacked ? '✓ cracked' : 'locked'));
      tl.append(row);
    }
    const ml = $('#intel-messages');
    ml.innerHTML = '';
    if (!S.team.intel.length) ml.append(el('div', 'empty', 'Resistance members sprayed messages across the city. Some hold codes.'));
    for (const m of [...S.team.intel].reverse()) {
      const row = el('div', 'intel-row' + (m.clue ? ' clue' : ''));
      row.append(el('span', 'sec', m.sector), el('span', 'txt', m.text), el('span', 'by', m.by));
      ml.append(row);
    }
    this.G.live?.renderLog();
  }

  toggleMap(force) {
    const m = $('#bigmap');
    const show = force ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !show);
    if (show) {
      const w = this.S.world;
      const maxW = innerWidth * 0.94, maxH = innerHeight * 0.88 - 56;
      const scale = Math.min(maxW / w.W, maxH / w.H);
      const c = $('#bigmap-canvas');
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.style.width = Math.floor(w.W * scale) + 'px';
      c.style.height = Math.floor(w.H * scale) + 'px';
      c.width = Math.floor(w.W * scale * dpr);
      c.height = Math.floor(w.H * scale * dpr);
      this.lastMap = 0;
    }
  }

  // ---------------------------------------------------------------- messages
  feed(e) {
    const f = el('div', 'feed-item');
    f.style.color = e.color || '#9fb3c8';
    f.append(el('span', null, e.text));
    f._t = performance.now();
    const box = $('#feed');
    box.append(f);
    while (box.children.length > 6) box.firstChild.remove();
  }

  chat(m) {
    const S = this.S;
    const line = el('div', 'chat-line');
    line.append(el('span', 'scope', m.scope === 'all' ? '[ALL]' : '[TEAM]'));
    const who = el('b', null, m.from + ': ');
    who.style.color = S.teamColors[m.team] || '#fff';
    line.append(who, document.createTextNode(m.text));
    line._t = performance.now();
    const log = $('#chat-log');
    log.append(line);
    while (log.children.length > 8) log.firstChild.remove();
  }

  openChat(scope) {
    this.chatScope = scope;
    this.syncChatScope();
    $('#chat-form').classList.remove('hidden');
    $('#chatbox').classList.add('open');
    this.updateInputLock();
    setTimeout(() => $('#chat-input').focus(), 0);
  }
  closeChat() {
    if (document.activeElement === $('#chat-input')) return;
    $('#chat-form').classList.add('hidden');
    $('#chatbox').classList.remove('open');
    this.updateInputLock();
  }

  announce(text, sub, color = PAL.cyan) {
    const box = $('#announce');
    const a = el('div', 'ann', text);
    a.style.setProperty('--c', color);
    if (sub) a.append(el('small', null, sub));
    box.innerHTML = '';
    box.append(a);
    this.G.sfx.play('announce');
  }

  toast(text, ms = 3200) {
    const t = $('#hint-toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  alert(on) {
    $('#alert-overlay').classList.toggle('on', on);
  }
  glitch() {
    const g = $('#glitch-overlay');
    g.classList.remove('on');
    void g.offsetWidth;
    g.classList.add('on');
  }

  // ---------------------------------------------------------------- terminal
  openTerminal(res) {
    const S = this.S;
    if (!res?.ok) { this.toast(res?.error || 'Uplink failed.'); return; }
    this.term = res;
    const m = $('#terminal');
    m.classList.remove('hidden');
    $('#terminal .term-title').textContent = `// UPLINK: ${res.name.toUpperCase()}`;
    const p = S.world.terminals[res.id];
    $('#terminal .term-meta').textContent = `${res.type.toUpperCase()} · SECTOR ${sectorName(p.x, p.y)}${res.hackedBy ? ` · cracked by ${res.hackedBy} team${res.hackedBy > 1 ? 's' : ''}` : ''}`;
    const form = $('#terminal .term-form'), foot = $('#terminal .term-foot'), result = $('#terminal .term-result'), hint = $('#terminal .term-hint');
    result.classList.add('hidden');
    result.classList.remove('denied');
    hint.classList.add('hidden');
    $('#terminal .term-status').textContent = '';
    $('#terminal .term-status').classList.remove('err');
    this.G.sfx.play('open');
    if (res.status === 'hacked') {
      this.typeText('ACCESS ALREADY GRANTED.\nLetter recovered by your cell.' + (res.reward ? `\n\n${res.reward}` : ''));
      form.classList.add('hidden'); foot.classList.add('hidden');
      this.showFragment(res.fragment, 'Letter secured', false);
    } else if (res.status === 'locked' || res.status === 'encrypted') {
      if (res.status === 'encrypted') this.G.sfx.play('fail');
      this.typeText(res.message);
      form.classList.add('hidden'); foot.classList.add('hidden');
    } else {
      form.classList.remove('hidden'); foot.classList.remove('hidden');
      this.typeText(res.prompt);
      if (res.hint) { hint.textContent = `HINT: ${res.hint}`; hint.classList.remove('hidden'); }
      const hb = $('#terminal .term-hint-btn');
      hb.disabled = !!res.hint;
      hb.textContent = res.hint ? 'Hint unlocked' : res.hintCost ? `Buy hint (−${res.hintCost} pts)` : 'Get hint (free for Hackers)';
      this.hintConfirm = false;
      const input = $('#terminal .term-input');
      input.value = '';
      if (!document.body.classList.contains('touch')) setTimeout(() => input.focus(), 350);
      this.applyLock(res.lockUntil);
    }
    // challenges without a keyboard: the two-key vault and the beacon relay
    const act = this.termAction();
    act.classList.add('hidden');
    if (res.status === 'open' && res.kind && res.kind !== 'text') {
      form.classList.add('hidden');
      const st = $('#terminal .term-status');
      if (res.kind === 'beacons') {
        act.classList.remove('hidden');
        act.textContent = res.run ? 'RUN IN PROGRESS: GO!' : 'START THE RUN';
        act.disabled = !!res.run;
        act.onclick = () => {
          act.disabled = true;
          this.G.socket.emit('term:start', { id: res.id }, (r) => {
            if (!r?.ok) { st.textContent = r?.error || 'Error'; st.classList.add('err'); act.disabled = false; return; }
            this.G.sfx.play('go');
            this.closeTerminal();
            this.announce('BEACON RUN', 'Touch the green beacons in order: they are on your map', PAL.green);
          });
        };
      } else st.textContent = 'Waiting for both consoles. The second one is marked on your map in amber.';
    }
    this.updateInputLock();
  }

  termAction() {
    let b = $('#terminal .term-action');
    if (!b) { b = el('button', 'term-action hidden'); b.type = 'button'; $('#terminal .term-form').after(b); }
    return b;
  }

  // the Core uploads in progress, for everyone: whose, how far, and whether it's running
  renderUploads(list) {
    let bar = $('#upload-bar');
    if (!bar) { bar = el('div'); bar.id = 'upload-bar'; document.body.append(bar); }
    bar.classList.toggle('hidden', !list?.length);
    const html = (list || []).map((u) => {
      const t = this.S.teams[u.team] || {}, pct = Math.floor(u.p * 100);
      const st = u.state === 'running' ? 'UPLOADING' : u.state === 'contested' ? 'CONTESTED' : 'STALLED · ring empty';
      return `<div class="up ${u.state}" style="--c:${t.color}"><b>${t.name || ''}</b><span class="track"><i style="width:${pct}%"></i></span><em>${pct}% · ${st}</em></div>`;
    }).join('');
    if (bar._h !== html) { bar._h = html; bar.innerHTML = html; }
  }

  // a word that only exists when the simulation slips
  glitchWord(word) {
    const w = el('div', 'glitch-word', word);
    w.style.left = `${15 + Math.random() * 55}%`; w.style.top = `${20 + Math.random() * 45}%`;
    document.body.append(w);
    setTimeout(() => w.remove(), 1300);
  }

  typeText(text) {
    const pre = $('#terminal .term-prompt');
    pre.textContent = '';
    const job = { skip: false };
    this.typing = job;
    let i = 0;
    const step = () => {
      if (this.typing !== job) return;
      i = job.skip ? text.length : Math.min(text.length, i + 3);
      pre.textContent = text.slice(0, i);
      if (i % 9 < 3) this.G.sfx.play('type');
      if (i < text.length) requestAnimationFrame(step); else this.typing = null;
    };
    step();
  }

  applyLock(until) {
    const btn = $('#terminal .term-form button');
    const st = $('#terminal .term-status');
    const left = (until || 0) - this.G.serverNow();
    if (left <= 0) { btn.disabled = false; return; }
    btn.disabled = true;
    st.classList.add('err');
    const tick = () => {
      const l = until - this.G.serverNow();
      if (l <= 0 || !this.term) { btn.disabled = false; st.textContent = ''; st.classList.remove('err'); return; }
      st.textContent = `ICE countermeasure: ${Math.ceil(l / 1000)}s`;
      setTimeout(tick, 200);
    };
    tick();
  }

  submitAnswer() {
    const t = this.term;
    const input = $('#terminal .term-input');
    const v = input.value.trim();
    if (!t || !v) return;
    const btn = $('#terminal .term-form button');
    btn.disabled = true;
    this.G.socket.emit('term:answer', { id: t.id, answer: v }, (res) => {
      btn.disabled = false;
      const st = $('#terminal .term-status');
      if (!res?.ok) { st.textContent = res?.error || 'Error'; st.classList.add('err'); if (res?.lockUntil) this.applyLock(res.lockUntil); return; }
      if (res.correct) {
        this.G.sfx.play('success');
        $('#terminal .term-form').classList.add('hidden');
        $('#terminal .term-foot').classList.add('hidden');
        this.showFragment(res.fragment, (res.first ? 'FIRST TEAM TO CRACK IT · +150' : 'Letter secured · +100') + ' · the uplink was loud — drones are coming', true, res.reward);
        setTimeout(() => { if (this.term === t) this.closeTerminal(); }, res.reward ? 7000 : 3600);
      } else {
        this.G.sfx.play('fail');
        const f = $('#terminal .term-form');
        f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
        input.select();
        st.textContent = 'ACCESS DENIED';
        st.classList.add('err');
        setTimeout(() => this.applyLock(res.lockUntil), 600);
      }
    });
  }

  showFragment(letter, sub, fresh, reward) {
    const r = $('#terminal .term-result');
    r.innerHTML = '';
    r.append(el('div', 'big', 'ACCESS GRANTED'));
    const f = el('div', 'frag', letter);
    if (!fresh) f.style.animation = 'none';
    r.append(el('br'), f, el('div', 'sub', sub));
    if (reward) r.append(el('div', 'reward', reward));
    r.classList.remove('hidden');
  }

  buyHint() {
    const t = this.term;
    if (!t) return;
    const hb = $('#terminal .term-hint-btn');
    if (t.hintCost && !this.hintConfirm) {
      this.hintConfirm = true;
      hb.textContent = `Confirm: spend ${t.hintCost} team points`;
      return;
    }
    hb.disabled = true;
    this.G.socket.emit('term:hint', { id: t.id }, (res) => {
      if (!res?.ok) { hb.disabled = false; return; }
      const h = $('#terminal .term-hint');
      h.textContent = `HINT: ${res.hint}`;
      h.classList.remove('hidden');
      hb.textContent = 'Hint unlocked';
    });
  }

  closeTerminal() {
    this.term = null;
    this.typing = null;
    $('#terminal').classList.add('hidden');
    document.activeElement?.blur?.();
    this.updateInputLock();
  }

  // ---------------------------------------------------------------- core
  openCore() {
    const S = this.S;
    const m = $('#core-modal');
    m.classList.remove('hidden');
    const n = S.team.hacked.length;
    const desc = $('#core-modal .core-desc');
    const st = $('#core-modal .core-status');
    st.textContent = ''; st.classList.remove('err');
    const btn = $('#core-form button');
    if (S.team.upload) {
      desc.textContent = 'Your exit code is uploading. It only runs while more of your cell stands inside the Core ring than anyone else. Hold it!';
      btn.disabled = true;
    } else if (S.phase !== 'playing') {
      desc.textContent = 'The Core is dormant. It wakes when the hunt begins.';
      btn.disabled = true;
    } else {
      desc.textContent = n >= S.coreMin
        ? `Your letters came out of the terminals scrambled. Rebuild the ${S.passLen}-letter code: use your letters below and guess the missing ones. A wrong code locks your whole team out for 45 seconds. The right one starts an upload you must defend at the Core.`
        : `The Core rejects incomplete cells. Recover at least ${S.coreMin} letters first (you have ${n}).`;
      btn.disabled = n < S.coreMin;
    }
    const slots = $('#core-slots');
    slots.innerHTML = '';
    $('#core-modal .core-pool')?.remove();
    const pool = el('div', 'core-pool');
    pool.append(el('span', 'label', 'YOUR LETTERS  '));
    for (const l of S.team.letters || []) pool.append(el('b', null, l));
    for (let i = (S.team.letters || []).length; i < S.passLen; i++) pool.append(el('b', 'missing', '?'));
    slots.parentNode.insertBefore(pool, slots);
    for (let i = 0; i < S.passLen; i++) {
      const inp = document.createElement('input');
      inp.maxLength = 1;
      inp.autocapitalize = 'characters';
      inp.setAttribute('aria-label', `Letter ${i + 1}`);
      inp.addEventListener('input', () => {
        inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (inp.value && inp.nextElementSibling) inp.nextElementSibling.focus();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && inp.previousElementSibling) inp.previousElementSibling.focus();
      });
      slots.append(inp);
    }
    this.G.sfx.play('open');
    const lock = S.team.coreLockUntil - this.G.serverNow();
    if (lock > 0) { st.textContent = `Core lockout: ${Math.ceil(lock / 1000)}s`; st.classList.add('err'); }
    const firstEmpty = [...slots.children].find((i) => !i.value);
    if (firstEmpty && !document.body.classList.contains('touch')) setTimeout(() => firstEmpty.focus(), 300);
    this.updateInputLock();
  }

  submitCore() {
    const code = [...document.querySelectorAll('#core-slots input')].map((i) => i.value || '?').join('');
    const st = $('#core-modal .core-status');
    if (code.includes('?')) { st.textContent = 'Fill every letter.'; st.classList.add('err'); return; }
    this.G.socket.emit('core:submit', { code }, (res) => {
      if (!res?.ok) { st.textContent = res?.error || 'Error'; st.classList.add('err'); return; }
      if (res.correct) {
        this.closeCore();
        this.G.sfx.play('breach');
        this.announce('UPLOAD STARTED', `Hold the Core ring for ${res.seconds || 90}s${res.seconds > 90 ? ' (crack more terminals to speed it up)' : ''}. NEXUS is sending everything.`, PAL.green);
      }
      else {
        this.G.sfx.play('fail');
        this.glitch();
        st.textContent = 'OVERRIDE REJECTED. Your cell is locked out for 45 seconds.';
        st.classList.add('err');
      }
    });
  }

  closeCore() {
    $('#core-modal').classList.add('hidden');
    document.activeElement?.blur?.();
    this.updateInputLock();
  }

  closeAll() {
    this.closeTerminal();
    this.closeCore();
    this.closePanels();
    this.toggleMap(false);
  }

  // ---------------------------------------------------------------- end screen
  showEnd(st) {
    if (!st) return;
    const S = this.S;
    const box = $('#endscreen');
    box.innerHTML = '';
    box.append(el('h1', null, 'SIMULATION TERMINATED'));
    if (st.ending) {
      const story = el('div', 'ending');
      st.ending.forEach((line, i) => { const p = el('p', null, line); p.style.animationDelay = `${0.6 + i * 1.6}s`; story.append(p); });
      box.append(story);
    }
    const pass = el('div', 'pass', 'THE PASSPHRASE WAS ');
    pass.append(el('b', null, st.passphrase));
    box.append(pass);
    const pod = el('div', 'podium');
    const order = [1, 0, 2].filter((i) => st.teams[i]);
    const heights = { 0: 190, 1: 140, 2: 100 };
    for (const i of order) {
      const t = st.teams[i];
      const p = el('div', 'pod');
      p.style.setProperty('--c', t.color);
      p.append(el('div', 'nm', t.name), el('div', 'sc', `${t.score} pts${t.breachRank ? ' · breached' : ''}`));
      const bar = el('div', 'bar', String(i + 1));
      bar.style.height = heights[i] + 'px';
      p.append(bar);
      pod.append(p);
    }
    box.append(pod);
    if (st.teams.length > 3) {
      const rest = el('div', 'mvp');
      st.teams.slice(3).forEach((t, i) => {
        const r = el('div', 'mvp-row');
        r.append(el('span', null, `${i + 4}. ${t.name}`), el('span', null, `${t.score} pts`));
        r.firstChild.style.color = t.color;
        rest.append(r);
      });
      box.append(rest);
    }
    const mvp = el('div', 'mvp');
    mvp.append(el('h3', null, 'TOP AGENTS'));
    for (const p of st.players) {
      const r = el('div', 'mvp-row');
      const n = el('span', null, p.name);
      n.style.color = S.teamColors[p.team];
      r.append(n, el('span', null, `${p.score} pts · ${p.hacks} hacks · caught ${p.caught}×`));
      mvp.append(r);
    }
    box.append(mvp);
    const b = el('button', 'ghost', 'Keep exploring');
    b.addEventListener('click', () => box.classList.add('hidden'));
    box.append(b);
    box.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- intro / join
  async runIntro(lobby, onJoin, quick) {
    const intro = $('#intro');
    intro.classList.remove('hidden');
    const boot = $('#boot');
    const lines = [
      ['> HALCYON CITY GRID ........ ', 'NOMINAL', 'warn'],
      ['> WEATHER: RAIN. SUNRISE: NOT SCHEDULED.'],
      ['> 12 TERMINALS STILL HOLD SALIM AMRI\'S CODE, ONE LETTER EACH.'],
      ['> NEXUS HUNTS ANYONE THE HUSH COULD NOT TOUCH.'],
      ['> THE WAKEFUL ARE ASSEMBLING ', 'NOW', 'hi'],
    ];
    if (!quick) {
      let skip = false;
      const sk = () => { skip = true; };
      intro.addEventListener('pointerdown', sk, { once: true });
      addEventListener('keydown', sk, { once: true });
      for (const [a, b, cls] of lines) {
        const line = el('div');
        boot.append(line);
        for (let i = 0; i <= a.length; i++) {
          line.textContent = a.slice(0, i);
          if (!skip) await new Promise((r) => setTimeout(r, 22));
        }
        if (b) { line.append(el('span', cls, b)); }
        if (!skip) await new Promise((r) => setTimeout(r, 380));
      }
      if (!skip) await new Promise((r) => setTimeout(r, 600));
    }
    boot.classList.add('hidden');
    $('#join').classList.remove('hidden');
    this.buildJoin(lobby, onJoin);
  }

  buildJoin(lobby, onJoin) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('nexus_profile') || '{}'); } catch {}
    const name = $('#callsign');
    if (saved.name) name.value = saved.name;
    this.joinChoice = { squad: 'random', cls: CLASSES[saved.cls] ? saved.cls : 'runner' };
    document.querySelectorAll('#squad-list .card').forEach((c) => c.addEventListener('click', () => {
      this.joinChoice.squad = c.dataset.mode; this.syncJoinCards(); this.G.sfx.play('click');
      if (c.dataset.mode === 'join') setTimeout(() => $('#squad-code').focus(), 0);
    }));
    const cl = $('#class-list');
    cl.innerHTML = '';
    const previews = [];
    for (const [key, c] of Object.entries(CLASSES)) {
      const card = el('button', 'card class');
      card.type = 'button';
      card.dataset.cls = key;
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      previews.push({ cv, key });
      const info = el('div');
      info.append(el('div', 't', c.name), el('div', 'd', c.desc));
      card.append(cv, info, this.classSheet(key));
      card.addEventListener('click', () => { this.joinChoice.cls = key; this.syncJoinCards(); this.G.sfx.play('click'); });
      cl.append(card);
    }
    this.syncJoinCards();
    const anim = (ts) => {
      if ($('#intro').classList.contains('hidden')) return;
      const t = ts / 1000;
      const col = PAL.cyan;
      for (const { cv, key } of previews) {
        const g = cv.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, 128, 128);
        const sel = key === this.joinChoice.cls;
        drawPlayer(g, 64, 64, sel ? -Math.PI / 2 + Math.sin(t * 1.5) * 0.4 : -Math.PI / 2, col, key, t, { moving: sel, walk: t * 10, sprint: sel && key === 'runner' && Math.sin(t) > 0.5, scale: 2.6 });
      }
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    $('#join-form').onsubmit = (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { $('#join-error').textContent = 'Pick a callsign.'; name.focus(); return; }
      const code = $('#squad-code').value.trim();
      if (this.joinChoice.squad === 'join' && !code) { $('#join-error').textContent = 'Type the squad code your friend got (e.g. RAVEN-42).'; $('#squad-code').focus(); return; }
      $('#join-btn').disabled = true;
      $('#join-error').textContent = '';
      try { localStorage.setItem('nexus_profile', JSON.stringify({ name: n, cls: this.joinChoice.cls })); } catch {}
      onJoin({ name: n, cls: this.joinChoice.cls, squad: { mode: this.joinChoice.squad, code, open: $('#squad-open input').checked } });
    };
    if (!name.value) setTimeout(() => name.focus(), 100);
  }

  // a class's full stat sheet: bars with real numbers, ability, perks, weak spot (join cards and field manual)
  classSheet(key) {
    const c = CLASSES[key], box = el('div', 'cls-sheet');
    for (const s of classStats(key)) {
      const row = el('div', 'cls-stat');
      const bar = el('div', 'cls-bar'), fill = el('i');
      fill.style.width = `${Math.round(Math.min(1, s.k) * 100)}%`;
      bar.append(fill);
      row.append(el('span', 'l', s.label), bar, el('span', 'v', s.value));
      box.append(row);
    }
    const ab = el('div', 'cls-ab');
    ab.append(el('b', null, `${c.ability}`), el('span', null, ` (Space, every ${c.cd / 1000} s): ${c.abilityDesc}`));
    box.append(ab);
    const ul = el('ul', 'cls-perks');
    for (const t of c.perks || []) ul.append(el('li', null, t));
    if (c.weak) ul.append(el('li', 'weak', c.weak));
    box.append(ul);
    return box;
  }

  syncJoinCards() {
    if (!this.joinChoice) return;
    document.querySelectorAll('#squad-list .card').forEach((c) => c.classList.toggle('sel', c.dataset.mode === this.joinChoice.squad));
    $('#squad-code').hidden = this.joinChoice.squad !== 'join';
    $('#squad-open').hidden = this.joinChoice.squad !== 'create';
    document.querySelectorAll('#class-list .card').forEach((c) => c.classList.toggle('sel', c.dataset.cls === this.joinChoice.cls));
  }

  joinError(msg) {
    $('#join-btn').disabled = false;
    $('#join-error').textContent = msg;
  }

  hideIntro() { $('#intro').classList.add('hidden'); }
}
