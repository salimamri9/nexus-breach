// Deterministic city generation + physics helpers, shared by server and client.
// Server units are "px": 1 tile = TILE px = M metres. The 3D client converts px → metres.

export const TILE = 32;
export const M = 1.5;                 // metres per tile
export const PX = TILE / M;           // px per metre
export const MAP_W = 400;
export const MAP_H = 280;
export const SECTOR = 25;             // tiles per sector cell (A1 … P12)
export const PLAYER_R = Math.round(0.38 * PX);
export const INTERACT_R = 2.6 * PX;
export const CORE_INTERACT_R = 9 * PX;

// Movement speeds in px/s
export const SPEED = { crouch: 2.0 * PX, walk: 2.6 * PX, jog: 5.8 * PX, sprint: 8.8 * PX };

export const T = {
  ROAD: 0, SIDEWALK: 1, FLOOR: 2, RUBBLE: 3, GRASS: 4, BASE: 5, CORE: 6, MUD: 7, YARD: 8,
  WALL: 10, TOWER: 11, TREE: 12, BARRIER: 13, CAR: 14, CORE_SOLID: 15, TOXIC: 16, CONTAINER: 17, ROCK: 18, FENCE: 19,
};
export const isSolid = (t) => t >= 10;
const OPAQUE = new Uint8Array(32);
OPAQUE[T.WALL] = OPAQUE[T.TOWER] = OPAQUE[T.CORE_SOLID] = OPAQUE[T.CONTAINER] = OPAQUE[T.ROCK] = 1;
export const isOpaque = (t) => OPAQUE[t] === 1;

export const DISTRICTS = ['downtown', 'residential', 'industrial', 'wasteland'];

export const CLASSES = {
  // sprint/regen: seconds to empty / refill stamina · battery: seconds of flashlight
  runner: {
    name: 'Runner', ability: 'Overclock', cd: 16000, dur: 5000, boost: 1.3, speedMul: 1.15, sprint: 15, regen: 10, battery: 120, quiet: true,
    desc: 'The courier. Outruns drones and carries clues across the city, but goes dark fast.',
    abilityDesc: '5 s silent sprint at +30% speed',
    perks: ['Jogging makes no noise (drones only hear you sprint)'], weak: 'Flashlight lasts half as long'
  },
  hacker: {
    name: 'Hacker', ability: 'Signal Scan', cd: 22000, radius: 65 * PX, speedMul: 0.9, sprint: 5, regen: 16, battery: 240, senseR: 25 * PX,
    desc: 'The brains. Cracks terminals fastest and finds them for the squad, but can\'t run.',
    abilityDesc: 'Reveals terminals, graffiti and drones within 65 m for the whole squad',
    perks: ['Hints are free (others pay 60 pts)', 'Wrong-answer lockouts are halved', 'Terminals within 25 m appear on the map by themselves'], weak: 'Slowest class, shortest sprint'
  },
  engineer: {
    name: 'Engineer', ability: 'EMP Burst', cd: 25000, radius: 14 * PX, dur: 7000, speedMul: 1, sprint: 7, regen: 14, battery: 480,
    hijackAnyAngle: true, hijackCd: 30000, hijackMs: 40000,
    desc: 'Salim Amri\'s heir. The only one who can fight drones: freezes them, rewires them.',
    abilityDesc: 'Freezes every drone within 14 m for 7 s',
    perks: ['Rewires drones from any side (others must sneak behind)', 'Rewired drones escort for 40 s (others 25 s)', 'Rewiring kit recharges in 30 s (others 60 s)'], weak: 'No speed or stealth bonus'
  },
};

// the numbers players see on the class cards and in the field manual
export function classStats(key) {
  const c = CLASSES[key], m = (v) => Math.round((v / PX) * 10) / 10;
  return [
    { label: 'Speed', value: `${m(SPEED.jog * c.speedMul)} m/s`, k: c.speedMul / 1.15 },
    { label: 'Sprint speed', value: `${m(SPEED.sprint * c.speedMul)} m/s`, k: c.speedMul / 1.15 },
    { label: 'Sprint lasts', value: `${c.sprint} s`, k: c.sprint / 15 },
    { label: 'Breath back in', value: `${c.regen} s`, k: 10 / c.regen },
    { label: 'Flashlight', value: `${c.battery / 60} min`, k: c.battery / 480 },
    { label: 'Footsteps heard', value: c.quiet ? 'sprint only' : 'within 6 m', k: c.quiet ? 1 : 0.5 },
  ];
}

// stamina: recovery waits a moment after sprinting, standing still recovers faster, and running
// completely dry leaves you winded: no sprinting until the bar is back to recoverAt
export const STAMINA_RULES = { delay: 1.5, stillMul: 1.5, recoverAt: 0.4 };
export function stepStamina(p, sprinting, moving, regenSecs, drainSecs, dt, now) {
  if (sprinting) {
    p.stamina = Math.max(0, p.stamina - dt / drainSecs);
    p.lastSprintAt = now;
    if (p.stamina <= 0.02) p.winded = true;
  } else if (now - (p.lastSprintAt || 0) > STAMINA_RULES.delay * 1000) {
    p.stamina = Math.min(1, p.stamina + (dt / regenSecs) * (moving ? 1 : STAMINA_RULES.stillMul));
  }
  if (p.winded && p.stamina >= STAMINA_RULES.recoverAt) p.winded = false;
}

