// Тесты Motion Studio, не требующие браузера: субтитры → слова, синтез звуков, CLI-парсер, FFT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubs } from '../.claude/skills/motion-studio/engine/words.mjs';
import { make, leadOf } from '../.claude/skills/motion-studio/engine/sfx.mjs';
import { parse } from '../.claude/skills/motion-studio/engine/cli.mjs';
import { fft, SR } from '../.claude/skills/motion-studio/engine/audio-lib.mjs';

test('SRT → слова: тайминги внутри фразы и порядок', () => {
  const srt = '1\n00:00:00,500 --> 00:00:02,400\nПривет, это тест\n\n2\n00:00:02,600 --> 00:00:04,000\nВторая фраза\n';
  const { cues, words } = parseSubs(srt);
  assert.equal(cues.length, 2);
  assert.equal(words.length, 5);
  assert.equal(words[0].s, 0.5);
  assert.ok(Math.abs(words[2].e - 2.4) < 1e-6, 'последнее слово кончается с фразой');
  for (let i = 1; i < words.length; i++) assert.ok(words[i].s >= words[i - 1].s);
});

test('VTT и whisper JSON', () => {
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nраз два\n';
  assert.equal(parseSubs(vtt).words[1].w, 'два');
  const js = JSON.stringify({ chunks: [{ text: ' один', timestamp: [0, 0.4] }, { text: ' два', timestamp: [0.4, 0.9] }] });
  const r = parseSubs(js);
  assert.deepEqual(r.words.map((w) => w.w), ['один', 'два']);
  assert.equal(r.words[1].e, 0.9);
});

test('SFX: все звуки детерминированы, без клиппинга', () => {
  for (const name of ['whoosh', 'swish', 'riser', 'impact', 'hit', 'pop', 'click', 'tap', 'tick', 'type', 'ding', 'sparkle', 'glitch', 'thump']) {
    const [a] = make(name, { seed: 2 }), [b] = make(name, { seed: 2 });
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), name + ' детерминирован');
    let peak = 0; for (const v of a) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.1 && peak <= 1, `${name}: пик ${peak}`);
    assert.ok(a.length > SR * 0.02);
  }
  assert.equal(leadOf('whoosh'), 0.43);
});

test('CLI-парсер', () => {
  const { pos, o } = parse(['in.html', '-o', 'out.mp4', '--alpha', '--fps', '30', '--stills', '1,2'], ['alpha']);
  assert.deepEqual(pos, ['in.html']);
  assert.equal(o.out, 'out.mp4'); assert.equal(o.alpha, true); assert.equal(o.fps, '30'); assert.equal(o.stills, '1,2');
});

test('FFT находит частоту синуса', () => {
  const n = 1024, re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 64 * i) / n);
  fft(re, im);
  let best = 0; for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
  assert.equal(best, 64);
});

test('3D-шрифты: кириллица и латиница на месте', async () => {
  const fs = await import('node:fs');
  for (const f of ['inter-display-bold', 'inter-display-black']) {
    const src = fs.readFileSync(new URL(`../.claude/skills/motion-studio/engine/lib/three/${f}.font.js`, import.meta.url), 'utf8');
    const json = JSON.parse(src.slice(src.indexOf('] = ') + 4, src.lastIndexOf(';')));
    for (const ch of 'АЯЁжщМОУШНInstrument0123456789') assert.ok(json.glyphs[ch] && json.glyphs[ch].ha > 0, `${f}: нет «${ch}»`);
    assert.equal(json.resolution, 1000);
  }
});
