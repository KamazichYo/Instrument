// Запуск: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processVoice, findPauses, loudnessLUFS, peakDb, limiter, denoise, spectralClean, encodeWav,
  PRESETS, OPTIONS, resolveSettings, DEFAULT_PICK,
} from '../assets/audio/dsp.js';

// без ИИ: здесь проверяем «обычную» обработку (ИИ — в ai.test.mjs)
const VOICE = resolveSettings(PRESETS.bareRoom.pick);

const SR = 48000;

// Простая детерминированная псевдослучайность
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

// «Речь»: гармонический сигнал с огибающей слогов; между фразами — паузы.
// Поверх всего — фоновый шум (как в комнате).
function synthVoice({ phrases = 6, phrase = 1.6, pause = 0.9, noise = 0.004, seed = 7 } = {}) {
  const r = rng(seed);
  const total = Math.round(SR * (0.6 + phrases * (phrase + pause)));
  const x = new Float32Array(total);
  let t = Math.round(0.6 * SR);
  const speech = [];
  for (let p = 0; p < phrases; p++) {
    const n = Math.round(phrase * SR);
    const f0 = 120 + 30 * Math.sin(p);
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      const syll = Math.max(0, Math.sin(Math.PI * 4 * tt)) ** 0.5; // ~4 слога/с
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * tt) / h;
      x[t + i] = 0.25 * syll * v + 0.02 * syll * r();
    }
    speech.push([t, t + n]);
    t += n + Math.round(pause * SR);
  }
  for (let i = 0; i < total; i++) x[i] += noise * r();
  return { x, speech };
}

test('паузы находятся и вырезаются, речь не трогается', () => {
  const { x, speech } = synthVoice();
  const res = findPauses(x, SR, { minPause: 0.3, keepPause: 0.12, sensitivity: 0.5 });
  // 5 пауз между фразами + начало + конец
  assert.ok(res.removed.length >= 6, 'вырезано пауз: ' + res.removed.length);
  for (const [a, b] of res.removed) {
    for (const [s, e] of speech) {
      assert.ok(b <= s || a >= e, `вырезка [${a},${b}] задевает речь [${s},${e}]`);
    }
  }
});

test('запись без пауз не режется', () => {
  const { x } = synthVoice({ phrases: 1, phrase: 5, pause: 0 });
  // уберём начальную тишину, чтобы было «сплошное» говорение
  const y = x.subarray(Math.round(0.6 * SR));
  const res = findPauses(y, SR, {});
  const removed = res.removed.reduce((s, [a, b]) => s + b - a, 0) / SR;
  assert.ok(removed < 0.3, 'вырезано слишком много: ' + removed);
});

test('полная цепочка: длительность, громкость, пики', () => {
  const { x } = synthVoice();
  const s = VOICE;
  const res = processVoice([x], SR, s);
  const st = res.stats;
  assert.ok(st.outDuration < st.inDuration - 3, `длительность ${st.inDuration} → ${st.outDuration}`);
  // У синтетической «пилы» пик-фактор после фильтров ~18 дБ (у живой речи меньше),
  // а лимитер намеренно не давит больше 6 дБ — поэтому до цели может не дотянуть, но не перелететь.
  assert.ok(st.outLufs > s.target - 4 && st.outLufs < s.target + 0.5, 'LUFS ' + st.outLufs);
  assert.ok(st.outPeak <= -1.4, 'пик ' + st.outPeak);
  for (let i = 0; i < res.output.length; i++) assert.ok(Number.isFinite(res.output[i]));
});

test('нормализация попадает в цель при обычном пик-факторе', () => {
  const { x } = synthVoice();
  const res = processVoice([x], SR, { ...VOICE, hpf: 0 });
  const res2 = processVoice([x], SR, { ...VOICE, hpf: 0, tone: 'none', expand: 0 });
  assert.ok(Math.abs(res2.stats.outLufs - -14) < 0.5, 'LUFS ' + res2.stats.outLufs);
  assert.ok(Math.abs(res.stats.outLufs - -14) < 1.5, 'LUFS ' + res.stats.outLufs);
  assert.ok(res.stats.outPeak <= -1.49);
});

test('шумодав снижает шум в паузах', () => {
  const { x, speech } = synthVoice({ noise: 0.01 });
  const { out } = denoise(x, SR, 0.7);
  const a = Math.round(speech[0][1] + 0.3 * SR);
  const b = a + Math.round(0.4 * SR);
  const rms = (y) => { let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i]; return Math.sqrt(s / (b - a)); };
  const before = 20 * Math.log10(rms(x));
  const after = 20 * Math.log10(rms(out));
  assert.ok(before - after > 8, `шум ${before.toFixed(1)} → ${after.toFixed(1)} дБ`);
});

