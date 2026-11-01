#!/usr/bin/env node
// Рендер HTML-композиции (MG.comp или любой страницы с window.__MG = {width,height,fps,duration,seek(t)}) в видео.
//
//   node render.mjs film/index.html -o film/out/final.mp4            H.264 MP4 (yuv420p, bt709, faststart)
//   node render.mjs film/index.html -o out.mov --alpha               ProRes 4444 с альфой (оверлеи для CapCut/Premiere/Resolve)
//   node render.mjs film/index.html -o out.webm --alpha              VP9 с альфой (для веба)
//   node render.mjs film/index.html -o out.gif --scale 0.5           GIF с палитрой
//   node render.mjs film/index.html --stills 0.5,1.2,3 -o film/stills  PNG-кадры в указанные секунды
//
// Опции: --fps N  --from S --to S  --scale K (черновик 0.5)  --workers N  --blur N (моушн-блюр, N подкадров)
//        --shutter DEG (180)  --audio file  --crf N (16)  --format 9:16|16:9|1:1|4:5 (переопределить формат)
//        --png (захват без потерь)  --quiet
// Плюс пишет <out>.events.json — метки comp.mark() для звука и проверки.
import { parse, loadPlaywright } from './cli.mjs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = loadPlaywright();
const { pos, o: O } = parse(process.argv.slice(2), ['alpha', 'png', 'quiet']);
const opt = (k, d) => (O[k] === undefined ? d : O[k]);
const flag = (k) => O[k] === true;
const input = pos[0];
let out = O.out || null;
if (!input) { console.error('usage: node render.mjs <index.html> -o <out.mp4|.mov|.webm|.gif|dir> [--alpha] [--stills t1,t2] ...'); process.exit(2); }
if (!out) out = path.join(path.dirname(input), 'out', path.basename(input, '.html') + (O.stills ? '' : '.mp4'));
const quiet = flag('quiet');
const log = (...a) => { if (!quiet) console.error(...a); };

const alpha = flag('alpha');
const stills = opt('stills', null);
const scale = parseFloat(opt('scale', 1));
const blur = Math.max(1, parseInt(opt('blur', 1)));
const shutter = parseFloat(opt('shutter', 180)) / 360;
const usePng = alpha || flag('png');
const audio = opt('audio', null);
const crf = opt('crf', '16');
const fmt = opt('format', null);

function ff(argv, { stdin = false } = {}) {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + ': ' + argv.join(' '))))));
  return { p, done };
}

const url = (extra = '') => {
  const u = pathToFileURL(path.resolve(input));
  u.search = '?render=1' + (alpha ? '&alpha=1' : '') + (fmt ? '&format=' + encodeURIComponent(fmt) : '') + extra;
  return u.href;
};

