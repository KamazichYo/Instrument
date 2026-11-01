# MG — API движка

Подключение (шаблоны уже так сделаны; `new.mjs` копирует `lib/` в проект):
```html
<link rel="stylesheet" href="lib/mg.css">
<div id="stage"> …сцена… </div>
<script src="lib/mg.js"></script>
<script> const comp = MG.comp({...}); … </script>
```

## Контракт рендера
Каждый кадр — **чистая функция времени**. `render.mjs` открывает страницу с `?render=1`, ждёт `comp.ready`, затем для каждого кадра вызывает `await __MG.seek(t)` и снимает скриншот. Значит:
- нельзя: `Math.random()`, `Date.now()`, `setTimeout`, CSS `transition`, состояние, которое копится между кадрами;
- можно: всё, что вычисляется из `t` — таймлайн MG, `comp.onSeek`, CSS `@keyframes` (MG перематывает их сам), `<video data-start>` (только короткие вставки, лучше `composite.mjs`).
`lint.mjs` проверяет детерминизм (один кадр дважды должен совпасть пиксель в пиксель).

Любая страница без MG тоже рендерится, если задаёт `window.__MG = { width, height, fps, duration, ready: Promise, seek(t) }`.

## MG.comp(opts)
```js
const comp = MG.comp({ format: '9:16', fps: 30, duration: 8, bg: '#0b0b0f' });
// format: '9:16' 1080×1920 · '16:9' 1920×1080 · '1:1' · '4:5' 1080×1350 · '4k' · '2:1'  (или width/height)
// ?format=... в URL и --format при рендере переопределяют
comp.width, comp.height, comp.fps, comp.duration, comp.safe {T,B,L,R}, comp.portrait, comp.stage
comp.tl()                 // основной таймлайн
comp.setup(fn)            // сборка после загрузки ВСЕХ шрифтов и картинок (замеры, MG.fit, split)
comp.onSeek(t => {})      // ручная отрисовка каждого кадра
comp.mark(t, 'whoosh', {gain:-6})   // метка для звука → <out>.events.json
```
CSS-переменные: `--W`, `--H` (числа), `--u` (1% меньшей стороны, px), `--vw`/`--vh` (1% ширины/высоты), `--safeT/B/L/R`. Классы: `.safe` (блок в безопасной зоне), `.mg-portrait` на `<html>` для вертикали, `[data-preview-only]` — видно только в превью, `[data-lint-ignore]`, `[data-small-ok]`.

## Таймлайн
```js
tl.from(target, props, { at, dur, ease, stagger })     // из props к текущему (до старта держит props)
tl.to(target, props, opts)                              // от текущего к props
tl.fromTo(target, fromProps, toProps, opts)
tl.set(target, props, at)
tl.count(target, 0, 1250, { at, dur, ease, format: v => Math.round(v) + ' ₽' })
tl.type(target, 'текст', { at, cps: 18, seed: 3, caret: '▍' })   // печать с живым ритмом
tl.call((local, p, raw) => {}, { at, dur, ease })      // своя логика в окне времени
```
- `target`: селектор, элемент, NodeList, массив селекторов/элементов.
- `at` по умолчанию — конец предыдущего твина; `dur` по умолчанию 0.6 (у пружины — время успокоения).
- `stagger`: число (с) или `{ each, from: 'start'|'end'|'center'|'random', seed }`.
- Пересечения: в каждый момент действует твин, начавшийся последним; `to` стартует от конечного значения предыдущего.

**Свойства**: `x, y, z` (px) · `xp, yp` (% от своего размера — вместо CSS translate(-50%)) · `scale, scaleX, scaleY, rotate, rotateX, rotateY, skewX` · `opacity` · `blur` (px) · `brightness, saturate` · `clipT, clipR, clipB, clipL` (% маски inset) + `radius` · любые CSS-свойства с числом/цветом (`width:'40%'`, `color:'#ff0'`, `background:'rgba(...)'`) · CSS-переменные (`'--draw': 1`).
⚠ Таймлайн перезаписывает `transform` и `filter` элемента целиком — центрирование делай через `xp/yp` или обёртку.

