// Procedural sprites shared by the game client and the big screen.
import { TILE, T, isSolid, hash2 } from '/shared/world.js';

export const PAL = {
  bg: '#05060d', cyan: '#22e1ff', magenta: '#ff2bd6', red: '#ff2a4a', amber: '#ffb02e', green: '#3dff8a',
};

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function ellipse(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }

// ---------------------------------------------------------------- characters
export function drawPlayer(g, x, y, dir, color, cls, t, o = {}) {
  g.save();
  g.translate(x, y);
  if (o.scale) g.scale(o.scale, o.scale);
  if (o.stunned) {
    g.globalAlpha = 0.45 + Math.random() * 0.4;
    g.translate((Math.random() - 0.5) * 3, 0);
  } else if (o.invuln) {
    g.globalAlpha = 0.55 + Math.sin(t * 18) * 0.25;
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  ellipse(g, 2, 5, 12, 8);
  g.rotate(dir);
  const step = o.moving ? Math.sin(o.walk || 0) * 4.5 : 0;
  // feet
  g.fillStyle = '#07080c';
  ellipse(g, step, -6, 4.2, 2.8);
  ellipse(g, -step, 6, 4.2, 2.8);
  // sprint trail
  if (o.sprint) {
    g.strokeStyle = rgba('#ffffff', 0.35);
    g.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-12, i * 5); g.lineTo(-24 - Math.random() * 10, i * 5); g.stroke(); }
  }
  // gear on the back
  g.fillStyle = '#1a1d26';
  if (cls === 'engineer') { g.fillRect(-12, -6, 6, 12); g.fillStyle = color; g.fillRect(-11, -2, 2, 4); }
  else if (cls === 'hacker') { g.fillRect(-11, -5, 5, 10); g.strokeStyle = '#8a93a8'; g.lineWidth = 1; g.beginPath(); g.moveTo(-9, -4); g.lineTo(-16, -10); g.stroke(); g.fillStyle = color; g.fillRect(-17, -11, 2, 2); }
  else { g.fillRect(-10, -4, 4, 8); }
  // torso
  g.fillStyle = shade(color, -0.55);
  ellipse(g, -1, 0, 8, 11);
  g.strokeStyle = shade(color, -0.1);
  g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(-1, 0, 8, 11, 0, 0, Math.PI * 2); g.stroke();
  // shoulder pads
  g.fillStyle = shade(color, -0.3);
  ellipse(g, 0, -9, 4, 3);
  ellipse(g, 0, 9, 4, 3);
  // head / hood
  g.fillStyle = '#12141c';
  g.beginPath(); g.arc(2, 0, 6.2, 0, Math.PI * 2); g.fill();
  // visor
  g.strokeStyle = shade(color, 0.45);
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  g.beginPath(); g.arc(2, 0, 4.6, -0.95, 0.95); g.stroke();
  g.restore();
}

export function drawSentinel(g, x, y, look, state, t, id) {
  const hover = Math.sin(t * 3 + id) * 2.5;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  ellipse(g, x + 5, y + 9, 15, 9);
  g.translate(x, y - 12 + hover);
  const frozen = state === 2;
  // arms + rotors
  const spin = frozen ? 0 : t * 40 + id;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ax = Math.cos(a) * 15, ay = Math.sin(a) * 15;
    g.strokeStyle = '#2b2f3c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(ax, ay); g.stroke();
    g.fillStyle = 'rgba(160,170,190,0.12)';
    g.beginPath(); g.arc(ax, ay, 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,210,230,0.35)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(ax + Math.cos(spin + i) * 8, ay + Math.sin(spin + i) * 8); g.lineTo(ax - Math.cos(spin + i) * 8, ay - Math.sin(spin + i) * 8); g.stroke();
  }
  // hull
  g.fillStyle = '#161922';
  g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
  g.strokeStyle = state === 1 ? '#ff2a4a' : '#3d4356'; g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#232837';
  g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
  // eye
  const eye = frozen ? '#5ab4ff' : state === 1 ? '#ff2a4a' : '#ffb02e';
  g.rotate(look);
  g.fillStyle = eye;
  g.beginPath(); g.arc(4.5, 0, state === 1 ? 4.5 : 3.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(5.5, -1, 1.2, 0, Math.PI * 2); g.fill();
  g.restore();
  if (frozen) {
    g.strokeStyle = 'rgba(120,200,255,0.8)'; g.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      let px = x, py = y - 12;
      g.moveTo(px, py);
      for (let s = 0; s < 4; s++) { px += (Math.random() - 0.5) * 18; py += (Math.random() - 0.5) * 18; g.lineTo(px, py); }
      g.stroke();
    }
  }
}

