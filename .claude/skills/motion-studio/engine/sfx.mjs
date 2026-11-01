#!/usr/bin/env node
// Синтез звуковых эффектов — без лицензий и интернета. Каждый звук детерминирован (seed), вариации — через --seed.
//   node sfx.mjs --all -o assets/sfx                  вся библиотека
//   node sfx.mjs whoosh -o assets/sfx/whoosh2.wav --seed 4 --dur 0.8 --pitch 1.2
//   node sfx.mjs --list
import path from 'node:path';
import fs from 'node:fs';
import { parse } from './cli.mjs';
import { SR, writeWav, rng, biquad, env, normalize } from './audio-lib.mjs';

const S = {
  whoosh: { about: 'пролёт объекта / смена сцены', dur: 0.7, lead: 0.43, gen: (n, r, p) => noiseSweep(n, r, 350 * p, 2600 * p, 0.62, 1.2) },
  swish: { about: 'короткий взмах: появление слова, выезд карточки', dur: 0.26, lead: 0.11, gen: (n, r, p) => noiseSweep(n, r, 900 * p, 5200 * p, 0.45, 2) },
  riser: { about: 'нарастание перед ударом (обрывается на пике)', dur: 2.0, lead: 2.0, gen: riser },
  impact: { about: 'тяжёлый удар: появление логотипа, кульминация', dur: 1.4, gen: impact },
  hit: { about: 'короткий плотный удар на бит', dur: 0.45, gen: hit },
  pop: { about: 'поп: появление иконки/пузыря', dur: 0.14, gen: (n, r, p) => tone(n, (t) => 300 * p + 700 * p * Math.exp(-t * 60), 0.002, 0.035, 0.9) },
  click: { about: 'клик мыши / нажатие кнопки', dur: 0.05, gen: click },
  tap: { about: 'мягкое касание экрана', dur: 0.09, gen: (n, r, p) => mixAdd(tone(n, (t) => 520 * p, 0.001, 0.02, 0.7), lpNoise(n, r, 2500, 0.001, 0.01, 0.3)) },
  tick: { about: 'тик счётчика / таймера', dur: 0.03, gen: (n, r, p) => tone(n, () => 3200 * p, 0.0005, 0.006, 0.6) },
  type: { about: 'нажатие клавиши (печать)', dur: 0.06, gen: (n, r, p) => mixAdd(lpNoise(n, r, 4000 + r() * 2000, 0.0005, 0.008, 0.6), tone(n, () => (180 + r() * 60) * p, 0.001, 0.015, 0.35)) },
  ding: { about: 'колокольчик: успех, уведомление, «готово»', dur: 1.6, gen: ding },
  sparkle: { about: 'искры: магия, «волшебство ИИ»', dur: 0.9, gen: sparkle },
  glitch: { about: 'цифровой сбой: глитч-переход', dur: 0.4, gen: glitch },
  thump: { about: 'глухой низ: «приземление» тяжёлого объекта', dur: 0.5, gen: (n, r, p) => tone(n, (t) => (45 + 70 * Math.exp(-t * 25)) * p, 0.003, 0.14, 1) },
};