export function moveSpeed(cls, mode) {
  return (SPEED[mode] || SPEED.jog) * (CLASSES[cls]?.speedMul || 1);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, s = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function baseRects(n) {
  const bw = 22, bh = 16, m = 6;
  const all = [
    { x: m, y: m },
    { x: MAP_W - m - bw, y: MAP_H - m - bh },
    { x: MAP_W - m - bw, y: m },
    { x: m, y: MAP_H - m - bh },
    { x: m, y: (MAP_H - bh) >> 1 },
    { x: MAP_W - m - bw, y: (MAP_H - bh) >> 1 },
  ];
  return all.slice(0, n).map((r) => ({ ...r, w: bw, h: bh, cx: (r.x + bw / 2) * TILE, cy: (r.y + bh / 2) * TILE }));
}

export function sectorName(px, py) {
  const c = Math.floor(px / TILE / SECTOR), r = Math.floor(py / TILE / SECTOR) + 1;
  return String.fromCharCode(65 + c) + r;
}

const NEON_WORDS = ['NEXUS', 'SLEEP', '24H', 'HALCYON', 'OPEN', 'ネオン', 'BAR', 'NO EXIT', 'HOTEL', 'DREAM', '眠り', 'LIVE', 'HUSH', 'DATA', 'SLEEP', 'CLINIC', 'PHARMACY', 'CASINO', 'MOTEL', 'KARAOKE', 'LULLABY'];
const NEON_COLORS = ['#ff2bd6', '#22e1ff', '#ffe14d', '#ff4d6d', '#7cff6b', '#a78bfa', '#ff8a3d'];

export function generateWorld(seed, teamCount, counts) {
  const W = MAP_W, H = MAP_H, N = W * H;
  const rng = mulberry32(seed >>> 0);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pickR = (arr) => arr[Math.floor(rng() * arr.length)];
  const tiles = new Uint8Array(N).fill(T.ROAD);
  const heights = new Uint8Array(N);
  const bid = new Int16Array(N).fill(-1);
  const buildings = [];
  const props = [];
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const get = (x, y) => (inb(x, y) ? tiles[y * W + x] : T.TOWER);
  const set = (x, y, t, h = 0, b = -1) => { if (inb(x, y)) { const k = y * W + x; tiles[k] = t; heights[k] = h; bid[k] = b; } };
  const fill = (x, y, w, h, t, ht = 0, b = -1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t, ht, b); };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const addBuilding = (b) => { b.id = buildings.length; buildings.push(b); return b.id; };
  const prop = (type, x, y, rot = rng() * Math.PI * 2, s = 1) => props.push({ type, x: x * TILE, y: y * TILE, rot, s });

  const bases = baseRects(teamCount);
  const core = { tx: W >> 1, ty: H >> 1, r: 24 };
  core.x = (core.tx + 0.5) * TILE;
  core.y = (core.ty + 0.5) * TILE;

  // ---- districts: Voronoi with a warped boundary, downtown around the core
  const dseeds = [];
  for (let i = 0; i < 14; i++) dseeds.push({ x: ri(10, W - 10), y: ri(10, H - 10), d: 1 + Math.floor(rng() * 3) });
  const district = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + (vnoise(x / 30, y / 30, seed) - 0.5) * 50, wy = y + (vnoise(x / 30, y / 30, seed + 7) - 0.5) * 50;
    if (Math.hypot((wx - core.tx) * 0.8, wy - core.ty) < 78) { district[y * W + x] = 0; continue; }
    let best = 0, bd = 1e9;
    for (const s of dseeds) { const d = (s.x - wx) ** 2 + (s.y - wy) ** 2; if (d < bd) { bd = d; best = s.d; } }
    district[y * W + x] = best;
  }
  const districtAt = (x, y) => district[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  const reserved = (x, y, w, h, pad = 3) => {
    for (const b of bases) if (x < b.x + b.w + pad && x + w > b.x - pad && y < b.y + b.h + pad && y + h > b.y - pad) return true;
    const cx = Math.max(x, Math.min(core.tx, x + w)), cy = Math.max(y, Math.min(core.ty, y + h));
    return Math.hypot(cx - core.tx, cy - core.ty) < core.r + pad + 2;
  };

  // ---- lot fillers --------------------------------------------------------
  function sidewalk(x, y, w, h) {
    for (let i = x; i < x + w; i++) { set(i, y, T.SIDEWALK); set(i, y + h - 1, T.SIDEWALK); }
    for (let j = y; j < y + h; j++) { set(x, j, T.SIDEWALK); set(x + w - 1, j, T.SIDEWALK); }
  }
  function tower(x, y, w, h, d) {
    sidewalk(x, y, w, h);
    const hgt = d === 0 ? ri(30, 125) : d === 1 ? ri(12, 32) : ri(10, 22);
    const style = d === 0 ? ri(0, 2) : d === 1 ? ri(2, 3) : 4;
    const id = addBuilding({ kind: 'tower', x: x + 1, y: y + 1, w: w - 2, h: h - 2, height: hgt, style, district: d });
    fill(x + 1, y + 1, w - 2, h - 2, T.TOWER, hgt, id);
    // notched corner for silhouette variety
    if (w > 10 && h > 10 && rng() < 0.4) {
      const nw = ri(3, (w >> 1) - 1), nh = ri(3, (h >> 1) - 1);
      const nx = rng() < 0.5 ? x + 1 : x + w - 1 - nw, ny = rng() < 0.5 ? y + 1 : y + h - 1 - nh;
      fill(nx, ny, nw, nh, T.SIDEWALK);
      for (let k = 0; k < 3; k++) prop(pickR(['trashbag', 'cement_bag', 'wooden_crate_01']), nx + rng() * nw, ny + rng() * nh);
    }
    if (rng() < 0.5) prop('exterior_aircon_unit', x + 2 + rng() * (w - 4), y + h - 1.2, 0);
  }
  function shell(x, y, w, h, d, kind = 'shell') {
    sidewalk(x, y, w, h);
    const bx = x + 1, by = y + 1, bw = w - 2, bh = h - 2;
    const hgt = kind === 'warehouse' ? ri(9, 13) : ri(6, 12);
    const style = kind === 'warehouse' ? 6 : ri(5, 6) === 6 && d === 2 ? 6 : 5;
    const id = addBuilding({ kind, x: bx, y: by, w: bw, h: bh, height: hgt, style, district: d });
    fill(bx, by, bw, bh, T.WALL, hgt, id);
    fill(bx + 1, by + 1, bw - 2, bh - 2, T.FLOOR);
    const dw = kind === 'warehouse' ? 4 : 2;
    const door = (side) => {
      if (side === 0 || side === 2) { const dx = ri(bx + 1, bx + bw - 1 - dw); const dy = side === 0 ? by : by + bh - 1; for (let i = 0; i < dw; i++) set(dx + i, dy, T.FLOOR); }
      else { const dy = ri(by + 1, by + bh - 1 - dw); const dx = side === 3 ? bx : bx + bw - 1; for (let i = 0; i < dw; i++) set(dx, dy + i, T.FLOOR); }
    };
    const sides = shuffle([0, 1, 2, 3]);
    const nd = 1 + (rng() < 0.75 ? 1 : 0) + (rng() < 0.35 ? 1 : 0);
    for (let i = 0; i < nd; i++) door(sides[i]);
    // interior partitions
    if (kind === 'shell' && bw >= 12 && rng() < 0.7) {
      const px = bx + ri(4, bw - 5);
      for (let j = by + 1; j < by + bh - 1; j++) set(px, j, T.WALL, hgt, id);
      const g = ri(by + 1, by + bh - 4); set(px, g, T.FLOOR); set(px, g + 1, T.FLOOR);
    }
    if (kind === 'shell' && bh >= 12 && rng() < 0.5) {
      const py = by + ri(4, bh - 5);
      for (let i = bx + 1; i < bx + bw - 1; i++) if (get(i, py) === T.FLOOR) set(i, py, T.WALL, hgt, id);
      const g = ri(bx + 1, bx + bw - 4); set(g, py, T.FLOOR); set(g + 1, py, T.FLOOR);
    }
    // blast holes
    for (let i = ri(0, 3); i > 0; i--) {
      if (rng() < 0.5) set(ri(bx + 1, bx + bw - 2), rng() < 0.5 ? by : by + bh - 1, T.RUBBLE);
      else set(rng() < 0.5 ? bx : bx + bw - 1, ri(by + 1, by + bh - 2), T.RUBBLE);
    }
    // contents
    const n = Math.floor((bw * bh) / 30);
    for (let i = 0; i < n; i++) {
      const px = bx + 1.5 + rng() * (bw - 3), py = by + 1.5 + rng() * (bh - 3);
      if (get(Math.floor(px), Math.floor(py)) !== T.FLOOR) continue;
      const r = rng();
      if (r < 0.2) set(Math.floor(px), Math.floor(py), T.RUBBLE);
      else prop(kind === 'warehouse' ? pickR(['wooden_crate_01', 'old_military_crate', 'barrel_03', 'propane_tank', 'steel_frame_shelves_01']) : pickR(['trashbag', 'old_tyre', 'cement_bag', 'wooden_crate_01', 'steel_frame_shelves_01', 'barrel_03']), px, py);
    }
    if (kind === 'warehouse') {
      for (let i = ri(1, 3); i > 0; i--) {
        const cx = ri(bx + 2, bx + bw - 7), cy = ri(by + 2, by + bh - 4);
        let ok = true;
        for (let j = cy; j < cy + 2; j++) for (let k = cx; k < cx + 5; k++) if (get(k, j) !== T.FLOOR) ok = false;
        if (ok) { const cid = addBuilding({ kind: 'container', x: cx, y: cy, w: 5, h: 2, height: 3, style: ri(0, 4), district: d }); fill(cx, cy, 5, 2, T.CONTAINER, 3, cid); }
      }
    }
  }
  function containerYard(x, y, w, h, d) {
    fill(x, y, w, h, T.YARD);
    for (let i = x; i < x + w; i++) { set(i, y, T.FENCE, 3); set(i, y + h - 1, T.FENCE, 3); }
    for (let j = y; j < y + h; j++) { set(x, j, T.FENCE, 3); set(x + w - 1, j, T.FENCE, 3); }
    for (let k = 0; k < 2; k++) {
      const gx = ri(x + 2, x + w - 6), gy = rng() < 0.5 ? y : y + h - 1;
      for (let i = 0; i < 4; i++) set(gx + i, gy, T.YARD);
    }
    const gx = rng() < 0.5 ? x : x + w - 1, gy = ri(y + 2, y + h - 6);
    for (let i = 0; i < 4; i++) set(gx, gy + i, T.YARD);
    const vertical = h > w;
    for (let j = y + 3; j < y + h - 3; j += vertical ? 7 : 4) {
      for (let i = x + 3; i < x + w - 3; i += vertical ? 4 : 7) {
        if (rng() < 0.25) continue;
        const cw = vertical ? 2 : 5, ch = vertical ? 5 : 2;
        if (i + cw > x + w - 2 || j + ch > y + h - 2) continue;
        const stack = rng() < 0.4 ? 6 : 3;
        const cid = addBuilding({ kind: 'container', x: i, y: j, w: cw, h: ch, height: stack, style: ri(0, 4), district: d });
        fill(i, j, cw, ch, T.CONTAINER, stack, cid);
      }
    }
    for (let i = 0; i < 4; i++) prop(pickR(['barrel_03', 'propane_tank', 'portable_generator', 'old_tyre']), x + 2 + rng() * (w - 4), y + 2 + rng() * (h - 4));
  }
  function tankFarm(x, y, w, h, d) {
    fill(x, y, w, h, T.YARD);
    const r = Math.min(w, h) / 2 - 3;
    const cx = x + w / 2, cy = y + h / 2;
    const id = addBuilding({ kind: 'tank', x: cx - r, y: cy - r, w: r * 2, h: r * 2, height: ri(10, 18), style: 0, district: d });
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) < r) set(i, j, T.TOWER, buildings[id].height, id);
    }
    prop('portable_searchlight', x + 1.5, y + 1.5);
  }
  function wasteland(x, y, w, h) {
    fill(x, y, w, h, T.GRASS);
    const n = Math.floor((w * h) / 40);
    for (let i = 0; i < n; i++) {
      const tx = ri(x, x + w - 1), ty = ri(y, y + h - 1), r = rng();
      if (r < 0.35) { set(tx, ty, T.TREE, 6); props.push({ type: rng() < 0.5 ? 'dead_tree_trunk' : 'dead_tree_trunk_02', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, rot: rng() * 6.28, s: 0.8 + rng() * 0.6 }); }
      else if (r < 0.55) { const s = ri(1, 2); fill(tx, ty, s, s, T.ROCK, ri(2, 4)); }
      else set(tx, ty, T.RUBBLE);
    }
    if (rng() < 0.55 && w > 10 && h > 10) {
      const cx = x + w / 2, cy = y + h / 2, rx = w / 2 - 2, ry = h / 2 - 2;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
        const dd = dx * dx + dy * dy + (vnoise(i / 4, j / 4, seed + 3) - 0.5) * 0.6;
        if (dd < 0.55) set(i, j, T.TOXIC);
        else if (dd < 0.95) set(i, j, T.MUD);
      }
    }
  }
  function plaza(x, y, w, h, d) {
    fill(x, y, w, h, T.SIDEWALK);
    const cx = Math.floor(x + w / 2) - 1, cy = Math.floor(y + h / 2) - 1;
    const id = addBuilding({ kind: 'monument', x: cx, y: cy, w: 3, h: 3, height: ri(6, 10), style: 0, district: d });
    fill(cx, cy, 3, 3, T.TOWER, buildings[id].height, id);
    for (let i = 0; i < 4; i++) prop(pickR(['trashbag', 'metal_trash_can', 'old_tyre']), x + 1 + rng() * (w - 2), y + 1 + rng() * (h - 2));
  }
  function rubbleLot(x, y, w, h) {
    fill(x, y, w, h, T.RUBBLE);
    for (let k = ri(2, 5); k > 0; k--) {
      const tx = ri(x + 1, x + w - 3), ty = ri(y + 1, y + h - 3);
      const id = addBuilding({ kind: 'ruin', x: tx, y: ty, w: 1, h: 1, height: ri(2, 5), style: 5, district: 1 });
      const len = ri(2, 6), down = ri(1, 4);
      for (let i = 0; i < len && tx + i < x + w; i++) set(tx + i, ty, T.WALL, buildings[id].height, id);
      for (let i = 0; i < down && ty + i < y + h; i++) set(tx, ty + i, T.WALL, buildings[id].height, id);
    }
    for (let i = 0; i < 4; i++) prop(pickR(['trashbag', 'old_tyre', 'cement_bag']), x + rng() * w, y + rng() * h);
  }

  function fillLot(x, y, w, h) {
    if (w < 6 || h < 6) { fill(x, y, w, h, T.RUBBLE); return; }
    if (reserved(x, y, w, h)) { fill(x, y, w, h, T.SIDEWALK); return; }
    const d = districtAt(x + (w >> 1), y + (h >> 1));
    const r = rng();
    if (d === 0) {
      if (r < 0.62) tower(x, y, w, h, d);
      else if (r < 0.8) shell(x, y, w, h, d);
      else if (r < 0.9 && w > 9 && h > 9) plaza(x, y, w, h, d);
      else rubbleLot(x, y, w, h);
    } else if (d === 1) {
      if (r < 0.5) shell(x, y, w, h, d);
      else if (r < 0.75) tower(x, y, w, h, d);
      else if (r < 0.88) rubbleLot(x, y, w, h);
      else wasteland(x, y, w, h);
    } else if (d === 2) {
      if (r < 0.35 && w >= 14 && h >= 12) shell(x, y, w, h, d, 'warehouse');
      else if (r < 0.65 && w >= 12 && h >= 12) containerYard(x, y, w, h, d);
      else if (r < 0.75 && w >= 12 && h >= 12) tankFarm(x, y, w, h, d);
      else if (r < 0.85) tower(x, y, w, h, d);
      else wasteland(x, y, w, h);
    } else {
      if (r < 0.7) wasteland(x, y, w, h);
      else if (r < 0.85) rubbleLot(x, y, w, h);
      else shell(x, y, w, h, d);
    }
  }

  // BSP subdivide a superblock into lots separated by streets/alleys
  function subdivide(x, y, w, h, depth) {
    const d = districtAt(x + (w >> 1), y + (h >> 1));
    const maxLot = d === 0 ? 22 : d === 1 ? 16 : d === 2 ? 26 : 30;
    if ((w <= maxLot && h <= maxLot) || depth > 6) { fillLot(x, y, w, h); return; }
    const gap = depth === 0 ? (d === 1 ? 4 : 5) : d === 1 ? ri(2, 3) : ri(3, 4);
    if (w >= h) {
      const s = ri(Math.floor(w * 0.35), Math.floor(w * 0.65));
      subdivide(x, y, s, h, depth + 1);
      subdivide(x + s + gap, y, w - s - gap, h, depth + 1);
    } else {
      const s = ri(Math.floor(h * 0.35), Math.floor(h * 0.65));
      subdivide(x, y, w, s, depth + 1);
      subdivide(x, y + s + gap, w, h - s - gap, depth + 1);
    }
  }

  const cols = [], rows = [];
  for (let x = 5; ;) { const w = ri(34, 52); if (x + w > W - 5) { if (W - 5 - x > 14) cols.push([x, W - 5 - x]); break; } cols.push([x, w]); x += w + ri(7, 9); }
  for (let y = 5; ;) { const h = ri(30, 46); if (y + h > H - 5) { if (H - 5 - y > 14) rows.push([y, H - 5 - y]); break; } rows.push([y, h]); y += h + ri(7, 9); }
  for (const [bx, bw] of cols) for (const [by, bh] of rows) subdivide(bx, by, bw, bh, 0);

  // ---- street clutter (cars, debris) ----------------------------------------
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    if (get(x, y) !== T.ROAD) continue;
    const r = rng();
    if (r < 0.006) {
      const horiz = get(x - 1, y) === T.ROAD && get(x + 1, y) === T.ROAD && get(x + 2, y) === T.ROAD;
      const vert = get(x, y - 1) === T.ROAD && get(x, y + 1) === T.ROAD && get(x, y + 2) === T.ROAD;
      if (horiz && (!vert || rng() < 0.5)) { for (let i = 0; i < 3; i++) set(x + i, y, T.CAR, 2); props.push({ type: 'covered_car', x: (x + 1.5) * TILE, y: (y + 0.5) * TILE, rot: (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.25, s: 1 }); }
      else if (vert) { for (let i = 0; i < 3; i++) set(x, y + i, T.CAR, 2); props.push({ type: 'covered_car', x: (x + 0.5) * TILE, y: (y + 1.5) * TILE, rot: Math.PI / 2 + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.25, s: 1 }); }
    } else if (r < 0.03) set(x, y, T.RUBBLE);
    else if (r < 0.036) prop(pickR(['trashbag', 'old_tyre', 'metal_trash_can', 'cement_bag']), x + 0.5, y + 0.5);
  }

  // ---- Nexus Core (centre plaza) ---------------------------------------------
  for (let j = core.ty - core.r - 4; j <= core.ty + core.r + 4; j++) {
    for (let i = core.tx - core.r - 4; i <= core.tx + core.r + 4; i++) {
      const dx = i - core.tx, dy = j - core.ty, dd = Math.hypot(dx, dy);
      let t = dd <= core.r ? T.CORE : dd <= core.r + 3.5 ? T.ROAD : -1;
      let h = 0;
      if (t === T.CORE && dd >= 14.5 && dd < 16 && Math.abs(dx) > 2 && Math.abs(dy) > 2) { t = T.WALL; h = 7; }
      if (dd < 4.6) { t = T.CORE_SOLID; h = 30; }
      if (t >= 0) set(i, j, t, h);
    }
  }

  // ---- Team bases -------------------------------------------------------------
  for (const b of bases) {
    fill(b.x - 3, b.y - 3, b.w + 6, b.h + 6, T.ROAD);
    fill(b.x, b.y, b.w, b.h, T.BASE);
    for (let i = b.x; i < b.x + b.w; i++) { set(i, b.y, T.BARRIER, 1); set(i, b.y + b.h - 1, T.BARRIER, 1); }
    for (let j = b.y; j < b.y + b.h; j++) { set(b.x, j, T.BARRIER, 1); set(b.x + b.w - 1, j, T.BARRIER, 1); }
    const mx = b.x + (b.w >> 1), my = b.y + (b.h >> 1);
    const gx = b.x + b.w / 2 < W / 2 ? b.x + b.w - 1 : b.x;
    const gy = b.y + b.h / 2 < H / 2 ? b.y + b.h - 1 : b.y;
    for (let k = -2; k <= 2; k++) { set(gx, my + k, T.BASE); set(mx + k, gy, T.BASE); }
    prop('portable_generator', b.x + 2.5, b.y + 2.5, 0);
    prop('portable_searchlight', b.x + b.w - 2.5, b.y + 2.5, Math.PI * 0.75);
    prop('old_military_crate', b.x + 2.5, b.y + b.h - 2.5, 0.3);
  }

  // Perimeter wall
  const PW = 3;
  fill(0, 0, W, PW, T.TOWER, 28); fill(0, H - PW, W, PW, T.TOWER, 28);
  fill(0, 0, PW, H, T.TOWER, 28); fill(W - PW, 0, PW, H, T.TOWER, 28);
  const perimeter = addBuilding({ kind: 'perimeter', x: 0, y: 0, w: W, h: H, height: 28, style: 7, district: 0 });
  for (let k = 0; k < N; k++) if (tiles[k] === T.TOWER && bid[k] === -1 && heights[k] === 28) bid[k] = perimeter;

  // ---- Connectivity: seal anything unreachable from the core --------------------
  const reach = new Uint8Array(N);
  const queue = new Int32Array(N);
  const start = (core.ty - 8) * W + core.tx;
  function flood() {
    reach.fill(0);
    let qh = 0, qt = 0, count = 1;
    reach[start] = 1; queue[qt++] = start;
    while (qh < qt) {
      const k = queue[qh++];
      const n1 = k + 1, n2 = k - 1, n3 = k + W, n4 = k - W;
      if (!reach[n1] && tiles[n1] < 10) { reach[n1] = 1; queue[qt++] = n1; count++; }
      if (!reach[n2] && tiles[n2] < 10) { reach[n2] = 1; queue[qt++] = n2; count++; }
      if (!reach[n3] && tiles[n3] < 10) { reach[n3] = 1; queue[qt++] = n3; count++; }
      if (!reach[n4] && tiles[n4] < 10) { reach[n4] = 1; queue[qt++] = n4; count++; }
    }
    return count;
  }
  flood();
  for (let k = 0; k < N; k++) {
    if (!reach[k] && tiles[k] < 10) { tiles[k] = T.ROCK; heights[k] = 3; bid[k] = -1; }
  }

  const inReserved = (x, y, pad = 0) => {
    for (const b of bases) if (x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad) return true;
    return Math.hypot(x - core.tx, y - core.ty) <= core.r + pad;
  };

  // Barricades across streets, only where they keep the city connected.
  let reachCount = flood();
  for (let a = 0, placed = 0; a < 260 && placed < 70; a++) {
    const x = ri(6, W - 7), y = ri(6, H - 7);
    if (get(x, y) !== T.ROAD || inReserved(x, y, 8)) continue;
    const cells = [];
    if (rng() < 0.5) {
      let y0 = y, y1 = y;
      while (get(x, y0 - 1) === T.ROAD) y0--;
      while (get(x, y1 + 1) === T.ROAD) y1++;
      if (y1 - y0 + 1 < 2 || y1 - y0 + 1 > 9) continue;
      for (let yy = y0; yy <= y1; yy++) cells.push(yy * W + x);
    } else {
      let x0 = x, x1 = x;
      while (get(x0 - 1, y) === T.ROAD) x0--;
      while (get(x1 + 1, y) === T.ROAD) x1++;
      if (x1 - x0 + 1 < 2 || x1 - x0 + 1 > 9) continue;
      for (let xx = x0; xx <= x1; xx++) cells.push(y * W + xx);
    }
    const gap = rng() < 0.5 ? ri(0, cells.length - 1) : -1;
    const changed = cells.filter((_, i) => i !== gap && i !== gap + 1);
    for (const k of changed) { tiles[k] = T.BARRIER; heights[k] = 1; }
    const n = flood();
    if (n !== reachCount - changed.length) { for (const k of changed) { tiles[k] = T.ROAD; heights[k] = 0; } continue; }
    reachCount = n; placed++;
  }
  flood();

  // ---- Object placement ---------------------------------------------------------
  const roadTiles = [], floorTiles = [], openTiles = [], sidewalkTiles = [];
  for (let k = 0; k < N; k++) {
    if (!reach[k]) continue;
    openTiles.push(k);
    const t = tiles[k];
    if (t === T.ROAD) roadTiles.push(k);
    else if (t === T.FLOOR) floorTiles.push(k);
    else if (t === T.SIDEWALK) sidewalkTiles.push(k);
  }
  const walk = (x, y) => !isSolid(get(x, y));
  const open3 = (x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!walk(x + i, y + j)) return false; return true; };
  const wallDir = (x, y) => {
    if (isOpaque(get(x, y - 1))) return [0, -1];
    if (isOpaque(get(x + 1, y))) return [1, 0];
    if (isOpaque(get(x - 1, y))) return [-1, 0];
    if (isOpaque(get(x, y + 1))) return [0, 1];
    return null;
  };
  const anchors = bases.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })).concat([{ x: core.tx, y: core.ty }]);

  function pickSpread(cands, n, avoid, filter, samples = 300) {
    const out = [];
    if (!cands.length) return out;
    for (let i = 0; i < n; i++) {
      let best = -1, bestScore = -1;
      for (let s = 0; s < samples; s++) {
        const k = cands[Math.floor(rng() * cands.length)];
        const x = k % W, y = (k / W) | 0;
        if (filter && !filter(x, y)) continue;
        let md = 1e9;
        for (const a of avoid) md = Math.min(md, (a.x - x) ** 2 + (a.y - y) ** 2);
        for (const a of out) md = Math.min(md, (a.x - x) ** 2 + (a.y - y) ** 2);
        if (md > bestScore) { bestScore = md; best = k; }
      }
      if (best >= 0) out.push({ x: best % W, y: (best / W) | 0 });
    }
    return out;
  }
  const centre = (p) => ({ tx: p.x, ty: p.y, x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });

  const termFilter = (x, y) => open3(x, y) && !inReserved(x, y, 14);
  let terminals = pickSpread(floorTiles, counts.terminals, anchors, termFilter);
  if (terminals.length < counts.terminals) {
    terminals = terminals.concat(pickSpread(openTiles, counts.terminals - terminals.length, anchors.concat(terminals), termFilter));
  }
  const graffiti = pickSpread(openTiles, counts.graffiti, anchors.concat(terminals),
    (x, y) => wallDir(x, y) && walk(x, y) && !inReserved(x, y, 6) && get(x, y) !== T.TOXIC)
    .map((g) => { const [dx, dy] = wallDir(g.x, g.y); return { ...centre(g), dx, dy }; });
  const caches = pickSpread(openTiles, counts.caches, anchors, (x, y) => !inReserved(x, y, 3) && get(x, y) !== T.TOXIC && get(x, y) !== T.MUD, 40);

  // Street lamps along sidewalks, facing the road
  const lamps = [];
  for (let i = 0; i < 20000 && lamps.length < 260; i++) {
    const k = sidewalkTiles[Math.floor(rng() * sidewalkTiles.length)];
    if (k === undefined) break;
    const x = k % W, y = (k / W) | 0;
    let dir = null;
    if (get(x, y + 1) === T.ROAD) dir = [0, 1]; else if (get(x, y - 1) === T.ROAD) dir = [0, -1];
    else if (get(x + 1, y) === T.ROAD) dir = [1, 0]; else if (get(x - 1, y) === T.ROAD) dir = [-1, 0];
    if (!dir) continue;
    if (lamps.some((l) => Math.abs(l.tx - x) < 14 && Math.abs(l.ty - y) < 14)) continue;
    lamps.push({ tx: x, ty: y, x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, rot: Math.atan2(dir[1], dir[0]), on: rng() < 0.55, flicker: rng() < 0.3, model: rng() < 0.5 ? 1 : 2 });
  }

  // Neon signs on tower faces that look onto the street
  const neon = [];
  for (let a = 0; a < 6000 && neon.length < 140; a++) {
    const b = buildings[Math.floor(rng() * buildings.length)];
    if (!b || b.kind !== 'tower' || b.height < 12) continue;
    const side = ri(0, 3);
    let x, y, nx, ny;
    if (side === 0) { x = b.x + rng() * b.w; y = b.y; nx = 0; ny = -1; }
    else if (side === 1) { x = b.x + b.w; y = b.y + rng() * b.h; nx = 1; ny = 0; }
    else if (side === 2) { x = b.x + rng() * b.w; y = b.y + b.h; nx = 0; ny = 1; }
    else { x = b.x; y = b.y + rng() * b.h; nx = -1; ny = 0; }
    if (neon.some((n) => Math.hypot(n.tx - x, n.ty - y) < 8)) continue;
    if (isSolid(get(Math.floor(x + nx * 1.5), Math.floor(y + ny * 1.5)))) continue;
    neon.push({ tx: x, ty: y, x: x * TILE, y: y * TILE, nx, ny, z: 4 + rng() * Math.min(20, b.height - 6), vertical: rng() < 0.35,
      text: NEON_WORDS[Math.floor(rng() * NEON_WORDS.length)], color: NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)], phase: rng() * 10 });
  }

  // ---- Living-world objects (placed last so they never change the city above) ----------
  // Echoes: memory shards that tell the story. Survivors: stragglers hiding indoors.
  // Relays: district power boxes (blackouts). Cameras: wall-mounted sweepers. Alarm cars: still wired.
  const live = [...anchors, ...terminals];
  const echoes = pickSpread(openTiles, counts.echoes ?? 16, live, (x, y) => walk(x, y) && !inReserved(x, y, 8) && get(x, y) !== T.TOXIC, 120).map(centre);
  const hideouts = pickSpread(floorTiles.length > 200 ? floorTiles : openTiles, counts.survivors ?? 14, live.concat(echoes.map((e) => ({ x: e.tx, y: e.ty }))),
    (x, y) => open3(x, y) && !inReserved(x, y, 10), 120).map(centre);
  const relays = pickSpread(sidewalkTiles, counts.relays ?? 8, anchors, (x, y) => wallDir(x, y) && !inReserved(x, y, 12), 200)
    .map((r) => { const [dx, dy] = wallDir(r.x, r.y); return { ...centre(r), dx, dy, radius: 48 * PX }; });
  const cameras = pickSpread(sidewalkTiles.concat(floorTiles), counts.cameras ?? 30, anchors, (x, y) => wallDir(x, y) && !inReserved(x, y, 9), 120)
    .map((c) => {
      const [dx, dy] = wallDir(c.x, c.y);
      return { ...centre(c), dx, dy, base: Math.atan2(-dy, -dx), arc: 0.6 + rng() * 0.5, speed: 0.35 + rng() * 0.3, phase: rng() * 6.28, range: 15 * PX };
    });
  const alarmCars = props.filter((p) => p.type === 'covered_car' && rng() < 0.25).map((p) => ({ x: p.x, y: p.y, rot: p.rot }));
  // tarp-covered cars without an alarm: you can slide under them and hide
  const alarmed = new Set(alarmCars.map((c) => `${c.x},${c.y}`));
  const hideSpots = props.filter((p) => p.type === 'covered_car' && !alarmed.has(`${p.x},${p.y}`)).map((p) => ({ x: p.x, y: p.y, rot: p.rot }));

  const spawns = bases.map((b) => {
    const pts = [];
    for (let j = b.y + 3; j < b.y + b.h - 3; j++) for (let i = b.x + 3; i < b.x + b.w - 3; i++) pts.push({ x: (i + 0.5) * TILE, y: (j + 0.5) * TILE });
    return pts;
  });

  return {
    seed, W, H, tiles, heights, bid, buildings, props, district, reach, bases, core, spawns, lamps, neon,
    roadTiles, openTiles,
    terminals: terminals.map(centre),
    graffiti: graffiti.map((g, i) => ({ ...g, hue: i })),
    caches: caches.map(centre),
    echoes, hideouts, relays, cameras, alarmCars, hideSpots,
  };
}