export function drawTerminal(g, x, y, t, color, hackedByUs, pips, teamColors) {
  g.save();
  g.translate(x, y);
  // pad
  g.fillStyle = '#0d1017';
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; g.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); }
  g.closePath(); g.fill();
  g.strokeStyle = rgba(color, 0.7); g.lineWidth = 1.5; g.stroke();
  // pillar
  g.fillStyle = '#1b1f2b';
  g.fillRect(-6, -14, 12, 18);
  g.fillStyle = rgba(color, 0.9);
  g.fillRect(-4, -6, 8, 2);
  // hologram
  const bob = Math.sin(t * 2.2 + x) * 2;
  g.translate(0, -30 + bob);
  g.globalAlpha = 0.85;
  g.fillStyle = rgba(color, 0.16);
  g.strokeStyle = rgba(color, 0.9);
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + t * 0.6; g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11 * 0.8); }
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = color;
  g.font = 'bold 11px "Share Tech Mono", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(hackedByUs ? '✓' : (Math.floor(t * 2) % 2 ? '?' : '_'), 0, 1);
  g.globalAlpha = 1;
  g.restore();
  // pips: which teams already cracked it
  if (pips && pips.length) {
    const w = pips.length * 7;
    pips.forEach((tid, i) => {
      g.fillStyle = teamColors[tid];
      g.fillRect(x - w / 2 + i * 7, y + 21, 5, 3);
    });
  }
}