## Кривые
`'land'` `'leave'` `'swift'` `'snap'` `'glide'` · `'linear'` · `'in'|'out'|'inOut'` (cubic) · `'quad.out'`, `'cubic.inOut'`, `'quart.*'`, `'quint.*'`, `'expo.*'`, `'circ.*'`, `'sine.*'`, `'back.out'` · `[x1,y1,x2,y2]` · `{ spring: { stiffness: 170, damping: 26, mass: 1 } }` · своя функция `p => …`. Описание — `principles.md`.

## Утилиты
`MG.split(sel, 'words'|'chars')` → массив span `.w`/`.c` · `MG.mask(els, pad)` — обёртка overflow:hidden для выезда из-под линии · `MG.fit(sel, maxPx)` — уменьшить шрифт до ширины · `MG.rng(seed)` → `()=>[0,1)` · `MG.noise(x, seed)` → [-1,1] плавно · `MG.p(t, at, dur, ease)` → 0..1 · `MG.lerp, clamp, map` · `MG.spring(cfg)` → `{f(t), settle}` · `MG.bezier(...)`.

## Превью
Открой `index.html` в браузере: плеер внизу, пробел — пуск, ←/→ — кадр, Shift+←/→ — секунда, G — безопасная зона. `?t=2.5` — открыть на секунде, `?format=9:16` — другой формат, `?autoplay`.

## interop — другие библиотеки
**GSAP** (бесплатен полностью, все плагины): `npm i gsap` в папку проекта, `<script src="node_modules/gsap/dist/gsap.min.js">`.
```js
const g = gsap.timeline({ paused: true });
g.from('.title', { y: 100, opacity: 0, duration: 0.6, ease: 'expo.out' });
comp.onSeek(t => g.seek(t, false));
```
**three.js**: `renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })`; в `comp.onSeek(t => { mesh.rotation.y = t * 0.8; renderer.render(scene, camera); })`.
**Lottie** (lottie-web): `anim = lottie.loadAnimation({ ..., autoplay: false })`; `comp.onSeek(t => anim.goToAndStop(t * 1000, false))`. Для file:// встрои JSON через `animationData`.
**Canvas 2D / p5 / SVG** — рисуй в `onSeek` из `t`, частицы — из `MG.rng(seed)`.
**Видео внутри сцены**: `<video src="assets/clip.mp4" data-start="2" muted>` — MG перемотает. Playwright-Chromium может не уметь H.264 → конвертируй в WebM VP9 (`ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 30 assets/clip.webm`) или клади футаж через `composite.mjs`.

## Скрипты: все флаги
`render.mjs <html> -o <out> [--alpha] [--stills t,t] [--fps N|a/b] [--from S --to S] [--scale K] [--workers N] [--blur N --shutter 180] [--audio f] [--crf 16] [--format 9:16] [--png] [--quiet]`
`lint.mjs <html> [--samples 24] [--static]` · `qa.mjs <video> [--expect S] [--expect-audio] [--out dir] [--json]`
`words.mjs <srt|vtt|json> [-o f] [--embed html]` · `beats.mjs <audio> [-o f] [--min 70 --max 180]`
`music.mjs -o f --dur S [--bpm N] [--style pulse|hype|ambient|minimal] [--key A] [--seed N]`
`sfx.mjs --list | --all -o dir | <name> -o f [--seed N --pitch K --dur S]`
`mix.mjs --duration S [--music f --music-gain dB] [--vo f@t ...] [--vo-gain dB] [--sfx json] [--no-duck] [--lufs -14] [--mux video] -o out`
`composite.mjs plan.json -o out.mp4` · `new.mjs <tpl> <dir> [--format] [--force] | --list`
