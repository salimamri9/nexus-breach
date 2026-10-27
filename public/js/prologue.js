// Elden-Ring-style prologue: slow Ken Burns stills, engraved subtitles, narration, a dark score.
// Content lives in /assets/prologue/prologue.json; images (01.jpg…) and voice (vo/01.mp3…) are optional.
const BASE = '/assets/prologue/';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const wait = (ms, job) => new Promise((r) => { const t = setTimeout(r, ms); job?.timers.push(t); });

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

// ---------------------------------------------------------------- score
class Score {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.0001;
    const verb = this.ctx.createConvolver();
    const n = this.ctx.sampleRate * 4, b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5; }
    verb.buffer = b;
    const wet = this.ctx.createGain(); wet.gain.value = 0.7;
    this.out.connect(this.ctx.destination); this.out.connect(wet); wet.connect(verb); verb.connect(this.ctx.destination);
    this.out.gain.exponentialRampToValueAtTime(0.7, this.ctx.currentTime + 4);
    this.chords = [[38, 45, 50, 53], [34, 41, 46, 50], [41, 48, 53, 57], [36, 43, 48, 52]];
    this.i = 0;
    this.loop = setInterval(() => this.chord(), 7000);
    this.chord();
  }
  hz(m) { return 440 * 2 ** ((m - 69) / 12); }
  // slow "choir": detuned saws through vowel formants
  chord() {
    const c = this.ctx, t = c.currentTime, notes = this.chords[this.i++ % 4];
    for (const m of notes) for (const det of [-9, 0, 8]) {
      const o = c.createOscillator(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = this.hz(m + 12) * 2 ** (det / 1200);
      f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 6;
      f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 8;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 3); g.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + 9);
    }
    const sub = c.createOscillator(), sg = c.createGain();
    sub.type = 'sine'; sub.frequency.value = this.hz(notes[0] - 12);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.25, t + 2); sg.gain.exponentialRampToValueAtTime(0.0001, t + 8);
    sub.connect(sg); sg.connect(this.out); sub.start(t); sub.stop(t + 8.5);
  }
  // war drum on shot changes
  hit(big) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(big ? 70 : 90, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.2);
    g.gain.setValueAtTime(big ? 0.9 : 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 1.7);
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
    s.buffer = nb; f.type = 'lowpass'; f.frequency.value = 900;
    ng.gain.setValueAtTime(big ? 0.4 : 0.2, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f); f.connect(ng); ng.connect(this.out); s.start(t);
  }
  stop() {
    clearInterval(this.loop);
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.8);
    setTimeout(() => this.ctx.close(), 4000);
  }
}