export function drawCore(g, x, y, t, breached) {
  g.save();
  g.translate(x, y);
  const pulse = 0.5 + Math.sin(t * 2.4) * 0.5;
  const col = breached ? PAL.cyan : PAL.magenta;
  g.fillStyle = '#07070d';
  g.beginPath(); g.arc(0, 0, 84, 0, Math.PI * 2); g.fill();
  // spokes
  g.strokeStyle = rgba(col, 0.35); g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + t * 0.05;
    g.beginPath(); g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); g.lineTo(Math.cos(a) * 84, Math.sin(a) * 84); g.stroke();
  }
  // rings
  const rings = [[44, 0.9, 3, 10], [60, -0.6, 2, 18], [76, 0.35, 4, 6]];
  for (const [r, sp, lw, seg] of rings) {
    g.strokeStyle = rgba(col, 0.75); g.lineWidth = lw;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2 + t * sp;
      g.beginPath(); g.arc(0, 0, r, a0, a0 + (Math.PI * 2) / seg * 0.6); g.stroke();
    }
  }
  // orb
  const grd = g.createRadialGradient(0, 0, 2, 0, 0, 30);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.3, col);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 26 + pulse * 5, 0, Math.PI * 2); g.fill();
  // eye slit
  g.fillStyle = '#05060d';
  g.beginPath(); g.ellipse(0, 0, 9, 3 + pulse * 2, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

export function drawCache(g, x, y, t, id) {
  const bob = Math.sin(t * 3 + id) * 3;
  g.save();
  g.translate(x, y - 6 + bob);
  g.rotate(t * 1.5 + id);
  g.fillStyle = 'rgba(255,225,77,0.25)';
  g.fillRect(-7, -7, 14, 14);
  g.strokeStyle = '#ffe14d'; g.lineWidth = 1.5;
  g.strokeRect(-5, -5, 10, 10);
  g.fillStyle = '#fff6c2';
  g.fillRect(-2, -2, 4, 4);
  g.restore();
}

// ---------------------------------------------------------------- tiles
const TOWER_H = 26, WALL_H = 14;
const WINDOW_COLS = ['#ffd27a', '#6ad1ff', '#ff7ad9', '#b6ff7a'];
const CAR_COLS = ['#5a3a2a', '#3b4652', '#6b2f2f', '#4a4a3a', '#2f4a3f', '#55473a'];

function groundFor(world, x, y) {
  const t = world.tiles[y * world.W + x];
  if (t === T.TREE) return T.GRASS;
  if (t === T.CAR || t === T.WALL || t === T.TOWER) return T.ROAD;
  if (t === T.BARRIER) {
    const n = [world.tiles[y * world.W + x + 1], world.tiles[y * world.W + x - 1], world.tiles[(y + 1) * world.W + x], world.tiles[(y - 1) * world.W + x]];
    return n.includes(T.BASE) ? T.BASE : T.ROAD;
  }
  if (t === T.CORE_SOLID) return T.CORE;
  return t;
}

export function drawGround(g, world, tx, ty, px, py, baseColor) {
  const t = groundFor(world, tx, ty);
  const h = hash2(tx, ty, 1), h2 = hash2(tx, ty, 2), h3 = hash2(tx, ty, 3);
  switch (t) {
    case T.ROAD: {
      g.fillStyle = h < 0.5 ? '#15171e' : '#17191f';
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = 'rgba(255,255,255,0.025)';
      for (let i = 0; i < 4; i++) g.fillRect(px + hash2(tx, ty, 10 + i) * 30, py + hash2(tx, ty, 20 + i) * 30, 2, 2);
      if (h2 < 0.1) {
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(px + h * 32, py); g.lineTo(px + 16 + (h3 - 0.5) * 12, py + 16); g.lineTo(px + h2 * 300 % 32, py + 32); g.stroke();
      } else if (h2 < 0.13) {
        g.fillStyle = 'rgba(40,70,120,0.22)';
        g.beginPath(); g.ellipse(px + 16, py + 16, 13, 8, h * 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(160,200,255,0.06)';
        g.beginPath(); g.ellipse(px + 13, py + 13, 5, 2, h * 3, 0, Math.PI * 2); g.fill();
      } else if (h2 < 0.14) {
        g.fillStyle = '#0f1015'; g.beginPath(); g.arc(px + 16, py + 16, 8, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#25272f'; g.stroke();
      }
      // lane markings on long straight roads
      const W = world.W, tl = world.tiles;
      if (tx % 3 === 0 && tl[(ty - 1) * W + tx] === T.ROAD && tl[(ty + 1) * W + tx] === T.ROAD && isSolid(tl[(ty - 2) * W + tx]) === false && tl[(ty - 2) * W + tx] !== T.ROAD && tl[(ty + 2) * W + tx] !== T.ROAD) {
        g.fillStyle = 'rgba(230,190,70,0.16)'; g.fillRect(px + 4, py + 15, 18, 2);
      }
      break;
    }
    case T.FLOOR: {
      g.fillStyle = '#1b1e26';
      g.fillRect(px, py, TILE, TILE);
      g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, 15, 15); g.strokeRect(px + 16.5, py + 16.5, 15, 15);
      if (h < 0.12) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(px + 16, py + 16, 10, 7, h2 * 3, 0, Math.PI * 2); g.fill(); }
      if (h3 < 0.05) { g.fillStyle = '#2a2e3a'; g.fillRect(px + 6, py + 8, 14, 9); }
      break;
    }
    case T.RUBBLE: {
      g.fillStyle = '#18191e';
      g.fillRect(px, py, TILE, TILE);
      for (let i = 0; i < 5; i++) {
        const a = hash2(tx, ty, 30 + i), b = hash2(tx, ty, 40 + i), c = hash2(tx, ty, 50 + i);
        g.fillStyle = c < 0.5 ? '#2c2e36' : '#24252b';
        g.beginPath();
        const cx = px + a * 28 + 2, cy = py + b * 28 + 2, s = 2 + c * 5;
        g.moveTo(cx - s, cy); g.lineTo(cx, cy - s * 0.8); g.lineTo(cx + s, cy + s * 0.2); g.lineTo(cx - s * 0.2, cy + s);
        g.fill();
      }
      break;
    }
    case T.GRASS: {
      g.fillStyle = h < 0.5 ? '#0f1d13' : '#111f14';
      g.fillRect(px, py, TILE, TILE);
      g.strokeStyle = '#1d3a22'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = hash2(tx, ty, 60 + i), b = hash2(tx, ty, 70 + i);
        g.beginPath(); g.moveTo(px + a * 32, py + b * 32); g.lineTo(px + a * 32 + 2, py + b * 32 - 5); g.stroke();
      }
      break;
    }
    case T.BASE: {
      g.fillStyle = '#121721';
      g.fillRect(px, py, TILE, TILE);
      g.strokeStyle = rgba(baseColor || '#22e1ff', 0.16); g.lineWidth = 1;
      g.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
      if (h < 0.08) { g.fillStyle = rgba(baseColor || '#22e1ff', 0.12); g.fillRect(px + 8, py + 8, 16, 16); }
      break;
    }
    case T.CORE: {
      g.fillStyle = '#0b0b14';
      g.fillRect(px, py, TILE, TILE);
      g.strokeStyle = 'rgba(255,43,214,0.22)'; g.lineWidth = 1.5;
      g.beginPath();
      const ex = h < 0.5 ? px : px + TILE, ey = h2 < 0.5 ? py + 8 + h3 * 16 : py + 24 - h3 * 16;
      g.moveTo(px + 16, py + 16); g.lineTo(ex, ey);
      if (h3 < 0.5) { g.moveTo(px + 16, py + 16); g.lineTo(px + 16, h < 0.3 ? py : py + TILE); }
      g.stroke();
      g.fillStyle = 'rgba(255,43,214,0.45)';
      g.fillRect(px + 14, py + 14, 4, 4);
      break;
    }
    case T.TOXIC: {
      g.fillStyle = '#0a2410';
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = 'rgba(70,255,110,0.18)';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(px + hash2(tx, ty, 80 + i) * 32, py + hash2(tx, ty, 90 + i) * 32, 1.5 + hash2(tx, ty, 95 + i) * 3, 0, Math.PI * 2); g.fill(); }
      const W = world.W;
      g.strokeStyle = 'rgba(80,255,120,0.35)'; g.lineWidth = 2;
      if (world.tiles[(ty - 1) * W + tx] !== T.TOXIC) { g.beginPath(); g.moveTo(px, py + 1); g.lineTo(px + TILE, py + 1); g.stroke(); }
      if (world.tiles[(ty + 1) * W + tx] !== T.TOXIC) { g.beginPath(); g.moveTo(px, py + TILE - 1); g.lineTo(px + TILE, py + TILE - 1); g.stroke(); }
      if (world.tiles[ty * W + tx - 1] !== T.TOXIC) { g.beginPath(); g.moveTo(px + 1, py); g.lineTo(px + 1, py + TILE); g.stroke(); }
      if (world.tiles[ty * W + tx + 1] !== T.TOXIC) { g.beginPath(); g.moveTo(px + TILE - 1, py); g.lineTo(px + TILE - 1, py + TILE); g.stroke(); }
      break;
    }
    default:
      g.fillStyle = '#15171e';
      g.fillRect(px, py, TILE, TILE);
  }
}

