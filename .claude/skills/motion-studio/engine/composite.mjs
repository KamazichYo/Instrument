#!/usr/bin/env node
// Наложение графики на исходное видео (говорящая голова, скринкаст) — превью монтажа и готовый файл.
//   node composite.mjs plan.json -o out/preview.mp4
// plan.json:
// { "source": "work/source.mp4",
//   "clips": [
//     {"file": "out/01-stat.mp4", "in": 3.2},                        полноэкранная вставка (перебивка), звук исходника
//     {"file": "out/02-lower.mov", "in": 0.5, "x": 0, "y": 0},        оверлей с альфой поверх видео
//     {"file": "out/03-panel.mov", "in": 12, "out": 18, "scale": 0.5, "x": "W-w-60", "y": 60}
//   ],
//   "audio": "out/mix.wav"   (необязательно: заменить звук; иначе — звук исходника)
// }
// Клипы приводятся к fps и размеру исходника; длина клипа = его собственная (или out-in).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './cli.mjs';

const { pos, o } = parse(process.argv.slice(2));
if (!pos[0]) { console.error('usage: node composite.mjs plan.json -o out.mp4'); process.exit(2); }
const planPath = path.resolve(pos[0]);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const base = path.dirname(planPath);
const rel = (f) => (path.isAbsolute(f) ? f : path.join(base, f));
const out = o.out || path.join(base, 'out', 'preview.mp4');
const probe = (f) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f]).stdout.toString());
const src = probe(rel(plan.source));
const v = src.streams.find((s) => s.codec_type === 'video');
const hasAudio = src.streams.some((s) => s.codec_type === 'audio');
let W = v.width, H = v.height;
const rot = parseInt(v.tags?.rotate || v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation || 0);
if (Math.abs(rot) === 90) [W, H] = [H, W];
const [fn, fd] = v.r_frame_rate.split('/').map(Number); const fps = fn / (fd || 1);

const inputs = ['-i', rel(plan.source)];
const f = [`[0:v]fps=${fps},format=yuva420p[b0]`];
let last = 'b0';
plan.clips.forEach((c, k) => {
  const file = rel(c.file); const i = k + 1;
  const d = parseFloat(probe(file).format.duration);
  const end = c.out ?? c.in + d;
  inputs.push('-itsoffset', String(c.in), '-i', file);
  const sc = c.scale ? `scale=iw*${c.scale}:-2` : `scale=${W}:${H}:force_original_aspect_ratio=decrease`;
  f.push(`[${i}:v]fps=${fps},${sc},format=yuva420p[c${i}]`);
  const x = c.x ?? '(W-w)/2', y = c.y ?? '(H-h)/2';
  f.push(`[${last}][c${i}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${c.in},${end})'[b${i}]`);
  last = `b${i}`;
});
f.push(`[${last}]format=yuv420p[vout]`);
const audioMap = plan.audio ? ['-i', rel(plan.audio)] : [];
const aIdx = plan.clips.length + 1;
const args = ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...audioMap, '-filter_complex', f.join(';'), '-map', '[vout]',
  ...(plan.audio ? ['-map', `${aIdx}:a`] : hasAudio ? ['-map', '0:a'] : []),
  '-c:v', 'libx264', '-crf', String(o.crf || 18), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out];
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
console.log(`✔ ${out}  (${plan.clips.length} вставок поверх ${path.basename(plan.source)}, ${W}×${H} ${fps.toFixed(2)} fps)`);