function noiseSweep(n, r, f0, f1, peakAt, q) {
  const out = new Float32Array(n), bp = biquad('bp'), bp2 = biquad('bp');
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const shape = x < peakAt ? Math.pow(x / peakAt, 2) : Math.pow(1 - (x - peakAt) / (1 - peakAt), 1.6);
    const f = f0 * Math.pow(f1 / f0, x < peakAt ? x / peakAt : 1 - 0.6 * ((x - peakAt) / (1 - peakAt)));
    const w = r() * 2 - 1;
    out[i] = (bp(w, f, q) + 0.5 * bp2(w, f * 2.1, q * 1.5)) * shape;
  }
  return normalize(out, 0.8);
}
function tone(n, fOf, a, d, g) {
  const out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += (2 * Math.PI * fOf(t)) / SR; out[i] = Math.sin(ph) * env(t, a, d) * g; }
  return out;
}
function lpNoise(n, r, f, a, d, g) { const out = new Float32Array(n), lp = biquad('lp'); for (let i = 0; i < n; i++) { const t = i / SR; out[i] = lp(r() * 2 - 1, f) * env(t, a, d) * g; } return out; }
function mixAdd(...bufs) { const out = new Float32Array(Math.max(...bufs.map((b) => b.length))); for (const b of bufs) for (let i = 0; i < b.length; i++) out[i] += b[i]; return normalize(out, 0.85); }
function click(n, r, p) { return mixAdd(lpNoise(n, r, 6000, 0.0003, 0.004, 0.7), tone(n, () => 1800 * p, 0.0003, 0.006, 0.5), tone(n, () => 140 * p, 0.0005, 0.012, 0.4)); }
function hit(n, r, p) { const hp = biquad('hp'); const nz = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; nz[i] = hp(r() * 2 - 1, 900) * env(t, 0.001, 0.07); } return mixAdd(nz, tone(n, (t) => (190 + 120 * Math.exp(-t * 40)) * p, 0.001, 0.09, 0.9), tone(n, (t) => 60 * p, 0.002, 0.12, 0.7)); }
function impact(n, r, p) {
  const sub = tone(n, (t) => (32 + 48 * Math.exp(-t * 9)) * p, 0.002, 0.45, 1);
  const lp = biquad('lp'); const crack = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; crack[i] = lp(r() * 2 - 1, 1800 * Math.exp(-t * 4) + 200) * env(t, 0.001, 0.18) * 0.9; }
  return mixAdd(sub, crack);
}
function riser(n, r, p) {
  const out = new Float32Array(n), bp = biquad('bp'); let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n, t = i / SR, f = 180 * p * Math.pow(7, x);
    ph += (2 * Math.PI * f) / SR; ph2 += (2 * Math.PI * f * 1.007) / SR;
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * (4 + 18 * x * x) * t);
    out[i] = (0.35 * (Math.sin(ph) + Math.sin(ph2)) + 0.6 * bp(r() * 2 - 1, 400 + 6000 * x * x, 1.5)) * Math.pow(x, 1.8) * trem * (x > 0.985 ? (1 - x) / 0.015 : 1);
  }
  return normalize(out, 0.8);
}
function ding(n, r, p) {
  const out = new Float32Array(n), f = 1318 * p, parts = [[1, 1, 1.1], [2.76, 0.5, 0.5], [5.4, 0.25, 0.25], [8.93, 0.12, 0.12]];
  for (let i = 0; i < n; i++) { const t = i / SR; let v = 0; for (const [m, g, d] of parts) v += Math.sin(2 * Math.PI * f * m * t) * g * env(t, 0.002, d); out[i] = v; }
  return normalize(out, 0.7);
}
function sparkle(n, r, p) {
  const out = new Float32Array(n);
  for (let k = 0; k < 9; k++) {
    const at = Math.floor((k / 9) * n * 0.7 + r() * n * 0.08), f = (1800 + r() * 3200) * p;
    for (let i = at; i < n; i++) { const t = (i - at) / SR; out[i] += Math.sin(2 * Math.PI * f * t) * env(t, 0.002, 0.09) * (1 - k / 12) * 0.5; }
  }
  return normalize(out, 0.6);
}
function glitch(n, r, p) {
  const out = new Float32Array(n); let hold = 0, v = 0, gate = 1;
  for (let i = 0; i < n; i++) {
    if (i % 1600 === 0) gate = r() > 0.35 ? 1 : 0;
    if (hold-- <= 0) { v = (r() * 2 - 1) * (r() > 0.5 ? 1 : 0.3); hold = Math.floor((8 + r() * 60) / p); }
    out[i] = Math.round(v * 6) / 6 * gate * (1 - i / n);
  }
  return normalize(out, 0.55);
}

/** Сколько секунд звук «разгоняется» до пика: ставь его раньше события на lead */
export const leadOf = (name) => (S[name] && S[name].lead) || 0;

export function make(name, { seed = 1, dur, pitch = 1 } = {}) {
  const s = S[name]; if (!s) throw new Error('нет звука ' + name);
  const n = Math.round((dur || s.dur) * SR);
  const mono = s.gen(n, rng(seed * 7919 + name.length), pitch);
  // лёгкая стерео-ширина: правый канал чуть задержан
  const R = new Float32Array(mono.length); const dl = Math.round(SR * 0.0007); for (let i = dl; i < mono.length; i++) R[i] = mono[i - dl];
  return [mono, R];
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { pos, o } = parse(process.argv.slice(2), ['all', 'list']);
  if (o.list || (!pos[0] && !o.all)) { for (const [k, v] of Object.entries(S)) console.log(`  ${k.padEnd(9)} ${v.dur.toFixed(2)} с  ${v.about}${v.lead ? `  (пик через ${v.lead} с — ставь раньше)` : ''}`); process.exit(0); }
  if (o.all) {
    const dir = o.out || 'assets/sfx'; fs.mkdirSync(dir, { recursive: true });
    for (const k of Object.keys(S)) { writeWav(path.join(dir, k + '.wav'), make(k)); }
    console.log(`✔ ${Object.keys(S).length} звуков → ${dir}`);
  } else {
    const f = o.out || `${pos[0]}.wav`; fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
    writeWav(f, make(pos[0], { seed: +(o.seed || 1), dur: o.dur ? +o.dur : undefined, pitch: +(o.pitch || 1) }));
    console.log('✔', f);
  }
}
