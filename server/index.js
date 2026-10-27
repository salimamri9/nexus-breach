import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Game } from './game.js';
import { Persist } from './persist.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.GAME_CONFIG || path.join(root, 'config', 'game.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const storyPath = process.env.STORY_CONFIG || path.join(root, 'config', 'story.json');
if (fs.existsSync(storyPath)) config.story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));

if (config.passphrase && config.passphrase.length !== config.terminals.length) {
  console.warn(`[config] passphrase has ${config.passphrase.length} letters but there are ${config.terminals.length} terminals — each terminal reveals one letter, so these should match.`);
}

const app = express();
app.disable('x-powered-by');
app.use('/assets/prologue', express.static(path.join(root, 'public', 'assets', 'prologue'), { maxAge: 0 }));   // revalidate: prologue art/voice get swapped
app.use('/assets', express.static(path.join(root, 'public', 'assets'), { maxAge: '7d' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three'), { maxAge: '7d' }));
app.get('/vendor/qrcode.js', (_, res) => res.sendFile(path.join(root, 'node_modules', 'qrcode-generator', 'qrcode.js')));
app.get('/health', (_, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
  cors: { origin: false },
});

const game = new Game(io, config);

// Match state is snapshotted to disk so a crash or restart doesn't wipe the event.
const stateFile = process.env.STATE_FILE || path.join(root, 'data', 'state.json');
const persist = new Persist(game, stateFile);
if (process.env.FRESH !== '1') persist.load();
setInterval(() => persist.save(), +process.env.SAVE_MS || 3000);

io.on('connection', (socket) => game.onConnection(socket));

// Last line of defence: log anything that slipped past the per-handler guards and keep serving.
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { persist.save(); console.log(`\n  match saved to ${stateFile} — bye`); process.exit(0); });
}

const PORT = +process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ${config.title} is live`);
  console.log(`  players  → http://localhost:${PORT}/`);
  console.log(`  big screen → http://localhost:${PORT}/screen`);
  console.log(`  admin    → http://localhost:${PORT}/admin   (password: ${process.env.ADMIN_PASSWORD ? '$ADMIN_PASSWORD' : config.adminPassword || 'nexus-admin'})`);
  console.log(`  saving   → ${stateFile}\n`);
  if (!process.env.ADMIN_PASSWORD && !config.adminPassword) console.warn('  ⚠  ADMIN_PASSWORD is not set — anyone who guesses "nexus-admin" controls the game.\n');
});
