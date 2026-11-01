#!/usr/bin/env node
// Тайминги слов из субтитров — чтобы графика попадала в речь.
//   node words.mjs speech.srt [-o words.json]     (.srt / .vtt / whisper .json с word timestamps)
//   node words.mjs speech.srt --embed film/index.html   вставить слова в шаблон captions
// Подходит .srt из Instrument → «Субтитры» (Whisper). Внутри фразы время слов оценивается по длине (±0.2 с):
// важные смены ставь на первое или последнее слово фразы.
// Выход: {cues:[{s,e,text}], words:[{w,s,e,cue}]}, плюс печать таблицы для планирования.
import fs from 'node:fs';
import { parse } from './cli.mjs';

const ts = (s) => { const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };

export function parseSubs(text) {
  const t = text.replace(/\r/g, '');
  if (t.trim().startsWith('{') || t.trim().startsWith('[')) { // whisper / transformers.js JSON
    const j = JSON.parse(t);
    const chunks = j.chunks || j.words || j.segments?.flatMap((s) => s.words || []) || j;
    const words = chunks.map((c) => ({ w: (c.text ?? c.word ?? '').trim(), s: c.timestamp ? c.timestamp[0] : c.start, e: c.timestamp ? c.timestamp[1] : c.end })).filter((w) => w.w);
    return { cues: [{ s: words[0]?.s ?? 0, e: words.at(-1)?.e ?? 0, text: words.map((w) => w.w).join(' ') }], words: words.map((w) => ({ ...w, cue: 0 })) };
  }
  const blocks = t.split(/\n\s*\n/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^NOTE/.test(l));
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ s: ts(a), e: ts(z.split(' ').filter(Boolean)[0]), text });
  }
  const words = [];
  cues.forEach((c, ci) => {
    const ws = c.text.split(' ').filter(Boolean);
    const weight = ws.map((w) => 1.2 + w.replace(/[^\p{L}\p{N}]/gu, '').length); // короткие слова тоже занимают время
    const total = weight.reduce((x, y) => x + y, 0);
    let acc = c.s;
    ws.forEach((w, k) => { const d = ((c.e - c.s) * weight[k]) / total; words.push({ w, s: +acc.toFixed(3), e: +(acc + d).toFixed(3), cue: ci }); acc += d; });
  });
  return { cues, words };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { pos, o } = parse(process.argv.slice(2), ['quiet']);
  if (!pos[0]) { console.error('usage: node words.mjs <subs.srt|.vtt|.json> [-o words.json]'); process.exit(2); }
  const res = parseSubs(fs.readFileSync(pos[0], 'utf8'));
  const out = o.out || pos[0].replace(/\.[^.]+$/, '') + '.words.json';
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  if (o.embed) { // подставить слова в <script id="words" type="application/json"> шаблона captions
    const h = fs.readFileSync(o.embed, 'utf8');
    const re = /(<script id="words" type="application\/json">)[\s\S]*?(<\/script>)/;
    if (!re.test(h)) { console.error('в ' + o.embed + ' нет <script id="words" type="application/json">'); process.exit(2); }
    fs.writeFileSync(o.embed, h.replace(re, (_, a, b) => a + '\n' + JSON.stringify({ words: res.words.map(({ w, s, e }) => ({ w, s, e })) }) + '\n' + b));
    console.log('✔ слова вставлены в ' + o.embed);
  }
  if (!o.quiet) for (const c of res.cues) console.log(`${c.s.toFixed(2).padStart(7)}–${c.e.toFixed(2).padEnd(7)} ${c.text}`);
  console.log(`✔ ${out}  (${res.cues.length} фраз, ${res.words.length} слов)`);
}