async function openPage(browser, meta) {
  const ctx = await browser.newContext({ viewport: meta ? { width: meta.width, height: meta.height } : { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(url(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MG && window.__MG.width, null, { timeout: 20000 }).catch(() => { throw new Error('Композиция не зарегистрирована: нужен MG.comp(...) или window.__MG'); });
  await page.evaluate(() => window.__MG.ready);
  return { ctx, page };
}

async function grab(page, t) {
  await page.evaluate(async (tt) => { await window.__MG.seek(tt); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);
  return page.screenshot(usePng ? { type: 'png', omitBackground: alpha } : { type: 'jpeg', quality: 95 });
}

function encoderArgs(file, meta, fps) {
  const ext = path.extname(file).toLowerCase();
  const W = Math.round(meta.width * scale / 2) * 2, H = Math.round(meta.height * scale / 2) * 2;
  const sz = ['-vf', `scale=${W}:${H}:flags=lanczos`];
  if (ext === '.mov') return [...sz, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', alpha ? 'yuva444p10le' : 'yuv444p10le', '-vendor', 'apl0', file];
  if (ext === '.webm') return [...sz, '-c:v', 'libvpx-vp9', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', '-b:v', '0', '-crf', '28', '-row-mt', '1', file];
  if (ext === '.png' || ext === '.gif') throw new Error('internal');
  return [...sz, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-r', String(fps), file];
}

async function main() {
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--disable-web-security', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  try {
    const probe = await openPage(browser, null);
    const meta = await probe.page.evaluate(() => ({ width: window.__MG.width, height: window.__MG.height, fps: window.__MG.fps, duration: window.__MG.duration, events: window.__MG.events || [] }));
    await probe.ctx.close();
    const fpsArg = String(opt('fps', meta.fps));
    const fps = fpsArg.includes('/') ? fpsArg.split('/').reduce((a, b) => +a / +b) : parseFloat(fpsArg); // 30000/1001 тоже можно
    const from = parseFloat(opt('from', 0)), to = parseFloat(opt('to', meta.duration));
    log(`▶ ${input}  ${meta.width}×${meta.height}  ${fps} fps  ${from}–${to} s${scale !== 1 ? `  scale ${scale}` : ''}${alpha ? '  alpha' : ''}${blur > 1 ? `  blur×${blur}` : ''}`);

    // ----- stills -----
    if (stills) {
      fs.mkdirSync(out, { recursive: true });
      const { ctx, page } = await openPage(browser, meta);
      for (const s of String(stills).split(',').map(parseFloat)) {
        const buf = await page.evaluate(async (tt) => { await window.__MG.seek(tt); }, s).then(() => page.screenshot({ type: 'png', omitBackground: alpha }));
        const f = path.join(out, `still_${s.toFixed(2)}s.png`);
        fs.writeFileSync(f, buf); log('  ', f);
      }
      await ctx.close();
      return;
    }

    const isGif = /\.gif$/i.test(out);
    const finalOut = out;
    fs.mkdirSync(path.dirname(path.resolve(finalOut)), { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));
    const videoOut = isGif ? path.join(tmp, 'gif-src.mp4') : finalOut;
    const ext = path.extname(videoOut).toLowerCase();

    const nFrames = Math.max(1, Math.round((to - from) * fps));
    const cpu = os.cpus().length;
    const workers = Math.max(1, Math.min(parseInt(opt('workers', Math.max(1, Math.min(6, Math.floor(cpu / 2))))), Math.ceil(nFrames / 15)));
    const chunk = Math.ceil(nFrames / workers);
    let doneFrames = 0, lastLog = 0;
    const segs = [];

    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const a = w * chunk, b = Math.min(nFrames, a + chunk);
      if (a >= b) return;
      const seg = path.join(tmp, `seg${String(w).padStart(3, '0')}${ext}`);
      segs[w] = seg;
      const { ctx, page } = await openPage(browser, meta);
      const rate = fps * blur;
      const inArgs = ['-f', 'image2pipe', '-framerate', String(rate), '-c:v', usePng ? 'png' : 'mjpeg', '-i', '-'];
      const vf = blur > 1 ? ['-vf', `tmix=frames=${blur},select='eq(mod(n\\,${blur})\\,${blur - 1})',setpts=N/(${fps}*TB)`] : [];
      let enc = encoderArgs(seg, meta, fps);
      if (vf.length) { const i = enc.indexOf('-vf'); enc[i + 1] = vf[1] + ',' + enc[i + 1]; }
      const { p, done } = ff([...inArgs, ...enc], { stdin: true });
      for (let f = a; f < b; f++) {
        for (let s = 0; s < blur; s++) {
          const t = from + f / fps + (blur > 1 ? (s / blur) * shutter / fps : 0);
          const buf = await grab(page, Math.min(t, to - 1e-4));
          if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
        }
        doneFrames++;
        if (!quiet && Date.now() - lastLog > 1500) { lastLog = Date.now(); process.stderr.write(`  ${doneFrames}/${nFrames} кадров (${((doneFrames / nFrames) * 100).toFixed(0)}%)\r`); }
      }
      p.stdin.end();
      await done;
      await ctx.close();
    }));

    // ----- склейка сегментов + звук -----
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    const dur = (to - from).toFixed(3);
    const audioArgs = audio ? ['-ss', String(from), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', ext === '.webm' ? 'libopus' : ext === '.mov' ? 'pcm_s16le' : 'aac', '-b:a', '192k', '-t', dur] : [];
    const tmpOut = path.join(tmp, 'joined' + ext);
    await ff(['-f', 'concat', '-safe', '0', '-i', list, ...audioArgs, '-c:v', 'copy', ...(ext === '.mp4' ? ['-movflags', '+faststart'] : []), tmpOut]).done;
    fs.copyFileSync(tmpOut, videoOut);

    if (isGif) {
      const W = Math.round(meta.width * scale);
      await ff(['-i', videoOut, '-vf', `fps=${Math.min(fps, 25)},scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', finalOut]).done;
    }
    // события для звука/проверки
    const ev = await (async () => { const { ctx, page } = await openPage(browser, meta); const e = await page.evaluate(() => window.__MG.events || []); await ctx.close(); return e; })();
    fs.writeFileSync(finalOut + '.events.json', JSON.stringify({ width: meta.width, height: meta.height, fps, duration: meta.duration, from, to, events: ev }, null, 1));
    fs.rmSync(tmp, { recursive: true, force: true });
    const secs = (Date.now() - t0) / 1000;
    log(`\n✔ ${finalOut}  (${nFrames} кадров за ${secs.toFixed(1)} с, ${(nFrames / secs).toFixed(1)} к/с, ${workers} поток.)`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error('✖', e.message); process.exit(1); });
