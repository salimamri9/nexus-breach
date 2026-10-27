// Bakes top-down sprite atlases from the 3D models in art-src/models.
// Usage: node scripts/bake-sprites.mjs   (needs a Chromium; set CHROMIUM=/path if not /usr/bin/chromium)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets', 'sprites');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(`http://localhost:${port}/scripts/bake/bake.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
console.log('baking… (software rendering, this takes a minute)');
const res = await page.evaluate(() => window.bake());
for (const [name, atlas] of Object.entries(res)) {
  const png = Buffer.from(atlas.png.split(',')[1], 'base64');
  await sharp(png).webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(out, `${name}.webp`));
  const { png: _, ...meta } = atlas;
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(meta));
  console.log(name, Object.keys(atlas.frames).length, 'frames');
}
await browser.close();
server.close();
