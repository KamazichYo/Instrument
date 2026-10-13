// ИИ-очистка (DeepFilterNet3, WASM) — проверяем на настоящей нейросети.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processVoice, resolveSettings, DEFAULT_PICK } from '../assets/audio/dsp.js';

// В Node fetch не умеет file:// — подменяем для wasm; Cache Storage в Node нет — ai.js это переживает.
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.startsWith('file:')) return new Response(readFileSync(new URL(s)), { headers: { 'Content-Type': 'application/wasm', 'Content-Length': '0' } });
  return realFetch(u);
};
const { loadDeepFilter, enhance } = await import('../assets/audio/ai.js');

const SR = 48000;
function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
function voice(sec = 4) {
  const r = rng(3);
  const x = new Float32Array(SR * sec);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const syl = Math.max(0, Math.sin(Math.PI * 3 * t)) ** 0.6;
    let v = 0;
    for (let h = 1; h <= 15; h++) v += Math.sin(2 * Math.PI * 130 * h * t + h) / h;
    x[i] = 0.15 * syl * v + 0.01 * r();
  }
  return x;
}

test('ИИ не сдвигает звук по времени (синхрон с видео)', async () => {
  const df = await loadDeepFilter();
  const x = voice();
  const y = enhance(df, x, 100, 0);
  assert.equal(y.length, x.length);
  let best = -Infinity, lag = 0;
  for (let l = -2000; l <= 2000; l += 4) {
    let s = 0;
    for (let i = SR; i < 3 * SR; i += 5) s += x[i] * (y[i + l] || 0);
    if (s > best) { best = s; lag = l; }
  }
  assert.ok(Math.abs(lag) <= 8, 'сдвиг ' + lag + ' сэмплов');
});

test('ИИ убирает шум в паузах', async () => {
  const df = await loadDeepFilter();
  const r = rng(9);
  const x = voice(4);
  for (let i = 2 * SR; i < 3 * SR; i++) x[i] = 0.01 * r(); // секунда только шума
  const y = enhance(df, x, 100, 0);
  const rms = (z) => { let s = 0; for (let i = Math.round(2.2 * SR); i < Math.round(2.8 * SR); i++) s += z[i] * z[i]; return Math.sqrt(s / (0.6 * SR)); };
  const drop = 20 * Math.log10(rms(x) / rms(y));
  assert.ok(drop > 15, 'шум снижен на ' + drop.toFixed(1) + ' дБ');
});

test('настройки: ИИ включён по умолчанию и отключает обычный шумодав', () => {
  const s = resolveSettings(DEFAULT_PICK);
  assert.ok(s.ai > 0);
  assert.equal(s.denoise, 0);
  assert.equal(s.reverb, 0);
  const off = resolveSettings({ ...DEFAULT_PICK, ai: 'off', noise: 'mid' });
  assert.equal(off.ai, 0);
  assert.ok(off.denoise > 0);
});

test('цепочка с ИИ вызывает нейросеть и даёт результат', async () => {
  const df = await loadDeepFilter();
  const s = resolveSettings(DEFAULT_PICK);
  let called = 0;
  const res = processVoice([voice(3)], SR, s, () => {}, {
    enhance: (x, p) => { called++; return enhance(df, x, s.ai, s.aiBeta, p); },
  });
  assert.equal(called, 1);
  // синтетика с острыми пиками: лимитер намеренно не давит больше 6 дБ (см. dsp.test)
  assert.ok(res.stats.outLufs > -18 && res.stats.outLufs < -13.5, 'LUFS ' + res.stats.outLufs);
  assert.ok(res.stats.outPeak <= -1.49);
});