// ---------------------------------------------------------------- placeholder art
// Until real (AI-generated) stills exist, each shot gets a moody procedural painting.
function paint(mood, w = 1920, h = 1080) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = [...mood].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sky = g.createLinearGradient(0, 0, 0, h);
  const tint = { temple: '#1a0b22', swarm: '#220a0e', blackout: '#05060a', rain: '#081018', core: '#1c0620', terminals: '#06141a', cell: '#0c0a14', title: '#0a0510' }[mood] || '#0b0e18';
  sky.addColorStop(0, '#020205'); sky.addColorStop(0.7, tint); sky.addColorStop(1, '#000');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // haze glow on the horizon
  const glowCol = { temple: 'rgba(255,43,214,0.35)', swarm: 'rgba(255,42,74,0.3)', core: 'rgba(255,43,214,0.45)', terminals: 'rgba(34,225,255,0.3)', rain: 'rgba(90,140,200,0.2)', blackout: 'rgba(40,40,60,0.15)' }[mood] || 'rgba(255,170,90,0.22)';
  const hz = g.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, w * 0.6);
  hz.addColorStop(0, glowCol); hz.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hz; g.fillRect(0, 0, w, h);
  // skyline layers
  for (let layer = 0; layer < 3; layer++) {
    const base = h * (0.62 + layer * 0.1), shade = 6 + layer * 5;
    g.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
    for (let x = -20; x < w;) {
      const bw = 40 + rnd() * 120, bh = (mood === 'title' ? 0.5 : 1) * (60 + rnd() * rnd() * (420 - layer * 110));
      g.fillRect(x, base - bh, bw, h);
      if (mood !== 'blackout') {
        for (let wy = base - bh + 10; wy < base; wy += 14) for (let wx = x + 6; wx < x + bw - 6; wx += 12) {
          if (rnd() < (mood === 'skyline' ? 0.18 : 0.04)) { g.fillStyle = rnd() < 0.85 ? 'rgba(255,205,140,0.55)' : 'rgba(255,40,70,0.7)'; g.fillRect(wx, wy, 5, 7); g.fillStyle = `rgb(${shade},${shade},${shade + 6})`; }
        }
      }
      x += bw + rnd() * 10;
    }
  }
  const beam = (x, col, wd) => { const b = g.createLinearGradient(x - wd, 0, x + wd, 0); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(0.5, col); b.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = b; g.fillRect(x - wd, 0, wd * 2, h * 0.75); };
  if (mood === 'temple' || mood === 'core') {
    beam(w / 2, 'rgba(255,43,214,0.55)', mood === 'core' ? 60 : 30);
    g.fillStyle = '#050307';
    g.beginPath(); g.moveTo(w / 2 - 120, h * 0.78); g.lineTo(w / 2 - 30, h * 0.18); g.lineTo(w / 2 + 30, h * 0.18); g.lineTo(w / 2 + 120, h * 0.78); g.fill();
    g.strokeStyle = 'rgba(255,43,214,0.8)'; g.lineWidth = 3;
    for (const [y, r] of [[0.35, 160], [0.5, 220], [0.62, 140]]) { g.beginPath(); g.ellipse(w / 2, h * y, r, r * 0.18, 0, 0, Math.PI * 2); g.stroke(); }
    const eye = g.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, 60); eye.addColorStop(0, '#fff'); eye.addColorStop(0.3, '#ff2bd6'); eye.addColorStop(1, 'rgba(255,43,214,0)');
    g.fillStyle = eye; g.beginPath(); g.arc(w / 2, h * 0.3, 60, 0, Math.PI * 2); g.fill();
  }
  if (mood === 'swarm' || mood === 'rain' || mood === 'cell') {
    for (let i = 0; i < (mood === 'swarm' ? 160 : 14); i++) {
      const x = rnd() * w, y = h * (0.1 + rnd() * 0.45), r = 2 + rnd() * 3;
      const d = g.createRadialGradient(x, y, 0, x, y, r * 6); d.addColorStop(0, 'rgba(255,60,80,0.95)'); d.addColorStop(1, 'rgba(255,60,80,0)');
      g.fillStyle = d; g.beginPath(); g.arc(x, y, r * 6, 0, Math.PI * 2); g.fill();
      if (mood !== 'swarm' || rnd() < 0.1) { g.fillStyle = 'rgba(255,210,140,0.07)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 90, h * 0.85); g.lineTo(x + 90, h * 0.85); g.fill(); }
    }
  }
  if (mood === 'terminals') {
    for (let i = 0; i < 12; i++) {
      const x = w * (0.08 + (i / 11) * 0.84), y = h * (0.55 + Math.sin(i * 1.7) * 0.12);
      beam(x, 'rgba(34,225,255,0.25)', 8);
      const d = g.createRadialGradient(x, y, 0, x, y, 40); d.addColorStop(0, 'rgba(160,250,255,1)'); d.addColorStop(1, 'rgba(34,225,255,0)');
      g.fillStyle = d; g.beginPath(); g.arc(x, y, 40, 0, Math.PI * 2); g.fill();
    }
  }
  if (mood === 'cell') {
    for (let i = 0; i < 5; i++) {
      const x = w * (0.3 + i * 0.1), y = h * 0.9;
      g.fillStyle = 'rgba(255,240,210,0.08)'; g.beginPath(); g.moveTo(x, y - 120); g.lineTo(x + 380 - i * 160, h * 0.55); g.lineTo(x + 500 - i * 160, h * 0.75); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, y - 150, 16, 20, 0, 0, Math.PI * 2); g.fill(); g.fillRect(x - 26, y - 130, 52, 140);
    }
  }
  if (mood === 'rain' || mood === 'blackout' || mood === 'cell') {
    g.strokeStyle = 'rgba(160,190,230,0.12)'; g.lineWidth = 1;
    for (let i = 0; i < 900; i++) { const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y + 30); g.stroke(); }
  }
  // painterly grain
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

// ---------------------------------------------------------------- player
let active = null;

export const prologuePlaying = () => !!active;

