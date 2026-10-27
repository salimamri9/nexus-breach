// Load-test: spawns N fake players that wander the city.
// Usage: node scripts/bots.js [count=40] [url=http://localhost:3000]
import { io } from 'socket.io-client';
import { generateWorld, moveCircle, PLAYER_R, moveSpeed } from '../shared/world.js';

const N = +process.argv[2] || 40;
const URL = process.argv[3] || 'http://localhost:3000';
const NAMES = ['Byte', 'Nova', 'Ghost', 'Rook', 'Vex', 'Echo', 'Kilo', 'Juno', 'Static', 'Ash', 'Hex', 'Pulse', 'Orbit', 'Raven', 'Glitch', 'Zero'];
const CLS = ['runner', 'hacker', 'engineer'];
const worlds = new Map();
const bots = [];
let packets = 0, bytes = 0;

function init(bot, d) {
  const key = `${d.world.seed}:${d.world.bases}`;
  if (!worlds.has(key)) worlds.set(key, generateWorld(d.world.seed, d.world.bases, d.world.counts));
  bot.world = worlds.get(key);
  bot.x = d.you.x;
  bot.y = d.you.y;
}

function spawn(i) {
  const s = io(URL, { transports: ['websocket'] });
  const bot = { s, x: 0, y: 0, dir: Math.random() * 6.28, world: null, cls: CLS[i % 3] };
  bots.push(bot);
  s.on('connect', () => {
    s.emit('join', { name: `${NAMES[i % NAMES.length]}${i}`, squad: { mode: 'random' }, cls: bot.cls, token: bot.token }, (res) => {
      if (!res?.ok) return console.error('join failed', res);
      bot.token = res.init.you.token;
      init(bot, res.init);
    });
  });
  s.on('init', (d) => init(bot, d));
  s.on('pos', ([x, y]) => { bot.x = x; bot.y = y; bot.dir += Math.PI / 2; });
  s.on('captured', ({ x, y }) => { bot.x = x; bot.y = y; });
  s.on('s', (d) => { packets++; bytes += JSON.stringify(d).length; });
}

for (let i = 0; i < N; i++) setTimeout(() => spawn(i), i * 50);

setInterval(() => {
  for (const bot of bots) {
    if (!bot.world) continue;
    if (Math.random() < 0.02) bot.dir += (Math.random() - 0.5) * 2;
    const sp = (moveSpeed(bot.cls, 'jog') * 0.9) / 15;
    const [nx, ny] = moveCircle(bot.world, bot.x, bot.y, Math.cos(bot.dir) * sp, Math.sin(bot.dir) * sp, PLAYER_R);
    if (Math.abs(nx - bot.x) + Math.abs(ny - bot.y) < sp * 0.3) bot.dir += Math.PI / 2 + Math.random();
    bot.x = nx;
    bot.y = ny;
    bot.s.emit('mv', [Math.round(bot.x * 10) / 10, Math.round(bot.y * 10) / 10, Math.round(bot.dir * 100) / 100, 1 | 8]);
  }
}, 1000 / 15);

setInterval(() => {
  const live = bots.filter((b) => b.world).length;
  console.log(`${live}/${N} bots · ${packets} state packets/s · ~${Math.round(bytes / 1024)} KB/s downstream total`);
  packets = 0;
  bytes = 0;
}, 1000);