test('лимитер держит потолок', () => {
  const r = rng(3);
  const x = new Float32Array(SR).map(() => r() * 3);
  limiter(x, SR, -1.5);
  assert.ok(peakDb(x) <= -1.49);
});

test('LUFS синуса 1 кГц −20 дБFS ≈ −23 LUFS (моно)', () => {
  const x = new Float32Array(SR * 3);
  const a = Math.pow(10, -20 / 20);
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * 1000 * i) / SR);
  const l = loudnessLUFS(x, SR);
  assert.ok(Math.abs(l - -23.0) < 0.3, 'LUFS ' + l);
});

test('WAV заголовок', () => {
  const buf = encodeWav(new Float32Array(100), SR);
  const dv = new DataView(buf);
  assert.equal(buf.byteLength, 244);
  assert.equal(dv.getUint32(24, true), SR);
});

test('скорость: 5 минут аудио', () => {
  const r = rng(11);
  const x = new Float32Array(SR * 300);
  for (let i = 0; i < x.length; i++) x[i] = 0.1 * Math.sin(i / 30) * (Math.sin(i / 20000) > 0 ? 1 : 0) + 0.003 * r();
  const t = Date.now();
  processVoice([x], SR, VOICE);
  const sec = (Date.now() - t) / 1000;
  console.log('5 мин обработано за', sec.toFixed(1), 'с');
  assert.ok(sec < 60);
});

// Эхо «голой комнаты»: 4 гребенчатых фильтра Шрёдера с RT60 ≈ 0.8 с
function addRoom(dry, rt60 = 0.8, wet = 0.6) {
  const out = Float32Array.from(dry);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round((ms / 1000) * SR);
    const g = Math.pow(10, (-3 * d) / (SR * rt60));
    const buf = new Float32Array(dry.length);
    for (let i = 0; i < dry.length; i++) buf[i] = dry[i] + (i >= d ? g * buf[i - d] : 0);
    for (let i = 0; i < dry.length; i++) out[i] += (wet / 4) * (buf[i] - dry[i]);
  }
  return out;
}

test('подавление эха: хвосты после фраз становятся тише', () => {
  const { x: dry, speech } = synthVoice({ noise: 0.0005, pause: 1.0 });
  const x = addRoom(dry);
  const { out } = spectralClean(x, SR, { noise: 0, reverb: 0.65, rt60: 0.7 });
  const e = (y, a, b) => { let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i]; return s / (b - a); };
  let tailIn = 0, tailOut = 0, spIn = 0, spOut = 0, spDry = 0;
  for (const [s0, s1] of speech.slice(0, -1)) {
    tailIn += e(x, s1 + 0.06 * SR, s1 + 0.4 * SR);
    tailOut += e(out, s1 + 0.06 * SR, s1 + 0.4 * SR);
    spIn += e(x, s0, s1);
    spOut += e(out, s0, s1);
    spDry += e(dry, s0, s1);
  }
  const before = 10 * Math.log10(spIn / tailIn);
  const after = 10 * Math.log10(spOut / tailOut);
  // сравниваем с «сухим» голосом: эхо внутри фраз тоже должно уйти, это не потеря
  const speechLoss = 10 * Math.log10(spDry / spOut);
  console.log(`речь/хвост: ${before.toFixed(1)} → ${after.toFixed(1)} дБ, потеря речи ${speechLoss.toFixed(1)} дБ`);
  assert.ok(after - before > 6, 'эхо подавлено слабо');  // «Средне»: ~7 дБ
  assert.ok(speechLoss < 3, 'съедена речь');
});

test('все варианты переключателей обрабатываются без ошибок', () => {
  const { x } = synthVoice({ phrases: 3 });
  for (const [group, def] of Object.entries(OPTIONS)) {
    for (const val of Object.keys(def.items)) {
      const res = processVoice([x], SR, resolveSettings({ ...DEFAULT_PICK, [group]: val }));
      assert.ok(res.output.length > 0, group + '=' + val);
      for (let i = 0; i < res.output.length; i += 97) assert.ok(Number.isFinite(res.output[i]), group + '=' + val);
    }
  }
  for (const p of Object.values(PRESETS)) processVoice([x], SR, resolveSettings(p.pick));
});
