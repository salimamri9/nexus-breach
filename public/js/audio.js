// Audio: sampled SFX (Kenney CC0), positional loops, synthesised rain/wind and an adaptive
// procedural score whose layers swell with danger.
const SAMPLES = [
  ...[0, 1, 2, 3, 4].flatMap((i) => [`step_concrete_${i}`, `step_grass_${i}`]),
  'computer_0', 'computer_1', 'computer_2', 'computer_3', 'glitch_1', 'glitch_2', 'glitch_3', 'glitch_4',
  'drone_loop', 'core_loop', 'boom', 'crunch', 'emp', 'scan', 'sprint', 'success', 'pickup', 'fail', 'click', 'select', 'open', 'close', 'pluck', 'metal', 'ping',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.intensity = 0;
    this.scene = 'menu';
    try { this.muted = localStorage.getItem('nexus_muted') === '1'; } catch { this.muted = false; }
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
    // city reverb
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(2.8, 2.2);
    this.verbSend = c.createGain(); this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb); this.verb.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ambience();
    this.startMusic();
    this.setScene(this.scene, 0.01);
    for (const n of SAMPLES) {
      fetch(`/assets/audio/${n}.mp3`).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a)).then((b) => { this.buf[n] = b; }).catch(() => {});
    }
  }

  // What's audible depends on where you are: the city's rain only plays in the city, and the
  // prologue gets a silent stage for its own narration and score.
  setScene(scene, fade = 1.2) {
    this.scene = scene;
    if (!this.ctx) return;
    const LEVELS = { game: [0.9, 0.55], menu: [0, 0.4], cinematic: [0, 0], end: [0.3, 0.45] };
    const [amb, music] = LEVELS[scene] || LEVELS.menu;
    const t = this.ctx.currentTime;
    this.ambBus.gain.setTargetAtTime(amb, t, fade / 3);
    this.musicBus.gain.setTargetAtTime(music, t, fade / 3);
  }

  impulse(sec, decay) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay; }
    return b;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('nexus_muted', m ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- spatial
  setListener(cam) {
    const l = this.ctx?.listener;
    if (!l) return;
    const p = cam.position, e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.05); l.positionY.setTargetAtTime(p.y, t, 0.05); l.positionZ.setTargetAtTime(p.z, t, 0.05);
      l.forwardX.setTargetAtTime(fx, t, 0.05); l.forwardY.setTargetAtTime(fy, t, 0.05); l.forwardZ.setTargetAtTime(fz, t, 0.05);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  // top-down: the listener stands on the player, screen-up is "forward"
  setListener2D(x, z) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.05); l.positionY.setTargetAtTime(1.6, t, 0.05); l.positionZ.setTargetAtTime(z, t, 0.05);
      l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(x, 1.6, z); l.setOrientation(0, 0, -1, 0, 1, 0); }
  }

  panner(pos, ref = 4, max = 80) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.3;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  sample(name, { vol = 1, rate = 1, pos = null, ref = 4, verb = 0.25, at = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const b = this.buf[name];
    if (!b) return;
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = b; s.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(g);
    let out = g;
    if (pos) { const p = this.panner(pos, ref); g.connect(p); out = p; }
    out.connect(this.sfxBus);
    if (verb) { const v = c.createGain(); v.gain.value = verb; out.connect(v); v.connect(this.verbSend); }
    s.start(c.currentTime + at);
  }

  loop(name, pos, vol = 0.5) {
    if (!this.ctx || !this.buf[name]) return null;
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = this.buf[name]; s.loop = true;
    const g = c.createGain(); g.gain.value = 0;
    const p = this.panner(pos, 5, 90);
    s.connect(g); g.connect(p); p.connect(this.sfxBus);
    s.start();
    g.gain.setTargetAtTime(vol, c.currentTime, 0.4);
    return {
      src: s, gain: g, pan: p,
      set(x, y, z, v, rate) {
        const t = c.currentTime;
        if (p.positionX) { p.positionX.setTargetAtTime(x, t, 0.05); p.positionY.setTargetAtTime(y, t, 0.05); p.positionZ.setTargetAtTime(z, t, 0.05); }
        g.gain.setTargetAtTime(v, t, 0.2);
        s.playbackRate.setTargetAtTime(rate, t, 0.3);
      },
      stop() { g.gain.setTargetAtTime(0, c.currentTime, 0.2); s.stop(c.currentTime + 1); },
    };
  }

  // one boot step, layered per surface: 'wet' (rainy street), 'concrete' (indoors), 'grass', 'rubble', 'mud'
  footstep(surface, vol, pos) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime, r = () => Math.random();
    const g = c.createGain(); g.gain.value = vol;
    let out = g;
    if (pos) { const p = this.panner(pos, 2); g.connect(p); out = p; }
    out.connect(this.sfxBus);
    const v = c.createGain(); v.gain.value = surface === 'concrete' ? 0.35 : 0.1; out.connect(v); v.connect(this.verbSend);
    // play part of a buffer through a filter into the step bus
    const layer = (buf, { rate = 1, gain = 1, type = 'lowpass', f = 20000, q = 0.7, dur = null, at = 0, offset = 0 }) => {
      if (!buf) return;
      const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const e = c.createGain(); e.gain.value = gain;
      s.connect(fl); fl.connect(e); e.connect(g);
      if (dur) { e.gain.setValueAtTime(gain, t0 + at + dur * 0.6); e.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur); }
      s.start(t0 + at, offset); s.stop(t0 + at + (dur || buf.duration / rate) + 0.02);
    };
    const pick = (n) => this.buf[`${n}_${Math.floor(r() * 5)}`];
    // heel: a pitched-down, muffled hard-floor step reads as a heavy boot
    const heel = surface === 'grass' || surface === 'mud' ? 0.45 : 0.8;
    layer(pick('step_concrete'), { rate: 0.6 + r() * 0.12, gain: heel, f: surface === 'concrete' ? 2600 : 1500 });
    // surface texture from real recordings only: synthetic noise read as a harsh "tch"
    if (surface === 'wet') {
      // a soft slap on a wet street: a grass step pitched down and muffled sounds like shallow water
      layer(pick('step_grass'), { rate: 0.7 + r() * 0.1, gain: 0.32, f: 1600, dur: 0.22, at: 0.01 });
    } else if (surface === 'grass') {
      layer(pick('step_grass'), { rate: 1 + r() * 0.15, gain: 0.8, dur: 0.24, f: 7000 });
    } else if (surface === 'rubble') {
      layer(this.buf.crunch, { rate: 1.1 + r() * 0.2, gain: 0.3, f: 3000, dur: 0.16, offset: r() * 0.1 });
    } else if (surface === 'mud') {
      layer(pick('step_grass'), { rate: 0.55 + r() * 0.08, gain: 0.55, f: 900, dur: 0.26 });
    }
  }

  // ---------------------------------------------------------------- synth helpers
  tone({ type = 'sine', f = 440, f2 = null, dur = 0.15, vol = 0.2, at = 0, attack = 0.005, bus = null }) {
    const c = this.ctx, t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.2, f = 1200, f2 = null, type = 'bandpass', at = 0, q = 1, bus = null }) {
    const c = this.ctx, t0 = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(bus || this.sfxBus);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  ambience() {
    const c = this.ctx;
    // Rain from 8 s of pink noise (no audible loop, no white-noise hiss), shaped soft and wide,
    // plus scattered droplets close by. Wind is slowly swept brown noise.
    const len = c.sampleRate * 8, pink = c.createBuffer(2, len, c.sampleRate), brown = c.createBuffer(1, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = pink.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      }
    }
    const bd = brown.getChannelData(0);
    for (let i = 0, last = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    const loop = (buf, type, f, q, v) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = v;
      s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start(0, Math.random() * 8);
      return fl;
    };
    loop(pink, 'lowpass', 2200, 0.4, 0.22);     // the body of the rain
    loop(pink, 'bandpass', 5200, 0.6, 0.05);    // a faint, distant sizzle on the asphalt
    const wind = loop(brown, 'lowpass', 380, 2.5, 0.5);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.05; lg.gain.value = 200;
    lfo.connect(lg); lg.connect(wind.frequency); lfo.start();
    // droplets: tiny pitched ticks on nearby surfaces
    this.dripTimer = setInterval(() => {
      if (this.scene !== 'game' || this.ctx.state !== 'running') return;
      for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.5) continue;
        const t = c.currentTime + Math.random() * 0.25, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner();
        o.type = 'sine'; o.frequency.setValueAtTime(1800 + Math.random() * 2600, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.03);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012 + Math.random() * 0.02, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        p.pan.value = Math.random() * 2 - 1;
        o.connect(g); g.connect(p); p.connect(this.ambBus); o.start(t); o.stop(t + 0.06);
      }
    }, 120);
  }

  // ---------------------------------------------------------------- adaptive score
  startMusic() {
    const c = this.ctx;
    this.layers = {};
    for (const k of ['pad', 'bass', 'arp', 'perc']) { const g = c.createGain(); g.gain.value = k === 'pad' ? 0.5 : 0; g.connect(this.musicBus); this.layers[k] = g; }
    const v = c.createGain(); v.gain.value = 0.5; this.musicBus.connect(v); v.connect(this.verbSend);
    // D minor: i – VI – III – VII
    this.chords = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
    this.bpm = 72;
    this.step = 0;
    this.nextT = c.currentTime + 0.2;
    this.musicTimer = setInterval(() => this.schedule(), 100);
  }

  setIntensity(x) {
    if (!this.ctx) return;
    this.intensity += (x - this.intensity) * 0.08;
    const i = this.intensity, t = this.ctx.currentTime;
    this.layers.bass.gain.setTargetAtTime(Math.min(1, i * 2.2) * 0.55, t, 0.5);
    this.layers.arp.gain.setTargetAtTime(Math.max(0, i - 0.3) * 0.5, t, 0.5);
    this.layers.perc.gain.setTargetAtTime(Math.max(0, i - 0.55) * 1.3, t, 0.3);
    this.bpm = 72 + i * 30;
  }

  schedule() {
    const c = this.ctx;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextT < c.currentTime + 0.25) {
      const s = this.step, t = this.nextT;
      const chord = this.chords[Math.floor(s / 32) % 4];
      const hz = (m) => 440 * 2 ** ((m - 69) / 12);
      if (s % 32 === 0) for (const m of chord) this.pad(hz(m), t, sixteenth * 32);
      if (s % 2 === 0) this.voice({ type: 'sawtooth', f: hz(chord[0] - 24), at: t, dur: sixteenth * 1.8, vol: 0.16, cutoff: 260, bus: this.layers.bass });
      if (this.intensity > 0.3) {
        const arp = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2] + 12, chord[0] + 12];
        this.voice({ type: 'square', f: hz(arp[s % arp.length] + 12), at: t, dur: sixteenth * 0.9, vol: 0.05, cutoff: 1800, bus: this.layers.arp });
      }
      // heartbeat when you're being hunted
      if (this.intensity > 0.75 && s % 4 === 0) {
        this.voice({ type: 'sine', f: 52, f2: 40, at: t, dur: 0.16, vol: 0.35, cutoff: 200, bus: this.musicBus });
        this.voice({ type: 'sine', f: 48, f2: 38, at: t + 0.18, dur: 0.14, vol: 0.22, cutoff: 200, bus: this.musicBus });
      }
      if (this.intensity > 0.55) {
        if (s % 4 === 0) { this.voice({ type: 'sine', f: 110, f2: 38, at: t, dur: 0.25, vol: 0.5, cutoff: 400, bus: this.layers.perc }); }
        if (s % 2 === 1) this.noise({ dur: 0.04, vol: 0.06, f: 8000, type: 'highpass', at: t - c.currentTime, bus: this.layers.perc });
      }
      this.step++;
      this.nextT += sixteenth;
    }
  }

  pad(f, t, dur) {
    for (const det of [-7, 0, 6]) this.voice({ type: 'sawtooth', f: f * 2 ** (det / 1200), at: t, dur, vol: 0.028, cutoff: 700, attack: 1.8, bus: this.layers.pad });
  }

  voice({ type, f, f2, at, dur, vol, cutoff, attack = 0.01, bus }) {
    const c = this.ctx;
    const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
    fl.type = 'lowpass'; fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(fl); fl.connect(g); g.connect(bus);
    o.start(at); o.stop(at + dur + 0.05);
  }

  // ---------------------------------------------------------------- named events
  // map px position → listener space (metres; the 2D view uses the same space, looking down)
  at(p) { return p ? { x: p.x / 21.333, y: 1.2, z: p.y / 21.333 } : null; }

  // a car alarm: two-tone whoop at the car for `ms`
  carAlarm(p, ms) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime, end = t0 + Math.min(14, ms / 1000);
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 2400;
    for (let t = t0, i = 0; t < end; t += 0.32, i++) o.frequency.setValueAtTime(i % 2 ? 720 : 960, t);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.05);
    g.gain.setValueAtTime(0.22, end - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, end);
    const pan = this.panner(this.at(p), 6, 140);
    o.connect(lp); lp.connect(g); g.connect(pan); pan.connect(this.sfxBus);
    const v = c.createGain(); v.gain.value = 0.5; pan.connect(v); v.connect(this.verbSend);
    o.start(t0); o.stop(end + 0.05);
  }

  // the Hush: NEXUS's one cold tone, beating against itself and throbbing, rolled through the city
  lullaby(ms) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + 0.1, dur = ms / 1000, end = t0 + dur;
    const bus = c.createGain(); bus.connect(this.musicBus);
    bus.gain.setValueAtTime(0.0001, t0); bus.gain.exponentialRampToValueAtTime(1, t0 + 1.5);
    bus.gain.setValueAtTime(1, end - 2); bus.gain.exponentialRampToValueAtTime(0.0001, end);
    const v = c.createGain(); v.gain.value = 0.7; bus.connect(v); v.connect(this.verbSend);
    // slow amplitude throb
    const trem = c.createGain(); trem.gain.value = 0.6; trem.connect(bus);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.8; lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(trem.gain); lfo.start(t0); lfo.stop(end);
    for (const [f, type, vol] of [[110, 'sine', 0.16], [110.7, 'sine', 0.12], [55, 'sine', 0.14], [220.4, 'triangle', 0.025], [1760, 'sine', 0.006]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f; g.gain.value = vol;
      o.connect(g); g.connect(trem); o.start(t0); o.stop(end + 0.1);
    }
  }

  // NEXUS speaks: browser speech, pitched down and slowed (a machine wearing a voice), over a low drone and a glitch
  nexusVoice(text) {
    if (!this.ctx || this.muted) return;
    this.sample(pick(['glitch_1', 'glitch_3']), { vol: 0.35, verb: 0.3 });
    this.tone({ type: 'sine', f: 55, dur: 2.5, vol: 0.12, attack: 0.4, bus: this.musicBus });
    const synth = window.speechSynthesis;
    if (!synth || this.voiceOff) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\{|\}/g, ''));
      const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
      u.voice = voices.find((v) => /male|david|mark|guy|ryan|daniel|george/i.test(v.name) && !/female/i.test(v.name)) || voices[0] || null;
      u.pitch = 0.55; u.rate = 0.82; u.volume = 0.85;
      synth.speak(u);
    } catch {}
  }

  play(name, pos) {
    if (!this.ctx || this.muted) return;
    const P = this.at(pos);
    switch (name) {
      case 'powerdown':
        this.tone({ type: 'sawtooth', f: 240, f2: 28, dur: 1.4, vol: 0.12 });
        this.noise({ dur: 1.2, vol: 0.25, f: 900, f2: 60, type: 'lowpass' });
        this.sample('metal', { vol: 0.5, rate: 0.7, pos: P, verb: 0.5 });
        break;
      case 'camAlert': for (let i = 0; i < 3; i++) this.tone({ type: 'square', f: 1760, dur: 0.07, vol: 0.05, at: i * 0.14 }); break;
      case 'simGlitch': this.sample(['glitch_1', 'glitch_2', 'glitch_3'][Math.floor(Math.random() * 3)], { vol: 0.5, verb: 0.3 }); this.tone({ type: 'square', f: 70, dur: 0.12, vol: 0.04 }); break;
      case 'jam': this.sample('glitch_4', { vol: 0.6, verb: 0 }); this.noise({ dur: 0.4, vol: 0.2, f: 3000, type: 'bandpass' }); break;
      case 'flyover': this.noise({ dur: 5, vol: 0.28, f: 120, f2: 420, type: 'lowpass', q: 2 }); this.noise({ dur: 5, vol: 0.12, f: 420, f2: 90, type: 'lowpass', at: 2.5 }); break;
      case 'thud': this.sample('boom', { vol: 0.9, rate: 0.6, pos: P, verb: 0.6 }); this.sample('crunch', { vol: 0.5, pos: P }); break;
      case 'siren':
        for (let i = 0; i < 2; i++) { this.tone({ type: 'sawtooth', f: 280, f2: 620, dur: 1.6, vol: 0.05, at: i * 3.2, attack: 0.6 }); this.tone({ type: 'sawtooth', f: 620, f2: 280, dur: 1.6, vol: 0.05, at: i * 3.2 + 1.6, attack: 0.05 }); }
        break;
      case 'taken': this.tone({ type: 'sine', f: 300, f2: 1400, dur: 1.2, vol: 0.07 }); this.sample('glitch_2', { vol: 0.5, pos: P }); break;
      case 'radio': this.noise({ dur: 0.18, vol: 0.18, f: 2200, type: 'bandpass', q: 0.8 }); this.sample('click', { vol: 0.4, rate: 0.8, verb: 0 }); break;
      case 'murmur': this.noise({ dur: 0.5, vol: 0.06, f: 500, type: 'bandpass', q: 2 }); break;
      case 'echo': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 2.2, vol: 0.035, at: i * 0.12, attack: 0.3 })); this.sample('scan', { vol: 0.3, rate: 0.6, verb: 0.8 }); break;
      case 'error': this.sample('fail', { vol: 0.3, verb: 0 }); break;
      case 'tarp': this.noise({ dur: 0.5, vol: 0.25, f: 1800, f2: 600, type: 'bandpass', q: 0.7 }); break;
      case 'whoosh': this.noise({ dur: 0.35, vol: 0.18, f: 600, f2: 2400, type: 'bandpass', q: 1.2 }); break;
      case 'glass':
        this.sample('crunch', { vol: 0.6, rate: 1.9, pos: P, verb: 0.5 });
        for (let i = 0; i < 6; i++) this.tone({ type: 'triangle', f: 2400 + Math.random() * 3200, dur: 0.12 + Math.random() * 0.2, vol: 0.03, at: Math.random() * 0.12 });
        break;
      case 'rewire': this.sample('glitch_1', { vol: 0.6, verb: 0 }); [440, 660, 990].forEach((f, i) => this.tone({ type: 'square', f, dur: 0.09, vol: 0.05, at: 0.1 + i * 0.09 })); break;
      case 'lullabyWarn': [0, 0.5, 1].forEach((at) => this.tone({ type: 'square', f: 880, dur: 0.18, vol: 0.035, at })); this.tone({ type: 'sine', f: 110, dur: 2.2, vol: 0.08, at: 1.4, attack: 0.4 }); break;
      case 'coreHit': this.sample('boom', { vol: 1, rate: 0.5, verb: 1 }); this.tone({ type: 'sawtooth', f: 880, f2: 55, dur: 2.5, vol: 0.08 }); this.sample('glitch_3', { vol: 0.8, verb: 0.4 }); break;
      case 'flap': for (let i = 0; i < 7; i++) this.noise({ dur: 0.07, vol: 0.12, f: 900 + Math.random() * 600, type: 'bandpass', q: 1.5, at: i * 0.06 + Math.random() * 0.03 }); break;
      case 'zap': this.noise({ dur: 0.12, vol: 0.12, f: 4000, type: 'highpass' }); this.tone({ type: 'square', f: 120, dur: 0.08, vol: 0.03 }); break;
      case 'click': this.sample('click', { vol: 0.5, verb: 0 }); break;
      case 'type': if (Math.random() < 0.5) this.sample('click', { vol: 0.15, rate: 1.6 + Math.random() * 0.4, verb: 0 }); break;
      case 'open': this.sample('open', { vol: 0.6, verb: 0 }); this.sample(`computer_${Math.floor(Math.random() * 4)}`, { vol: 0.35, verb: 0 }); break;
      case 'success':
        this.sample('success', { vol: 0.8, verb: 0.2 });
        [587, 740, 880, 1175].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 0.35, vol: 0.08, at: 0.1 + i * 0.08 }));
        break;
      case 'fail': this.sample('fail', { vol: 0.7, verb: 0 }); this.sample(pick(['glitch_1', 'glitch_2']), { vol: 0.4, verb: 0 }); break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone({ type: 'sawtooth', f: 700, f2: 1300, dur: 0.16, vol: 0.06, at: i * 0.18 });
        this.sample(pick(['glitch_3', 'glitch_4']), { vol: 0.6, verb: 0 });
        break;
      case 'pickup': this.sample('pluck', { vol: 0.7, rate: 1.2, verb: 0.1 }); this.sample('pickup', { vol: 0.35, rate: 1.4, verb: 0 }); break;
      case 'emp': this.sample('emp', { vol: 1, verb: 0.5 }); this.sample('boom', { vol: 0.6, rate: 1.3, verb: 0.5 }); break;
      case 'sprint': this.sample('sprint', { vol: 0.6, rate: 1.4, verb: 0 }); break;
      case 'scan': this.sample('scan', { vol: 0.8, verb: 0.4 }); break;
      case 'capture': this.sample('boom', { vol: 0.9, verb: 0.4 }); this.sample('glitch_2', { vol: 0.8, verb: 0 }); this.sample('crunch', { vol: 0.5 }); break;
      case 'breach':
        [262, 330, 392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'sawtooth', f, dur: 0.6, vol: 0.06, at: i * 0.07 }));
        this.sample('boom', { vol: 1, rate: 0.7, verb: 0.8 });
        break;
      case 'tick': this.sample('select', { vol: 0.6, verb: 0.2 }); break;
      case 'go': this.sample('boom', { vol: 1, rate: 0.8, verb: 0.7 }); this.tone({ type: 'sawtooth', f: 220, f2: 880, dur: 0.6, vol: 0.08 }); break;
      case 'discover': this.sample('select', { vol: 0.6, verb: 0.2 }); this.tone({ type: 'triangle', f: 1320, dur: 0.2, vol: 0.06, at: 0.08 }); break;
      case 'chat': this.sample('click', { vol: 0.3, rate: 1.4, verb: 0 }); break;
      case 'ping': this.sample('ping', { vol: 0.7, verb: 0.3 }); break;
      case 'thunder': this.noise({ dur: 3, vol: 0.32, f: 260, f2: 35, type: 'lowpass', at: 0.5 }); this.sample('boom', { vol: 0.5, rate: 0.5, verb: 1, at: 0.4 }); break;
      case 'announce': this.sample('open', { vol: 0.4, rate: 0.8, verb: 0.3 }); break;
    }
  }
}
