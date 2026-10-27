// Loads the baked sprite atlases and ground textures, and builds a few procedural sprites
// (drones, terminals, dead trees, soft glows) that are cheaper to draw than to bake.
import { PX } from '/shared/world.js';
import { texture } from './sprites.js';

export const TEX = {
  road: 'road_damaged', sidewalk: 'concrete_pavement', floor: 'dirty_concrete', rubble: 'rubble', grass: 'burned_ground_01',
  base: 'metal_plate', core: 'floor_tiles_06', wall: 'cracked_concrete_wall', plaster: 'damaged_plaster', facade: 'concrete_tile_facade',
  corrugated: 'rusty_corrugated_iron', mud: 'mud_cracked_dry_03',
};

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export class Assets2D {
  constructor() {
    this.tex = {};
    this.atlas = {};
    this.glows = new Map();
  }

  async load(onProgress) {
    const jobs = [];
    let done = 0;
    const tick = () => onProgress?.(++done / jobs.length);
    for (const name of ['chars', 'props']) {
      jobs.push(Promise.all([img(`/assets/sprites/${name}.webp`), fetch(`/assets/sprites/${name}.json`).then((r) => r.json())])
        .then(([image, meta]) => { this.atlas[name] = { image, ...meta }; tick(); }));
    }
    for (const [key, id] of Object.entries(TEX)) {
      jobs.push(img(`/assets/textures/${id}_diff.webp`).then((i) => { this.tex[key] = i; tick(); }).catch(tick));
    }
    await Promise.all(jobs);
    this.buildProcedural();
    this.buildTextures();
  }

  // GPU textures for everything the 2D view draws
  buildTextures() {
    this.propsTex = texture(this.atlas.props.image);
    this.charsTex = texture(this.atlas.chars.image);
    this.shadowTex = texture(this.shadow);
    this.droneTex = texture(this.drone);
    this.rotorTex = texture(this.rotor);
    this.terminalTex = texture(this.terminal);
    this.glowTex = texture(this.glow('rgba(255,255,255,1)', 128));
    // dead trees side by side in one atlas
    const ta = canvas(480, 160), tg = ta.getContext('2d');
    this.trees.forEach((c, i) => tg.drawImage(c, i * 160, 0));
    this.treeTex = texture(ta);
    // rock, splash ring, relay cabinet, steam vent grate, lamp head, crate
    const mk = (w, h, draw) => { const c = canvas(w, h); draw(c.getContext('2d'), w, h); return texture(c); };
    this.rockTex = mk(64, 64, (g) => {
      g.translate(32, 32);
      g.beginPath();
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, r = 24 + Math.sin(i * 2.7) * 5; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath();
      const gr = g.createLinearGradient(-24, -24, 24, 24); gr.addColorStop(0, '#77746f'); gr.addColorStop(1, '#2a2827');
      g.fillStyle = gr; g.fill();
    });
    this.ringTex = mk(64, 64, (g) => { g.strokeStyle = 'rgba(200,215,255,1)'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke(); });
    this.relayTex = mk(64, 96, (g) => {
      g.fillStyle = '#2b2e34'; g.fillRect(4, 4, 56, 88); g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(4, 4, 56, 88);
      g.fillStyle = '#e8b21c'; for (let y = 10; y < 90; y += 14) g.fillRect(8, y, 10, 6);
      g.fillStyle = '#e8b21c'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('⚡', 40, 60);
    });
    this.ventTex = mk(64, 48, (g) => {
      g.fillStyle = '#101216'; g.fillRect(0, 0, 64, 48); g.strokeStyle = '#2d3138'; g.lineWidth = 3;
      for (let x = 6; x < 64; x += 9) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 44); g.stroke(); }
    });
    this.lampHeadTex = mk(64, 40, (g) => { g.fillStyle = '#22252b'; g.beginPath(); g.ellipse(32, 20, 28, 15, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#383c44'; g.beginPath(); g.ellipse(26, 15, 12, 6, 0, 0, Math.PI * 2); g.fill(); });
    this.crateTex = mk(64, 64, (g) => {
      g.fillStyle = '#3c4528'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#262c18'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
    });
    this.chuteTex = mk(128, 128, (g) => {
      g.fillStyle = '#8a6a4a'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5a4430'; g.lineWidth = 3; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); }
    });
    this.bottleTex = mk(32, 32, (g) => {
      g.translate(16, 16); g.rotate(0.6);
      g.fillStyle = '#2f6b3a'; g.fillRect(-4, -10, 8, 16); g.fillRect(-2, -14, 4, 5);
      g.fillStyle = 'rgba(200,255,210,0.6)'; g.fillRect(-3, -8, 2, 12);
    });
    this.footTex = mk(32, 48, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.beginPath(); g.ellipse(16, 15, 8, 12, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(16, 37, 6, 7, 0, 0, Math.PI * 2); g.fill();
    });
    this.caseTex = mk(32, 32, (g) => { g.fillStyle = '#ffe14d'; g.fillRect(4, 4, 24, 24); g.strokeStyle = '#7a5a00'; g.lineWidth = 2; g.strokeRect(4, 4, 24, 24); });
  }

  // draw a frame from an atlas centred at (x, y) world px, rotated, sized by its baked metres
  frame(g, atlas, name, x, y, rot = 0, scale = 1, alpha = 1) {
    const a = this.atlas[atlas], f = a?.frames[name];
    if (!f) return;
    const w = f.mw * PX * scale, h = f.mh * PX * scale;
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (alpha !== 1) g.globalAlpha *= alpha;
    g.drawImage(a.image, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
    g.restore();
  }

  has(atlas, name) { return !!this.atlas[atlas]?.frames[name]; }

  // a soft radial light sprite in a given colour (cached)
  glow(color, size = 128) {
    const key = color + size;
    let c = this.glows.get(key);
    if (c) return c;
    c = canvas(size, size);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, color);
    gr.addColorStop(0.25, color.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.55})`));
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    this.glows.set(key, c);
    return c;
  }

  buildProcedural() {
    // drone seen from above: hull, four arms, rotor discs, a lens. Faces +x.
    const d = this.drone = canvas(128, 128), g = d.getContext('2d');
    g.translate(64, 64);
    g.strokeStyle = '#2c313c'; g.lineWidth = 7; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 44, Math.sin(a) * 44); g.stroke(); }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      g.fillStyle = '#1a1d24'; g.beginPath(); g.arc(Math.cos(a) * 44, Math.sin(a) * 44, 8, 0, Math.PI * 2); g.fill();
    }
    const hull = g.createRadialGradient(-6, -8, 2, 0, 0, 26);
    hull.addColorStop(0, '#5a6274'); hull.addColorStop(0.6, '#262a33'); hull.addColorStop(1, '#101216');
    g.fillStyle = hull; g.beginPath(); g.ellipse(0, 0, 26, 22, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a404d'; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, 29, 25, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#0a0b0e'; g.beginPath(); g.arc(17, 0, 8, 0, Math.PI * 2); g.fill();
    // rotor blur disc
    const r = this.rotor = canvas(48, 48), rg = r.getContext('2d');
    const rgr = rg.createRadialGradient(24, 24, 4, 24, 24, 24);
    rgr.addColorStop(0, 'rgba(170,180,200,0.05)'); rgr.addColorStop(0.8, 'rgba(170,180,200,0.22)'); rgr.addColorStop(1, 'rgba(170,180,200,0)');
    rg.fillStyle = rgr; rg.beginPath(); rg.arc(24, 24, 24, 0, Math.PI * 2); rg.fill();
    rg.strokeStyle = 'rgba(200,210,230,0.35)'; rg.lineWidth = 2;
    rg.beginPath(); rg.moveTo(4, 24); rg.lineTo(44, 24); rg.stroke();

    // terminal from above: a console desk with a screen (facing +x)
    const t = this.terminal = canvas(96, 96), tg = t.getContext('2d');
    tg.translate(48, 48);
    tg.fillStyle = '#20242c'; tg.fillRect(-26, -32, 40, 64);
    tg.fillStyle = '#2e333d'; tg.fillRect(-22, -28, 32, 56);
    tg.fillStyle = '#0c0e12'; tg.fillRect(10, -30, 10, 60);
    tg.fillStyle = '#3a404c'; for (let i = 0; i < 6; i++) tg.fillRect(-18, -22 + i * 8, 22, 4);

    // dead trees: a few variants of bare branches (overhead layer)
    this.trees = [0, 1, 2].map((v) => {
      const c = canvas(160, 160), cg = c.getContext('2d');
      cg.translate(80, 80);
      cg.lineCap = 'round';
      let seed = 17 + v * 31;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      const branch = (len, w, depth) => {
        if (depth === 0 || len < 4) return;
        cg.lineWidth = w; cg.strokeStyle = `rgba(${18 + depth * 3},${14 + depth * 3},${12 + depth * 2},0.95)`;
        cg.beginPath(); cg.moveTo(0, 0); cg.lineTo(len, 0); cg.stroke();
        cg.save(); cg.translate(len, 0);
        const n = 2 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) { cg.save(); cg.rotate((rnd() - 0.5) * 1.6); branch(len * (0.55 + rnd() * 0.25), w * 0.65, depth - 1); cg.restore(); }
        cg.restore();
      };
      for (let i = 0; i < 6; i++) { cg.save(); cg.rotate((i / 6) * Math.PI * 2 + rnd()); branch(22 + rnd() * 14, 6, 4); cg.restore(); }
      cg.fillStyle = '#1a1410'; cg.beginPath(); cg.arc(0, 0, 9, 0, Math.PI * 2); cg.fill();
      return c;
    });

    // soft round shadow
    const s = this.shadow = canvas(64, 64), sg = s.getContext('2d');
    const sgr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    sgr.addColorStop(0, 'rgba(0,0,0,0.55)'); sgr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = sgr; sg.fillRect(0, 0, 64, 64);

    // tileable mist + grain for the post pass
    this.mist = canvas(512, 512);
    const mg = this.mist.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 40 + Math.random() * 120;
      for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
        const gr = mg.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, 'rgba(150,165,200,0.07)'); gr.addColorStop(1, 'rgba(150,165,200,0)');
        mg.fillStyle = gr; mg.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    this.grain = canvas(256, 256);
    const gg = this.grain.getContext('2d'), id = gg.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 12; }
    gg.putImageData(id, 0, 0);
  }
}
