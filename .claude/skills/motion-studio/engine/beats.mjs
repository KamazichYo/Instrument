#!/usr/bin/env node
// Сетка битов любой музыки: темп, биты, сильные доли, акценты — чтобы резать сцены точно в бит.
//   node beats.mjs assets/track.mp3 [-o assets/track.beats.json] [--min 70 --max 180]
// Результат: {bpm, beats[], downbeats[], onsets[] (сильные удары), confidence}
import fs from 'node:fs';
import { parse } from './cli.mjs';
import { decodeMono, fft } from './audio-lib.mjs';

const { pos, o } = parse(process.argv.slice(2));
if (!pos[0]) { console.error('usage: node beats.mjs <audio|video> [-o out.json]'); process.exit(2); }
const SRB = 22050, HOP = 128, WIN = 1024;
const x = decodeMono(pos[0], SRB);
const nF = Math.floor((x.length - WIN) / HOP);
const hann = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
// спектральный поток (лог-магнитуды), с упором на низ (бочка) и середину
let prev = new Float32Array(WIN / 2);
const flux = new Float32Array(nF), low = new Float32Array(nF), sub = new Float32Array(nF);
for (let f = 0; f < nF; f++) {
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) re[i] = x[f * HOP + i] * hann[i];
  fft(re, im);
  let s = 0, l = 0, b = 0;
  const cur = new Float32Array(WIN / 2);
  for (let k = 1; k < WIN / 2; k++) {
    cur[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
    const d = cur[k] - prev[k];
    if (d > 0) { s += d; if (k < 9) l += d; if (k >= 2 && k <= 4) b += d; } // low <190 Гц, sub 43–86 Гц (бочка)
  }
  flux[f] = s; low[f] = l; sub[f] = b; prev = cur;
}
// нормализация с плавающим порогом
const fr = SRB / HOP;
const smooth = (a, w) => { const out = new Float32Array(a.length); let acc = 0; for (let i = 0; i < a.length; i++) { acc += a[i]; if (i >= w) acc -= a[i - w]; out[i] = acc / Math.min(i + 1, w); } return out; };
const avg = smooth(flux, Math.round(fr * 0.5));
const odf = flux.map((v, i) => Math.max(0, v - avg[i]));
// темп: автокорреляция функции атак
const minB = +(o.min || 70), maxB = +(o.max || 180);
let best = 0, bestLag = 0;
const scores = [];
for (let lag = Math.round((fr * 60) / maxB); lag <= Math.round((fr * 60) / minB); lag++) {
  let s = 0; for (let i = lag; i < odf.length; i++) s += odf[i] * odf[i - lag];
  // лёгкое предпочтение темпа ~120 (типично для роликов)
  const bpmL = (fr * 60) / lag; s *= Math.exp(-0.5 * Math.pow(Math.log2(bpmL / 120) / 1.0, 2));
  scores.push(s); if (s > best) { best = s; bestLag = lag; }
}
const acf = (lag) => { const L = Math.floor(lag), fr0 = lag - L; let s = 0; for (let i = L + 1; i < odf.length; i++) s += odf[i] * (odf[i - L] * (1 - fr0) + odf[i - L - 1] * fr0); return s; };
// октавная ошибка: если вдвое быстрее тоже сильно — берём быстрее (ролики чаще 100–150 BPM)
let period = bestLag;
if ((fr * 60) / period < 100 && (fr * 120) / period <= maxB && acf(period / 2) > 0.62 * acf(period)) period = period / 2;
// дробное уточнение периода
{ let bp = period, bs = -1; for (let l = period - 1; l <= period + 1; l += 0.02) { const v = acf(l); if (v > bs) { bs = v; bp = l; } } period = bp; }
const mOf = (a) => a.reduce((x, y) => x + y, 0) / a.length || 1;
const mo = mOf(odf), ms = mOf(sub);
const strength = odf.map((v, i) => 0.4 * v / mo + 2 * sub[i] / ms); // фаза — по бочке
// фаза: где сумма атак (с упором на бочку) на сетке максимальна
let bestPh = 0, bestPhS = -1;
for (let ph = 0; ph < period; ph += 0.5) { let s = 0; for (let i = ph; i < odf.length; i += period) s += strength[Math.round(i)] || 0; if (s > bestPhS) { bestPhS = s; bestPh = ph; } }
// привязка к пикам ±40 мс, затем прямая по МНК — ровная сетка без дрейфа
const snapped = []; const tol = Math.round(fr * 0.04);
for (let i = bestPh, n = 0; i < odf.length; i += period, n++) {
  const c = Math.round(i); let m = c;
  for (let k = Math.max(0, c - tol); k <= Math.min(odf.length - 1, c + tol); k++) if (strength[k] > strength[m]) m = k;
  snapped.push([n, m]);
}
const N0 = snapped.length, sx = snapped.reduce((a, [n]) => a + n, 0), sy = snapped.reduce((a, [, m]) => a + m, 0);
const sxx = snapped.reduce((a, [n]) => a + n * n, 0), sxy = snapped.reduce((a, [n, m]) => a + n * m, 0);
const slope = (N0 * sxy - sx * sy) / (N0 * sxx - sx * sx || 1), icpt = (sy - slope * sx) / N0;
const bpm = (fr * 60) / slope;
let first = icpt; while (first - slope >= 0) first -= slope;
// окно FFT видит атаку раньше её начала — компенсируем ~половину окна
const LAT = (WIN * 0.55) / SRB;
const beats = []; for (let f = first; f < odf.length; f += slope) if (f >= 0) beats.push(+((f * HOP) / SRB + LAT).toFixed(3));
// сильная доля: из 4 вариантов фазы такта — где больше низа
let bestBar = 0, bestBarS = -1;
for (let b = 0; b < 4; b++) { let s = 0; for (let i = b; i < beats.length; i += 4) s += low[Math.round((beats[i] * SRB) / HOP)] || 0; if (s > bestBarS) { bestBarS = s; bestBar = b; } }
const downbeats = beats.filter((_, i) => i % 4 === bestBar % 4);
// сильные атаки (акценты для ударов/смен)
const thr = [...odf].sort((a, b) => b - a)[Math.floor(odf.length * 0.03)] || 0;
const onsets = [];
for (let i = 1; i < odf.length - 1; i++) if (odf[i] > thr && odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1]) { const t = (i * HOP) / SRB + LAT; if (!onsets.length || t - onsets[onsets.length - 1] > 0.12) onsets.push(+t.toFixed(3)); }
const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
const res = { file: pos[0], bpm: +bpm.toFixed(2), beat_s: +(60 / bpm).toFixed(4), confidence: +(best / (mean || 1)).toFixed(2), beats, downbeats, onsets, duration: +(x.length / SRB).toFixed(2) };
const out = o.out || pos[0] + '.beats.json';
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`✔ ${out}  ${res.bpm} BPM (уверенность ${res.confidence}), ${beats.length} битов, ${downbeats.length} тактов, ${onsets.length} акцентов. Первая сильная доля: ${downbeats[0]} с`);