// --- Physics -----------------------------------------------------------------
export function tileAt(world, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return T.TOWER;
  return world.tiles[ty * world.W + tx];
}

export function heightAt(world, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return 99;
  return world.heights[ty * world.W + tx];
}

export function circleHits(world, x, y, r) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return true;
      if (world.tiles[ty * world.W + tx] < 10) continue;
      const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}

export function moveCircle(world, x, y, dx, dy, r) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (!circleHits(world, x + sx, y, r)) x += sx;
    if (!circleHits(world, x, y + sy, r)) y += sy;
  }
  return [x, y];
}

// Line of sight at a given eye height (metres): blocked by anything at least that tall.
export function lineOfSight(world, x0, y0, x1, y1, eye = 1.6) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 12);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const tx = Math.floor((x0 + (x1 - x0) * t) / TILE), ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
    if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return false;
    const k = ty * world.W + tx;
    if (isOpaque(world.tiles[k]) && world.heights[k] >= eye) return false;
  }
  return true;
}

// Where a security camera points at time t (ms, server clock). Same on server and clients.
export function cameraAngle(c, t) {
  return c.base + Math.sin(t / 1000 * c.speed + c.phase) * c.arc;
}

export function baseIndexAt(world, px, py) {
  const tx = px / TILE, ty = py / TILE;
  for (let i = 0; i < world.bases.length; i++) {
    const b = world.bases[i];
    if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return i;
  }
  return -1;
}