export async function playPrologue({ onDone } = {}) {
  if (active) return;
  const job = (active = { timers: [], skip: false, audio: null });
  const data = await fetch(BASE + 'prologue.json', { cache: 'no-cache' }).then((r) => r.json());
  // browsers only allow sound once the page has been clicked: ask for that click first (admin replays to untouched tabs)
  if (!navigator.userActivation?.hasBeenActive) {
    const gate = el('div', 'pro-gate');
    gate.append(el('div', null, data.title), el('small', null, 'click to begin'));
    document.body.append(gate);
    await new Promise((r) => gate.addEventListener('pointerdown', r, { once: true }));
    gate.remove();
  }
  const root = el('div', 'prologue');
  const stage = el('div', 'pro-stage');
  const sub = el('div', 'pro-sub');
  const title = el('div', 'pro-title');
  const skip = el('button', 'pro-skip', 'Skip ▸');
  root.append(stage, el('div', 'pro-bar top'), el('div', 'pro-bar bottom'), sub, title, skip);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('on'));

  const score = new Score();
  const unlock = () => score.ctx.state === 'suspended' && score.ctx.resume().catch(() => {});   // started without a click (admin replay)
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  const finish = () => {
    if (job.done) return;
    job.done = true;
    job.timers.forEach(clearTimeout);
    job.audio?.pause();
    score.stop();
    removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock);
    root.classList.remove('on');
    setTimeout(() => root.remove(), 1500);
    active = null;
    onDone?.();
  };
  skip.addEventListener('click', finish);
  const onKey = (e) => { if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); finish(); removeEventListener('keydown', onKey); } };
  addEventListener('keydown', onKey);

  await wait(1800, job);
  for (const shot of data.shots) {
    if (job.done) return;
    const v = `?v=${data.version || 1}`;   // bump "version" in prologue.json after swapping art/voice
    const imgUrl = (await exists(`${BASE}${shot.id}.jpg${v}`)) ? `${BASE}${shot.id}.jpg${v}` : (await exists(`${BASE}${shot.id}.png${v}`)) ? `${BASE}${shot.id}.png${v}` : paint(shot.mood);
    const voUrl = `${BASE}vo/${shot.id}.mp3${v}`;
    // timing: follow the narration if recorded, otherwise reading speed
    let dur = shot.lines.join(' ').split(/\s+/).length / 2.3 * 1000 + 2600;
    // the voice goes through the score's Web Audio context (not an <audio> element): if the music plays, so does the voice
    const voice = await fetch(voUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => b && score.ctx.decodeAudioData(b)).catch((e) => { console.warn('[prologue] voice', shot.id, e); return null; });
    if (voice) dur = voice.duration * 1000 + 1800;
    if (job.done) return;
    const frame = el('div', `pro-frame move-${shot.move || 'in'}`);
    frame.style.backgroundImage = `url("${imgUrl}")`;
    frame.style.animationDuration = `${dur + 3000}ms`;
    stage.append(frame);
    requestAnimationFrame(() => frame.classList.add('on'));
    setTimeout(() => { while (stage.children.length > 2) stage.firstChild.remove(); }, 4000);
    score.hit(shot.title);
    if (voice && !job.done) {
      if (score.ctx.state === 'suspended') score.ctx.resume().catch(() => {});
      const src = score.ctx.createBufferSource(), g = score.ctx.createGain();
      src.buffer = voice; g.gain.value = 1;
      src.connect(g); g.connect(score.ctx.destination); src.start();
      job.audio = { pause: () => { try { src.stop(); } catch {} } };
    }

    sub.innerHTML = '';
    if (shot.title) {
      title.innerHTML = '';
      title.append(el('div', 'pro-title-main', data.title), el('div', 'pro-title-tag', data.tagline));
      job.timers.push(setTimeout(() => title.classList.add('on'), 1500));
    }
    const per = (dur - 1500) / shot.lines.length;
    shot.lines.forEach((line, i) => {
      job.timers.push(setTimeout(() => {
        const l = el('div', 'pro-line', line);
        sub.innerHTML = '';
        sub.append(l);
        requestAnimationFrame(() => l.classList.add('on'));
      }, 600 + i * per));
    });
    await wait(dur, job);
    sub.querySelector('.pro-line')?.classList.remove('on');
  }
  await wait(3500, job);
  finish();
}
