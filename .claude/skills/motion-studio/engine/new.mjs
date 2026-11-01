#!/usr/bin/env node
// Новый проект из шаблона: копирует шаблон и движок (lib/) — проект автономен, открывается двойным кликом.
//   node new.mjs <шаблон> <папка> [--format 9:16|16:9|1:1|4:5]
//   node new.mjs --list
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tplRoot = path.join(here, '..', 'templates');
const { pos, o } = parse(process.argv.slice(2), ['list', 'force']);
const list = fs.readdirSync(tplRoot).filter((d) => fs.existsSync(path.join(tplRoot, d, 'index.html')));

if (o.list || !pos[0]) {
  console.log('Шаблоны:');
  for (const d of list) {
    const html = fs.readFileSync(path.join(tplRoot, d, 'index.html'), 'utf8');
    const m = html.match(/<meta name="mg:about" content="([^"]+)"/);
    console.log(`  ${d.padEnd(16)} ${m ? m[1] : ''}`);
  }
  console.log('\nnode new.mjs <шаблон> <папка> [--format 9:16]');
  process.exit(o.list ? 0 : 1);
}
const [tpl, dest] = pos;
if (!list.includes(tpl)) { console.error(`Нет шаблона «${tpl}». Есть: ${list.join(', ')}`); process.exit(2); }
if (!dest) { console.error('Укажи папку проекта'); process.exit(2); }
if (fs.existsSync(path.join(dest, 'index.html')) && !o.force) { console.error(`${dest}/index.html уже есть (--force чтобы перезаписать)`); process.exit(2); }
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(tplRoot, tpl), dest, { recursive: true });
// 3D-библиотека (1 МБ) копируется только в 3D-проекты
const uses3d = fs.readFileSync(path.join(dest, 'index.html'), 'utf8').includes('lib/three/');
fs.cpSync(path.join(here, 'lib'), path.join(dest, 'lib'), { recursive: true, filter: (src) => uses3d || !src.includes(`${path.sep}three`) });
if (o.format) {
  const f = path.join(dest, 'index.html');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/format:\s*'[^']+'/, `format: '${o.format}'`));
}
for (const d of ['out', 'assets']) fs.mkdirSync(path.join(dest, d), { recursive: true });
console.log(`✔ ${dest}/index.html  (шаблон ${tpl}${o.format ? ', формат ' + o.format : ''})`);
console.log(`  превью:  открой ${dest}/index.html в браузере`);
console.log(`  рендер:  node ${path.relative(process.cwd(), path.join(here, 'render.mjs'))} ${dest}/index.html -o ${dest}/out/video.mp4`);
