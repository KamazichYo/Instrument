#!/usr/bin/env node
// Процедурная музыкальная подложка с точной сеткой битов — для черновиков и роликов без лицензионной музыки.
//   node music.mjs -o assets/music.wav --dur 15 --bpm 120 --style pulse|hype|ambient|minimal [--key A] [--seed 2]
// Рядом пишет music.wav.beats.json: {bpm, beats[], downbeats[], bars[]} — по нему ставь смены сцен (cut on beat).
// Окончание: последний такт — финальный удар и хвост, чтобы ролик не обрывался.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './cli.mjs';
import { SR, writeWav, rng, biquad, env, db } from './audio-lib.mjs';

const { o } = parse(process.argv.slice(2));
const out = o.out || 'music.wav';
const style = o.style || 'pulse';
const bpm = +(o.bpm || { pulse: 118, hype: 140, ambient: 84, minimal: 100 }[style] || 118);
const dur = +(o.dur || 15);
const seed = +(o.seed || 1);
const r = rng(seed);
const KEYS = { C: 48, 'C#': 49, D: 50, 'D#': 51, E: 52, F: 53, 'F#': 54, G: 55, 'G#': 56, A: 57, 'A#': 58, B: 59 };
const root = KEYS[o.key || 'A'] ?? 57;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PROG = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]]; // i VI III VII (минор)

const beat = 60 / bpm, n = Math.round(dur * SR), L = new Float32Array(n), R = new Float32Array(n);
const add = (i, v, pan = 0) => { if (i >= 0 && i < n) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };
const beats = [], downbeats = [], bars = [];
const nBeats = Math.floor(dur / beat);
const lastBar = Math.floor((nBeats - 1) / 4) * 4; // начало последнего такта = финал
for (let b = 0; b < nBeats; b++) { beats.push(+(b * beat).toFixed(4)); if (b % 4 === 0) { downbeats.push(+(b * beat).toFixed(4)); bars.push(+(b * beat).toFixed(4)); } }

const sidechain = (t) => { const ph = (t % beat) / beat; return style === 'ambient' ? 1 : 0.35 + 0.65 * Math.min(1, ph * 3.2); };

function kick(t0, g = 1) { let ph = 0; const len = 0.45 * SR, s = Math.round(t0 * SR); for (let i = 0; i < len; i++) { const t = i / SR; ph += (2 * Math.PI * (48 + 110 * Math.exp(-t * 30))) / SR; add(s + i, Math.sin(ph) * env(t, 0.001, 0.16) * 0.9 * g); } }
function hat(t0, g = 1, open = false) { const hp = biquad('hp'), s = Math.round(t0 * SR), len = (open ? 0.22 : 0.05) * SR; for (let i = 0; i < len; i++) { const t = i / SR; add(s + i, hp(r() * 2 - 1, 7500) * env(t, 0.0005, open ? 0.07 : 0.015) * 0.25 * g, 0.3); } }
function clap(t0, g = 1) { const bp = biquad('bp'), s = Math.round(t0 * SR), len = 0.3 * SR; for (let i = 0; i < len; i++) { const t = i / SR; const e = Math.max(env(t, 0.001, 0.01), env(Math.max(0, t - 0.012), 0.001, 0.012) * 0.8, env(Math.max(0, t - 0.024), 0.001, 0.09) * 0.7); add(s + i, bp(r() * 2 - 1, 1400, 1.2) * e * 0.55 * g, -0.2); } }
function bass(t0, len, m, g = 1) { const lp = biquad('lp'), s = Math.round(t0 * SR), N = len * SR; let ph = 0; for (let i = 0; i < N; i++) { const t = i / SR; ph += (2 * Math.PI * hz(m)) / SR; const saw = (ph / Math.PI) % 2 - 1; add(s + i, lp(0.6 * Math.sin(ph) + 0.3 * saw, 300 + 900 * env(t, 0.005, 0.08)) * env(t, 0.004, len * 0.9) * 0.55 * g * sidechain(t0 + t)); } }
function pad(t0, len, chord, g = 1) {
  const s = Math.round(t0 * SR), N = Math.round(len * SR), lp = biquad('lp'), lp2 = biquad('lp');
  const voices = chord.flatMap((c) => [hz(root + 12 + c) * 0.997, hz(root + 12 + c) * 1.003]);
  const phs = voices.map(() => r() * 6.28);
  for (let i = 0; i < N; i++) {
    const t = i / SR; let v = 0;
    for (let k = 0; k < voices.length; k++) { phs[k] += (2 * Math.PI * voices[k]) / SR; v += Math.sin(phs[k]) + 0.33 * Math.sin(2 * phs[k]) + 0.15 * Math.sin(3 * phs[k]); }
    const a = Math.min(1, t / 0.35) * Math.min(1, (len - t) / 0.3);
    const cut = 900 + 700 * Math.sin(2 * Math.PI * (t0 + t) / (beat * 16));
    const x = v / voices.length * a * 0.32 * g * sidechain(t0 + t);
    add(s + i, lp(x, cut), -0.25); add(s + i, lp2(x, cut * 1.1), 0.25);
  }
}
function pluck(t0, m, g = 1) { const s = Math.round(t0 * SR), N = 0.5 * SR, lp = biquad('lp'); let ph = 0; for (let i = 0; i < N; i++) { const t = i / SR; ph += (2 * Math.PI * hz(m)) / SR; const tri = Math.asin(Math.sin(ph)) * 0.64; add(s + i, lp(tri, 600 + 5000 * Math.exp(-t * 12)) * env(t, 0.002, 0.18) * 0.28 * g, (r() - 0.5) * 0.6); } }
function boom(t0) { const s = Math.round(t0 * SR); let ph = 0; for (let i = 0; i < 2.2 * SR; i++) { const t = i / SR; ph += (2 * Math.PI * (36 + 60 * Math.exp(-t * 8))) / SR; add(s + i, Math.sin(ph) * env(t, 0.002, 0.7) * 0.9); } }

