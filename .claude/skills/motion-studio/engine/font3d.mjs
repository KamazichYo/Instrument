#!/usr/bin/env node
// Шрифт бренда → 3D-шрифт для объёмного текста (THREE.TextGeometry), с кириллицей.
//   node font3d.mjs Brand-Bold.ttf -o videos/x/assets/brand.font.js [--name brand] [--chars "доп. символы"]
// Выход — .js, который кладёт шрифт в window.MG_FONTS[name] (работает и по двойному клику, без сервера).
// Подключи: <script src="assets/brand.font.js"></script>, затем MG3.text3d('Привет', { font: 'brand' }).
// Нужен opentype.js: ставится автоматически в engine/node_modules при первом запуске.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from './cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { pos, o } = parse(process.argv.slice(2));
if (!pos[0]) { console.error('usage: node font3d.mjs <font.ttf|.otf|.woff> -o out.font.js [--name id] [--chars "..."]'); process.exit(2); }
let opentype;
const req = createRequire(path.join(here, 'x.js'));
try { opentype = req('opentype.js'); } catch {
  console.error('… ставлю opentype.js');
  if (!fs.existsSync(path.join(here, 'package.json'))) fs.writeFileSync(path.join(here, 'package.json'), '{"private":true,"type":"module"}');
  execSync('npm install --silent --no-audit --no-fund opentype.js@1', { cwd: here, stdio: 'inherit' });
  opentype = req('opentype.js');
}
const font = opentype.loadSync(pos[0]);
const name = o.name || path.basename(pos[0]).replace(/\.[^.]+$/, '').toLowerCase();
const base = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~«»—–…№₽€$%°×·•’“”„';
const cyr = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяІіЇїЄєҐґ';
const chars = [...new Set([...base, ...cyr, ...(o.chars || '')])];
const scale = 1000 / font.unitsPerEm;
const glyphs = {};
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  if (!g || (g.index === 0 && ch !== ' ')) continue;
  const cmds = g.getPath(0, 0, font.unitsPerEm).commands;
  const r = (v) => Math.round(v * scale);
  let out = '';
  for (const c of cmds) {
    // в typeface-формате ось Y вверх, а квадратичные кривые пишутся как q x y cx cy
    if (c.type === 'M') out += `m ${r(c.x)} ${r(-c.y)} `;
    else if (c.type === 'L') out += `l ${r(c.x)} ${r(-c.y)} `;
    else if (c.type === 'Q') out += `q ${r(c.x)} ${r(-c.y)} ${r(c.x1)} ${r(-c.y1)} `;
    else if (c.type === 'C') out += `b ${r(c.x)} ${r(-c.y)} ${r(c.x1)} ${r(-c.y1)} ${r(c.x2)} ${r(-c.y2)} `;
  }
  const bb = g.getBoundingBox();
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1), x_max: r(bb.x2), o: out.trim() };
}
const json = {
  glyphs, familyName: font.names.fontFamily?.en || name, ascender: Math.round(font.ascender * scale), descender: Math.round(font.descender * scale),
  underlinePosition: Math.round((font.tables.post?.underlinePosition || -100) * scale), underlineThickness: Math.round((font.tables.post?.underlineThickness || 50) * scale),
  boundingBox: { xMin: Math.round(font.tables.head.xMin * scale), yMin: Math.round(font.tables.head.yMin * scale), xMax: Math.round(font.tables.head.xMax * scale), yMax: Math.round(font.tables.head.yMax * scale) },
  resolution: 1000, original_font_information: { license: 'см. лицензию исходного шрифта' },
};
const out = o.out || name + '.font.js';
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `/* 3D-шрифт «${json.familyName}» для MG3.text3d — сгенерирован font3d.mjs */\n(window.MG_FONTS = window.MG_FONTS || {})[${JSON.stringify(name)}] = ${JSON.stringify(json)};\n`);
console.log(`✔ ${out}  «${json.familyName}», ${Object.keys(glyphs).length} символов, ${(fs.statSync(out).size / 1024).toFixed(0)} КБ → MG3.text3d('…', { font: '${name}' })`);