export function drawSolid(g, world, tx, ty, px, py) {
  const W = world.W;
  const t = world.tiles[ty * W + tx];
  const below = ty + 1 < world.H ? world.tiles[(ty + 1) * W + tx] : T.TOWER;
  const above = ty > 0 ? world.tiles[(ty - 1) * W + tx] : T.TOWER;
  const left = world.tiles[ty * W + tx - 1], right = world.tiles[ty * W + tx + 1];
  const h = hash2(tx, ty, 5), h2 = hash2(tx, ty, 6);
  if (t === T.TOWER) {
    if (below !== T.TOWER) {
      g.fillStyle = '#0d0f16';
      g.fillRect(px, py + TILE - TOWER_H, TILE, TOWER_H);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const lit = hash2(tx * 7 + c, ty * 5 + r, 9);
        g.fillStyle = lit < 0.22 ? WINDOW_COLS[Math.floor(lit * 18) % WINDOW_COLS.length] : '#171a24';
        g.globalAlpha = lit < 0.22 ? 0.8 : 1;
        g.fillRect(px + 4 + c * 9, py + TILE - TOWER_H + 5 + r * 10, 5, 6);
      }
      g.globalAlpha = 1;
    }
    const tone = 30 + Math.floor(hash2(Math.floor(tx / 6), Math.floor(ty / 6), 7) * 10);
    g.fillStyle = `rgb(${tone},${tone + 3},${tone + 14})`;
    g.fillRect(px, py - TOWER_H, TILE, TILE);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    if (above !== T.TOWER) g.fillRect(px, py - TOWER_H, TILE, 3);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    if (left !== T.TOWER) g.fillRect(px, py - TOWER_H, 2, TILE);
    if (right !== T.TOWER) g.fillRect(px + TILE - 2, py - TOWER_H, 2, TILE);
    if (h < 0.06) { g.fillStyle = '#3a4050'; g.fillRect(px + 6, py - TOWER_H + 7, 16, 12); g.fillStyle = '#222631'; for (let i = 0; i < 4; i++) g.fillRect(px + 8 + i * 3.5, py - TOWER_H + 9, 1.5, 8); }
    else if (h < 0.09) { g.fillStyle = '#20242e'; g.beginPath(); g.arc(px + 16, py - TOWER_H + 16, 6, 0, Math.PI * 2); g.fill(); }
    else if (h < 0.1) { g.strokeStyle = '#555c70'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 16, py - TOWER_H + 16); g.lineTo(px + 16, py - TOWER_H - 6); g.stroke(); g.fillStyle = '#ff2a4a'; g.fillRect(px + 15, py - TOWER_H - 8, 2, 2); }
  } else if (t === T.WALL) {
    if (below !== T.WALL && below !== T.TOWER) {
      g.fillStyle = '#1c1e26';
      g.fillRect(px, py + TILE - WALL_H, TILE, WALL_H);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(px, py + TILE - 3, TILE, 3);
    }
    g.fillStyle = h < 0.5 ? '#3a3d48' : '#373a44';
    g.fillRect(px, py - WALL_H, TILE, TILE);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    if (above !== T.WALL) g.fillRect(px, py - WALL_H, TILE, 2);
    if (h2 < 0.2) { g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + h * 32, py - WALL_H); g.lineTo(px + 16, py - WALL_H + 16); g.stroke(); }
  } else if (t === T.TREE) {
    const ox = (h - 0.5) * 8, oy = (h2 - 0.5) * 8;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(px + 18 + ox, py + 20 + oy, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = h < 0.3 ? '#2a2620' : '#15301b';
    g.beginPath(); g.arc(px + 16 + ox, py + 12 + oy, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = h < 0.3 ? '#3a3328' : '#1f4426';
    g.beginPath(); g.arc(px + 12 + ox, py + 8 + oy, 8, 0, Math.PI * 2); g.fill();
    if (h < 0.3) { g.strokeStyle = '#4a4034'; g.lineWidth = 1.5; for (let i = 0; i < 4; i++) { const a = i * 1.7 + h * 9; g.beginPath(); g.moveTo(px + 16 + ox, py + 12 + oy); g.lineTo(px + 16 + ox + Math.cos(a) * 15, py + 12 + oy + Math.sin(a) * 15); g.stroke(); } }
  } else if (t === T.BARRIER) {
    const vertical = isSolid(above) && above === T.BARRIER || isSolid(below) && below === T.BARRIER;
    g.fillStyle = 'rgba(0,0,0,0.4)';
    if (vertical) g.fillRect(px + 9, py + 2, 16, TILE);
    else g.fillRect(px, py + 12, TILE, 16);
    g.fillStyle = '#6a6e78';
    if (vertical) g.fillRect(px + 7, py - 4, 16, TILE);
    else g.fillRect(px, py + 4, TILE, 16);
    g.fillStyle = '#e8b923';
    for (let i = 0; i < 4; i += 2) {
      if (vertical) g.fillRect(px + 9, py - 4 + i * 8, 12, 6);
      else g.fillRect(px + i * 8 + 2, py + 8, 6, 8);
    }
  } else if (t === T.CAR) {
    const vert = h < 0.5;
    const col = CAR_COLS[Math.floor(h2 * CAR_COLS.length)];
    g.save();
    g.translate(px + 16, py + 16);
    if (vert) g.rotate(Math.PI / 2);
    g.rotate((h2 - 0.5) * 0.4);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-16, -8, 34, 20);
    g.fillStyle = col; g.fillRect(-17, -10, 34, 19);
    g.fillStyle = '#0b0d12'; g.fillRect(-7, -8, 14, 15);
    g.fillStyle = shade(col, -0.35); g.fillRect(-4, -7, 8, 13);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-17, -10, 34, 2);
    g.restore();
  }
}