for (let b = 0; b < nBeats; b++) {
  const t = b * beat, bar = Math.floor(b / 4), chord = PROG[bar % 4], inBar = b % 4;
  const final = b >= lastBar && nBeats > 8;
  if (final) { if (b === lastBar) { boom(t); kick(t, 1.1); pad(t, Math.min(dur - t, beat * 4), chord, 0.9); } continue; }
  if (inBar === 0) pad(t, beat * 4, chord, style === 'ambient' ? 1.2 : 0.8);
  const intro = bar === 0 && nBeats > 16; // первый такт — легче
  if (style !== 'ambient') {
    if (!intro || inBar === 0) kick(t, style === 'minimal' ? 0.8 : 1);
    if (!intro) { hat(t + beat / 2, 1, style === 'hype' && inBar === 3); if (style === 'hype') { hat(t + beat / 4, 0.5); hat(t + 3 * beat / 4, 0.5); } }
    if ((style === 'hype' || style === 'pulse') && (inBar === 1 || inBar === 3) && !intro) clap(t, style === 'hype' ? 1 : 0.6);
    if (style !== 'minimal') { bass(t, beat / 2 * 0.9, root - 12 + chord[0]); bass(t + beat / 2, beat / 2 * 0.9, root - 12 + chord[0] + (inBar === 3 ? 7 : 0)); }
  }
  if (style === 'ambient' || style === 'minimal' || style === 'pulse') {
    const arp = [0, 1, 2, 1].map((k) => chord[k] + 24 + root);
    if (style !== 'pulse' || bar % 2 === 1) for (let k = 0; k < 2; k++) pluck(t + k * beat / 2, arp[(inBar * 2 + k) % 4], style === 'pulse' ? 0.6 : 1);
  }
}
// мастер: мягкий лимит + фейды
let peak = 0; for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = db(-1.5) / (peak || 1), fadeIn = 0.02 * SR, fadeOut = 0.4 * SR;
for (let i = 0; i < n; i++) { const f = Math.min(1, i / fadeIn, (n - i) / fadeOut); L[i] *= g * f; R[i] *= g * f; }
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeWav(out, [L, R]);
fs.writeFileSync(out + '.beats.json', JSON.stringify({ bpm, style, duration: dur, beat_s: +beat.toFixed(4), final_hit: +(lastBar * beat).toFixed(4), beats, downbeats, bars }, null, 1));
console.log(`✔ ${out}  ${style} ${bpm} BPM ${dur} с, финальный удар на ${(lastBar * beat).toFixed(2)} с  (+ .beats.json)`);
