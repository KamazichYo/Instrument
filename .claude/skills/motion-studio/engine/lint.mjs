#!/usr/bin/env node
// Проверка композиции до рендера: детерминизм, читаемость, безопасные зоны, вылеты за кадр, «шаблонность».
//   node lint.mjs film/index.html [--samples 24]
// Код выхода 1 — есть FAIL. Всё остальное — WARN: посмотри и реши осознанно.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, loadPlaywright } from './cli.mjs';

const { pos, o } = parse(process.argv.slice(2), ['static']);
const file = pos[0];
if (!file) { console.error('usage: node lint.mjs <index.html>'); process.exit(2); }
const html = fs.readFileSync(file, 'utf8');
const issues = [];
const add = (level, id, msg) => issues.push({ level, id, msg });
const code = html.replace(/<style[\s\S]*?<\/style>/g, '');

// ---- статика ----
if (!/MG\.comp\(|__MG\s*=/.test(html)) add('FAIL', 'contract', 'нет MG.comp(...) / window.__MG — рендер не найдёт композицию');
if (/Math\.random\(/.test(code)) add('FAIL', 'random', 'Math.random() — кадры будут разными при каждом рендере. Используй MG.rng(seed)');
if (/Date\.now\(|performance\.now\(|new Date\(/.test(code.replace(/\/\/.*$/gm, ''))) add('FAIL', 'clock', 'Date/performance.now — анимация должна зависеть только от t в seek(t)');
if (/setInterval\(|setTimeout\(/.test(code)) add('WARN', 'timers', 'таймеры не управляются seek(t) — анимация через них не попадёт в рендер');
if (/requestAnimationFrame\(/.test(code) && !/MG\./.test(code)) add('WARN', 'raf', 'requestAnimationFrame-цикл — рисуй в comp.onSeek(t => ...)');
if (/transition\s*:/.test(html)) add('WARN', 'css-transition', 'CSS transition не перематывается — используй таймлайн или @keyframes (их MG перематывает)');
if (/will-change/.test(html)) add('WARN', 'will-change', 'will-change на масштабируемом элементе даёт мыльный текст');
if (/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) add('WARN', 'network', 'внешние ссылки (шрифты/CDN/картинки) — рендер может пойти без них. Положи файлы в assets/');
if (/lorem ipsum/i.test(html)) add('FAIL', 'placeholder', 'Lorem ipsum в кадре');
if (/\b(Unlock|Revolutioni[sz]e|the future of|Meet [A-Z])\b|Откройте для себя|Революци|будущее уже здесь/i.test(html)) add('WARN', 'slogan', 'штампованный слоган — перепиши живыми словами бренда');

// ---- рантайм: вылеты текста, безопасная зона, мелкий текст ----
async function runtime() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const u = pathToFileURL(path.resolve(file)); u.search = '?render=1';
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(u.href);
    await page.waitForFunction(() => window.__MG, null, { timeout: 15000 });
    const meta = await page.evaluate(async () => { await window.__MG.ready; const c = window.__MG; return { w: c.width, h: c.height, d: c.duration, fps: c.fps, safe: c.safe || null }; });
    await page.setViewportSize({ width: meta.w, height: meta.h });
    errs.forEach((e) => add('FAIL', 'js-error', e));
    const n = +(o.samples || 24);
    const found = { out: new Map(), unsafe: new Map(), small: new Map() };
    let nondet = 0;
    for (let k = 0; k < n; k++) {
      const t = (meta.d * (k + 0.5)) / n;
      const r = await page.evaluate(async ({ t, meta }) => {
        await window.__MG.seek(t);
        const res = { out: [], unsafe: [], small: [] };
        const stage = document.getElementById('stage') || document.body;
        const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        while (walker.nextNode()) {
          const tn = walker.currentNode; const txt = tn.textContent.trim(); if (!txt) continue;
          const el = tn.parentElement; if (seen.has(el) || el.closest('[data-preview-only]') || el.closest('[data-lint-ignore]')) continue; seen.add(el);
          const cs = getComputedStyle(el);
          let vis = true; for (let p = el; p && p !== stage.parentElement; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) { vis = false; break; } }
          if (!vis) continue;
          const range = document.createRange(); range.selectNodeContents(tn); const b = range.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          const label = txt.slice(0, 28);
          if (b.left < -2 || b.top < -2 || b.right > meta.w + 2 || b.bottom > meta.h + 2) res.out.push(label);
          else if (meta.safe && (b.left < meta.safe.L - 4 || b.right > meta.w - meta.safe.R + 4 || b.top < meta.safe.T - 4 || b.bottom > meta.h - meta.safe.B + 4)) res.unsafe.push(label);
          const fsz = parseFloat(cs.fontSize) * (b.height / (el.getBoundingClientRect().height || b.height) || 1);
          if (fsz < meta.h * 0.018 && !el.closest('[data-small-ok]')) res.small.push(label + ` (${Math.round(parseFloat(cs.fontSize))}px)`);
        }
        return res;
      }, { t, meta });
      for (const key of ['out', 'unsafe', 'small']) for (const l of r[key]) { if (!found[key].has(l)) found[key].set(l, []); found[key].get(l).push(+t.toFixed(2)); }
    }
    // детерминизм: один и тот же кадр дважды
    const tt = meta.d * 0.37;
    const shot = async () => { await page.evaluate((t) => window.__MG.seek(t), tt); return (await page.screenshot({ type: 'png' })).toString('base64'); };
    const a = await shot(); await page.evaluate((t) => window.__MG.seek(t), meta.d * 0.8); const b = await shot();
    if (a !== b) { nondet++; add('FAIL', 'determinism', `кадр ${tt.toFixed(2)} с отличается при повторной перемотке — где-то состояние копится между кадрами`); }
    const fmt = (m) => [...m].slice(0, 6).map(([l, ts]) => `«${l}» @${ts.slice(0, 3).join(',')}с`).join('; ');
    // вылет за кадр — нормален во время входа/выхода; тревога, если текст за краем больше 25% выборок
    const longOut = [...found.out].filter(([, ts]) => ts.length > n * 0.25);
    if (longOut.length) add('WARN', 'offscreen', 'текст долго за краем кадра: ' + fmt(new Map(longOut)));
    const longUnsafe = [...found.unsafe].filter(([, ts]) => ts.length > n * 0.15);
    if (longUnsafe.length) add('WARN', 'safe-zone', `текст вне безопасной зоны ${meta.w}×${meta.h} (кнопки соцсетей/обрез): ` + fmt(new Map(longUnsafe)));
    if (found.small.size) add('WARN', 'small-text', `мелкий текст (<1.8% высоты кадра — не читается на телефоне): ` + fmt(found.small));
    return meta;
  } finally { await browser.close(); }
}

const meta = o.static ? null : await runtime().catch((e) => { add('FAIL', 'runtime', e.message); return null; });
console.log(`\n${file}${meta ? `  ${meta.w}×${meta.h} ${meta.fps} fps ${meta.d} с` : ''}`);
if (!issues.length) console.log('  ✔ замечаний нет');
for (const i of issues) console.log(`  ${i.level === 'FAIL' ? '✖' : '△'} ${i.level.padEnd(4)} ${i.id.padEnd(13)} ${i.msg}`);
process.exit(issues.some((i) => i.level === 'FAIL') ? 1 : 0);
