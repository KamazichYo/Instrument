#!/usr/bin/env node
// Честная проверка готового рендера — цифры вместо «выглядит хорошо».
//   node qa.mjs out/video.mp4 [--expect 15] [--expect-audio] [--out out/qa] [--platform reels|youtube|shorts|tiktok]
// Пишет: qa/sheet.jpg (12 кадров, читать слева направо), qa/report.json; печатает отчёт с PASS/WARN/FAIL.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './cli.mjs';

const { pos, o } = parse(process.argv.slice(2), ['expect-audio', 'json']);
const file = pos[0];
if (!file) { console.error('usage: node qa.mjs <video> [--expect S] [--expect-audio] [--out dir]'); process.exit(2); }
const outDir = o.out || path.join(path.dirname(file), 'qa');
fs.mkdirSync(outDir, { recursive: true });

const run = (cmd, a, opts = {}) => { const r = spawnSync(cmd, a, { maxBuffer: 1 << 30, ...opts }); if (r.status !== 0 && !opts.ok) throw new Error(cmd + ' ' + a.join(' ') + '\n' + r.stderr); return r; };
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).stdout);
const v = probe.streams.find((s) => s.codec_type === 'video');
const a = probe.streams.find((s) => s.codec_type === 'audio');
const dur = parseFloat(probe.format.duration);
const [fn, fd] = v.r_frame_rate.split('/').map(Number);
const fps = fn / (fd || 1);
const res = { file, width: v.width, height: v.height, fps: +fps.toFixed(3), duration: +dur.toFixed(3), codec: v.codec_name, pix_fmt: v.pix_fmt, audio: !!a, checks: [] };
const check = (id, status, msg) => res.checks.push({ id, status, msg });

