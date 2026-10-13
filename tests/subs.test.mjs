import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCues, cleanWords, toSRT, toVTT, toText, applyCase, splitWindows } from '../assets/subs/cues.js';

// «Расписание» слов, как его отдаёт Whisper (с пробелами и пунктуацией)
const W = (list) => list.map(([text, start, end]) => ({ text, start, end }));
const words = W([
  [' Привет,', 0.5, 0.9], [' друзья.', 0.95, 1.4],
  [' Сегодня', 2.0, 2.4], [' я', 2.45, 2.5], [' покажу,', 2.55, 3.0], [' как', 3.05, 3.2],
  [' убрать', 3.25, 3.6], [' эхо', 3.65, 3.9], [' из', 3.95, 4.05], [' записи', 4.1, 4.5],
  [' на', 4.55, 4.65], [' айфоне', 4.7, 5.2], [' за', 5.25, 5.35], [' пять', 5.4, 5.6], [' минут.', 5.65, 6.1],
]);

test('классика: предложения не склеиваются, строки ≤ 42 символов', () => {
  const cues = buildCues(words, 'classic');
  assert.equal(cues[0].text, 'Привет, друзья.');
  for (const c of cues) for (const line of c.text.split('\n')) assert.ok(line.length <= 42, line);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, 'наложение');
});

test('shorts: не больше 4 слов', () => {
  const cues = buildCues(words, 'shorts');
  for (const c of cues) assert.ok(c.text.split(/\s+/).length <= 4, c.text);
  assert.ok(cues.length >= 4);
});

test('по слову: одно слово в субтитре, все слова на месте', () => {
  const cues = buildCues(words, 'word');
  assert.equal(cues.length, words.length);
});

test('SRT и VTT форматы', () => {
  const cues = buildCues(words, 'classic');
  const srt = toSRT(cues);
  assert.match(srt, /^1\n00:00:00,500 --> 00:00:0\d,\d{3}\nПривет, друзья\.\n/);
  assert.match(toVTT(cues), /^WEBVTT\n\n00:00:00\.500 --> /);
  assert.equal(toText(cues).startsWith('Привет, друзья. Сегодня'), true);
});

test('регистр и точки', () => {
  assert.equal(applyCase('Привет, друзья.', 'nodots'), 'Привет, друзья');
  assert.equal(applyCase('эхо', 'upper'), 'ЭХО');
  assert.equal(applyCase('Что?', 'nodots'), 'Что?');
});

test('галлюцинации Whisper на тишине вырезаются', () => {
  const ws = W([[' Всем', 0, 0.3], [' пока.', 0.3, 0.6], [' Субтитры', 5, 5.5], [' сделал', 5.5, 6], [' DimaTorzok.', 6, 7]]);
  const out = cleanWords(ws);
  assert.equal(out.map((w) => w.text).join('').trim(), 'Всем пока.');
});

test('длинная запись режется на куски ≤ 28 с по паузам', () => {
  const sr = 16000;
  const x = new Float32Array(sr * 70);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    const pause = (t % 7) > 6.2; // пауза каждые 7 с
    x[i] = pause ? 0.0005 * Math.sin(i) : 0.2 * Math.sin(2 * Math.PI * 200 * t);
  }
  const w = splitWindows(x, sr);
  assert.equal(w[0].a, 0);
  assert.equal(w[w.length - 1].b, x.length);
  for (const win of w) {
    assert.ok(win.end - win.start <= 28.01);
    const cut = win.end % 7;
    if (win !== w[w.length - 1]) assert.ok(cut > 6.1 || cut < 0.1, 'резали не в паузе: ' + win.end);
  }
});

test('одинокое слово в конце фразы не висит отдельным субтитром', () => {
  const ws = W([[' Насколько', 1.4, 2.1], [' равных', 2.1, 2.6], [' частей', 2.6, 3.2], [' делится', 3.2, 3.9],
    [' расстояние', 3.9, 4.5], [' от', 4.5, 4.6], [' линии', 4.6, 5.1], [' подбородка', 5.1, 5.6], [' до', 5.6, 5.8],
    [' линии', 5.8, 6.3], [' роста', 6.3, 6.7], [' волос?', 6.7, 7.4], [' Да.', 9, 9.3]]);
  const cues = buildCues(ws, 'classic');
  assert.ok(cues[0].text.endsWith('волос?'), cues.map((c) => c.text).join(' | '));
  assert.equal(cues[1].text, 'Да.');
});
