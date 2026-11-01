#!/usr/bin/env node
// Сведение: музыка + голос + звуковые эффекты → громкость для соцсетей (−14 LUFS, true peak −1.5).
//   node mix.mjs --duration 15 --music assets/music.wav --vo assets/vo.mp3@0.4 --sfx sfx.json -o out/mix.wav
//   node mix.mjs ... --mux out/video.mp4 -o out/final.mp4      сразу вклеить звук в видео
// sfx.json: [{"t":1.2,"sfx":"whoosh","gain":-6}, {"t":3.0,"sfx":"assets/my-hit.wav"}]
//   Пик whoosh/swish/riser сам ставится на t (звук начинается раньше). offset — ручной сдвиг.
//   sfx — имя синтезированного звука (node sfx.mjs --list) или путь к файлу. Можно взять из <video>.events.json (comp.mark).
// Опции: --music-gain -8 (дБ)  --vo-gain 0  --no-duck  --lufs -14  --fade 0.6 (хвост музыки)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from './cli.mjs';
import { writeWav } from './audio-lib.mjs';
import { make, leadOf } from './sfx.mjs';

const argv = process.argv.slice(2);
const vos = []; for (let i = 0; i < argv.length; i++) if (argv[i] === '--vo') { vos.push(argv[i + 1]); argv.splice(i, 2); i--; }
const { o } = parse(argv, ['no-duck']);
const out = o.out || 'mix.wav';
const duration = parseFloat(o.duration || 0);
if (!duration) { console.error('нужен --duration S'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgmix-'));

const inputs = [], chains = [], labels = { vo: [], fx: [] };
const addInput = (file) => { inputs.push('-i', file); return inputs.filter((x) => x === '-i').length - 1; };
const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';

for (const spec of vos) {
  const [file, at = '0'] = spec.split('@');
  const i = addInput(file), ms = Math.round(parseFloat(at) * 1000);
  chains.push(`[${i}:a]${fmt},volume=${o['vo-gain'] || 0}dB,adelay=${ms}|${ms}[vo${i}]`); labels.vo.push(`[vo${i}]`);
}
let sfxList = [];
if (o.sfx) {
  const j = JSON.parse(fs.readFileSync(o.sfx, 'utf8'));
  sfxList = Array.isArray(j) ? j : (j.events || []).map((e) => ({ t: e.t, sfx: e.sfx || e.name, gain: e.gain, pitch: e.pitch, dur: e.dur }));
}
sfxList.forEach((e, k) => {
  let file = e.sfx;
  if (!fs.existsSync(file)) { file = path.join(tmp, `fx${k}.wav`); writeWav(file, make(e.sfx, { seed: k + 1, pitch: e.pitch || 1, dur: e.dur })); }
  const lead = e.offset !== undefined ? -e.offset : (fs.existsSync(e.sfx) ? 0 : leadOf(e.sfx));
  const i = addInput(file), ms = Math.max(0, Math.round((e.t - lead) * 1000));
  chains.push(`[${i}:a]${fmt},volume=${e.gain ?? -6}dB,adelay=${ms}|${ms}[fx${i}]`); labels.fx.push(`[fx${i}]`);
});
let music = null;
if (o.music) {
  const i = addInput(o.music), fade = parseFloat(o.fade || 0.6);
  chains.push(`[${i}:a]${fmt},atrim=0:${duration},volume=${o['music-gain'] ?? -6}dB,afade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}[mus]`); music = '[mus]';
}
const mixIn = [];
if (labels.vo.length) {
  chains.push(`${labels.vo.join('')}amix=inputs=${labels.vo.length}:normalize=0[voall]`);
  if (music && !o['no-duck']) {
    chains.push(`[voall]asplit=2[vo_a][vo_sc]`);
    chains.push(`${music}[vo_sc]sidechaincompress=threshold=0.04:ratio=6:attack=25:release=350:makeup=1[mduck]`);
    mixIn.push('[vo_a]', '[mduck]');
  } else { mixIn.push('[voall]'); if (music) mixIn.push(music); }
} else if (music) mixIn.push(music);
mixIn.push(...labels.fx);
if (!mixIn.length) { console.error('нечего сводить: дай --music, --vo или --sfx'); process.exit(2); }
const lufs = o.lufs || -14;
chains.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:dropout_transition=0,apad,atrim=0:${duration},loudnorm=I=${lufs}:TP=-2:LRA=11,aresample=48000,alimiter=limit=0.79:attack=1:release=50:level=false[out]`);

const wav = o.mux ? path.join(tmp, 'mix.wav') : out;
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', wav], { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
if (o.mux) {
  const m = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', o.mux, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', out.endsWith('.mov') ? 'pcm_s16le' : 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (m.status !== 0) process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✔ ${out}  (${vos.length} голос., ${sfxList.length} эффектов${o.music ? ', музыка' + (vos.length && !o['no-duck'] ? ' с приглушением под голос' : '') : ''}, ${lufs} LUFS)`);