// ---- покадровый анализ на маленьком разрешении ----
const SW = 96, SH = Math.max(2, Math.round((SW * v.height) / v.width / 2) * 2);
const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${SW}:${SH}:flags=area,format=gray`, '-f', 'rawvideo', '-']).stdout;
const N = Math.floor(raw.length / (SW * SH));
const luma = [], diff = [];
for (let i = 0; i < N; i++) {
  const f = raw.subarray(i * SW * SH, (i + 1) * SW * SH);
  let s = 0, d = 0;
  const p = i ? raw.subarray((i - 1) * SW * SH, i * SW * SH) : null;
  for (let k = 0; k < f.length; k++) { s += f[k]; if (p) d += Math.abs(f[k] - p[k]); }
  luma.push(s / f.length); diff.push(p ? d / f.length : 0);
}
res.frames = N;
const still = (i) => diff[i] < 0.08; // кадр не изменился
// мёртвые участки (кроме финального удержания)
let endHold = 0; for (let i = N - 1; i > 0 && still(i); i--) endHold++;
const deadRuns = []; let run0 = -1;
for (let i = 1; i < N - endHold; i++) {
  if (still(i)) { if (run0 < 0) run0 = i; } else if (run0 >= 0) { if (i - run0 >= fps * 1.2) deadRuns.push([+(run0 / fps).toFixed(2), +(i / fps).toFixed(2)]); run0 = -1; }
}
const blank = luma.filter((l, i) => l < 3 && still(i)).length / N;
const flashes = []; for (let i = 1; i < N; i++) if (Math.abs(luma[i] - luma[i - 1]) > 90) flashes.push(+(i / fps).toFixed(2));
// энергия движения по секундам (средняя разница кадров)
const perSec = []; for (let s = 0; s < Math.ceil(N / fps); s++) { const seg = diff.slice(Math.floor(s * fps), Math.floor((s + 1) * fps)); perSec.push(+(seg.reduce((x, y) => x + y, 0) / (seg.length || 1)).toFixed(2)); }
res.motion_per_second = perSec;
res.end_hold_s = +(endHold / fps).toFixed(2);
res.dead_runs = deadRuns;
res.white_flashes = flashes;

check('G0 render', N > 1 && blank < 0.5 ? 'PASS' : 'FAIL', `${N} кадров, ${(blank * 100).toFixed(0)}% пустых чёрных`);
if (o.expect) { const e = parseFloat(o.expect); check('G0 length', Math.abs(dur - e) <= 0.1 ? 'PASS' : 'FAIL', `длина ${dur.toFixed(2)} с, план ${e} с`); }
check('G1 no dead time', deadRuns.length ? 'WARN' : 'PASS', deadRuns.length ? `статичные куски ≥1.2 с: ${deadRuns.map((r) => r.join('–')).join(', ')} — нужен «живой» элемент или это осознанная пауза?` : 'нет мёртвых кусков');
check('G2 end hold', res.end_hold_s <= 1.6 ? 'PASS' : 'WARN', `финальное удержание ${res.end_hold_s} с (норма 0.6–1.5)`);
check('G3 flashes', flashes.length > 2 ? 'WARN' : 'PASS', flashes.length ? `резкие вспышки яркости: ${flashes.slice(0, 8).join(', ')} с (белая вспышка на стыке? риск для светочувствительных)` : 'нет резких вспышек');

// ---- технические требования платформ ----
const vertical = v.height > v.width;
check('T1 codec', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' ? 'PASS' : (v.codec_name === 'prores' ? 'PASS' : 'WARN'), `${v.codec_name} ${v.pix_fmt}${v.codec_name === 'prores' ? ' (оверлей с альфой — для монтажки)' : ''}`);
check('T2 size', [1080, 1920, 3840, 2160, 1350].includes(Math.max(v.width, v.height)) ? 'PASS' : 'WARN', `${v.width}×${v.height}${vertical ? ' (вертикаль)' : ''}`);
if (vertical && dur > 180) check('T3 shorts', 'WARN', 'Shorts — до 3 минут, Reels — до 3 минут (рекомендуется 15–90 с)');

// ---- звук ----
if (a) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { ok: true });
  const t = r.stderr.toString();
  const I = parseFloat((t.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  const TP = parseFloat((t.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  res.loudness_lufs = I; res.true_peak_db = TP;
  const target = /podcast|youtube/.test(o.platform || '') ? -14 : -14;
  check('A1 loudness', Math.abs(I - target) <= 2 ? 'PASS' : 'WARN', `${I} LUFS (цель ${target} для соцсетей)`);
  check('A2 peak', TP <= -0.9 ? 'PASS' : 'WARN', `true peak ${TP} dBFS (≤ −1)`);
  const sil = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-50dB:d=0.8', '-f', 'null', '-'], { ok: true }).stderr.toString();
  const starts = [...sil.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +(+m[1]).toFixed(2));
  if (starts.length) check('A3 silence', 'WARN', `тишина ≥0.8 с с: ${starts.slice(0, 6).join(', ')} с`);
} else if (o['expect-audio']) check('A0 audio', 'FAIL', 'звуковой дорожки нет, а она планировалась');
else check('A0 audio', 'WARN', 'без звука (Reels/TikTok лучше с музыкой; для монтажки — норм)');

// ---- контактный лист: 12 кадров, подписи времени в отчёте ----
const times = Array.from({ length: 12 }, (_, i) => +((dur * (i + 0.5)) / 12).toFixed(2));
const sel = times.map((t) => `eq(n\\,${Math.min(N - 1, Math.round(t * fps))})`).join('+');
const tw = vertical ? 270 : 480;
run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select='${sel}',scale=${tw}:-2,tile=${vertical ? '6x2' : '4x3'}:padding=8:color=0x222222`, '-frames:v', '1', '-update', '1', '-q:v', '3', path.join(outDir, 'sheet.jpg')]);
res.sheet = path.join(outDir, 'sheet.jpg'); res.sheet_times = times;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(res, null, 1));

if (o.json) console.log(JSON.stringify(res, null, 1));
else {
  console.log(`\n${file}  ${res.width}×${res.height}  ${res.fps} fps  ${res.duration} с  ${res.codec}/${res.pix_fmt}  звук: ${a ? 'да' : 'нет'}`);
  for (const c of res.checks) console.log(`  ${c.status === 'PASS' ? '✔' : c.status === 'WARN' ? '△' : '✖'} ${c.status.padEnd(4)} ${c.id.padEnd(18)} ${c.msg}`);
  console.log(`  движение по секундам: ${perSec.join(' ')}`);
  console.log(`  лист кадров: ${res.sheet}  (моменты: ${times.join(', ')} с)\n  Открой лист и опиши каждый кадр одной фразой, прежде чем судить.`);
}
process.exit(res.checks.some((c) => c.status === 'FAIL') ? 1 : 0);
