#!/usr/bin/env node
// Встраивает файл (GLB, PNG, JPG, MP3…) в .js — композиция открывается двойным кликом без сервера,
// а WebGL-текстуры не упираются в ограничения file://.
//   node embed.mjs assets/model.glb [assets/shot.png ...]   → assets/model.glb.js
// Подключи <script src="assets/model.glb.js"></script> ДО своего кода; MG3.loadGLB('assets/model.glb') / MG3.texture(...) возьмут встроенное.
import fs from 'node:fs';
import path from 'node:path';
const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.hdr': 'application/octet-stream', '.json': 'application/json' };
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node embed.mjs <file> [file...]'); process.exit(2); }
for (const f of files) {
  const buf = fs.readFileSync(f), ext = path.extname(f).toLowerCase();
  const key = f.replace(/\\/g, '/').replace(/^\.\//, '');
  const data = `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
  fs.writeFileSync(f + '.js', `/* встроенный ассет ${path.basename(f)} (${(buf.length / 1024).toFixed(0)} КБ) — embed.mjs */\n(window.MG_ASSETS = window.MG_ASSETS || {})[${JSON.stringify(key)}] = ${JSON.stringify(data)};\n`);
  console.log(`✔ ${f}.js  (${(buf.length / 1024 / 1024).toFixed(2)} МБ) → <script src="${key}.js"></script>`);
  if (buf.length > 25 * 1024 * 1024) console.log('  △ файл большой: сожми модель (gltf-transform optimize in.glb out.glb) или открывай через node engine/serve.mjs');
}
