/*!
 * MG — детерминированный движок моушн-графики Motion Studio.
 * Каждый кадр — чистая функция времени: comp.seek(t) рисует ровно то же самое при каждом вызове.
 * Открой композицию в браузере — появится плеер (пробел, ←/→, G — безопасные зоны).
 * Рендер: node engine/render.mjs index.html -o out.mp4
 * Лицензия: MIT.
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render');
  const ALPHA = qs.has('alpha');

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const map = (v, a, b, c = 0, d = 1, clip = true) => {
    const p = (v - a) / (b - a || 1e-9);
    return lerp(c, d, clip ? clamp(p) : p);
  };
  function rng(seed = 1) { // mulberry32 — используй вместо Math.random
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noise(x, seed = 0) { // гладкий 1D-шум в [-1,1]
    const h = (i) => { const r = Math.sin((i + seed * 101.3) * 127.1) * 43758.5453; return (r - Math.floor(r)) * 2 - 1; };
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(h(i), h(i + 1), u);
  }

  // ---------- easing ----------
  const pow = (k) => ({
    in: (p) => Math.pow(p, k),
    out: (p) => 1 - Math.pow(1 - p, k),
    inOut: (p) => (p < 0.5 ? Math.pow(2 * p, k) / 2 : 1 - Math.pow(2 - 2 * p, k) / 2),
  });
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (p) => {
      if (p <= 0) return 0; if (p >= 1) return 1;
      let t = p;
      for (let i = 0; i < 8; i++) { const e = sx(t) - p, d = dx(t); if (Math.abs(e) < 1e-6) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
      let lo = 0, hi = 1;
      if (Math.abs(sx(t) - p) > 1e-5) { t = p; for (let i = 0; i < 30; i++) { const v = sx(t); if (v < p) lo = t; else hi = t; t = (lo + hi) / 2; } }
      return sy(t);
    };
  }
  // Пружина в физическом времени. stiffness/damping/mass как в Framer Motion / Remotion.
  function springFn({ stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
    const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass)), v0 = -velocity;
    let f;
    if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); f = (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 + v0) / wd) * Math.sin(wd * t)); }
    else if (z === 1) f = (t) => 1 - Math.exp(-w0 * t) * (1 + (w0 + v0) * t);
    else { const s = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + s, r2 = -z * w0 - s, A = (v0 - r2) / (r2 - r1); f = (t) => 1 + A * Math.exp(r1 * t) - (1 + A) * Math.exp(r2 * t); }
    let settle = 0; // время успокоения: дальше 0.1% от цели не уходит
    for (let t = 0; t < 10; t += 1 / 240) { if (Math.abs(1 - f(t)) > 0.001) settle = t; }
    settle = Math.max(settle, 1 / 30);
    return { f, settle };
  }
  const EASE = {
    linear: (p) => p,
    in: pow(3).in, out: pow(3).out, inOut: pow(3).inOut,
    sine: { in: (p) => 1 - Math.cos((p * Math.PI) / 2), out: (p) => Math.sin((p * Math.PI) / 2), inOut: (p) => -(Math.cos(Math.PI * p) - 1) / 2 },
    quad: pow(2), cubic: pow(3), quart: pow(4), quint: pow(5),
    expo: { in: (p) => (p === 0 ? 0 : Math.pow(2, 10 * p - 10)), out: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)), inOut: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2) },
    circ: { in: (p) => 1 - Math.sqrt(1 - p * p), out: (p) => Math.sqrt(1 - (p - 1) * (p - 1)), inOut: (p) => (p < 0.5 ? (1 - Math.sqrt(1 - 4 * p * p)) / 2 : (Math.sqrt(1 - Math.pow(-2 * p + 2, 2)) + 1) / 2) },
    back: { out: (p, s = 1.4) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2), in: (p, s = 1.4) => (s + 1) * p * p * p - s * p * p },
    // «Профессиональные» кривые из замеров реальных роликов:
    land: bezier(0.16, 1, 0.3, 1),    // приземление: 70% пути за первые ~25% времени, длинный хвост
    leave: bezier(0.7, 0, 0.84, 0),   // уход: разгон и вылет
    swift: bezier(0.4, 0, 0.2, 1),    // стандарт UI
    snap: bezier(0.85, 0, 0.15, 1),   // резкий переход «щёлк»
    glide: bezier(0.65, 0, 0.35, 1),  // плавный проезд камеры
  };
  function resolveEase(e) {
    if (typeof e === 'function') return e;
    if (Array.isArray(e)) return bezier(...e);
    if (e && typeof e === 'object' && e.spring !== undefined) { const s = springFn(e.spring === true ? {} : e.spring); const fn = (p, dur) => s.f(p * dur); fn.settle = s.settle; fn.isSpring = true; return fn; }
    if (typeof e === 'string') {
      if (e === 'spring') return resolveEase({ spring: {} });
      const [a, b] = e.split('.');
      const g = EASE[a];
      if (typeof g === 'function') return g;
      if (g && g[b || 'out']) return g[b || 'out'];
    }
    return EASE.land;
  }

  // ---------- color ----------
  function parseColor(s) {
    if (typeof s !== 'string') return null;
    s = s.trim();
    let m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] ?? 1]; }
    return null;
  }
  const colorStr = (c) => `rgba(${c[0].toFixed(1)},${c[1].toFixed(1)},${c[2].toFixed(1)},${(+c[3]).toFixed(3)})`;

  // ---------- targets ----------
  let ROOT = document;
  const toEls = (t) => {
    if (!t) return [];
    if (typeof t === 'string') return Array.from(ROOT.querySelectorAll(t));
    if (t instanceof Element) return [t];
    // списки: массивы, NodeList, HTMLCollection (а не Vector3 с методом length())
    if (Array.isArray(t) || (typeof NodeList !== 'undefined' && t instanceof NodeList) || (typeof HTMLCollection !== 'undefined' && t instanceof HTMLCollection)) return Array.from(t).flatMap((x) => (typeof x === 'string' ? Array.from(ROOT.querySelectorAll(x)) : [x]));
    return [t];
  };

  // Трансформ-свойства складываются в один transform; остальные — в style.
  const DEFAULTS = { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, opacity: 1, blur: 0, brightness: 1, saturate: 1, clipT: 0, clipR: 0, clipB: 0, clipL: 0, radius: null, xp: 0, yp: 0 };
  const TRANSFORM = new Set(['x', 'y', 'z', 'xp', 'yp', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY', 'skewX']);
  const FILTER = new Set(['blur', 'brightness', 'saturate']);
  const CLIP = new Set(['clipT', 'clipR', 'clipB', 'clipL']);

  function parseVal(v) {
    if (typeof v === 'number') return { n: v, unit: '' };
    if (typeof v === 'string') {
      const c = parseColor(v); if (c) return { c };
      const m = v.match(/^(-?[\d.]+)([a-z%]*)$/i); if (m) return { n: parseFloat(m[1]), unit: m[2] };
    }
    return { raw: v };
  }
  function interp(a, b, p) {
    if (a.c && b.c) return { c: a.c.map((x, i) => lerp(x, b.c[i], p)) };
    if (a.n !== undefined && b.n !== undefined) return { n: lerp(a.n, b.n, p), unit: b.unit || a.unit };
    return p < 1 ? a : b;
  }
  const valToCss = (v) => (v.c ? colorStr(v.c) : v.n !== undefined ? v.n + (v.unit || '') : v.raw);

  // Состояние элемента: вычисляется заново на каждом seek.
  function applyState(el, st) {
    const has = (k) => st[k] !== undefined;
    const tr = [];
    if (has('xp') || has('yp')) tr.push(`translate(${st.xp ?? 0}%,${st.yp ?? 0}%)`);
    if (has('x') || has('y') || has('z')) tr.push(`translate3d(${(st.x ?? 0).toFixed(3)}px,${(st.y ?? 0).toFixed(3)}px,${(st.z ?? 0).toFixed(3)}px)`);
    if (has('rotateX')) tr.push(`rotateX(${st.rotateX}deg)`);
    if (has('rotateY')) tr.push(`rotateY(${st.rotateY}deg)`);
    if (has('rotate')) tr.push(`rotate(${st.rotate}deg)`);
    if (has('skewX')) tr.push(`skewX(${st.skewX}deg)`);
    if (has('scale') || has('scaleX') || has('scaleY')) { const s = st.scale ?? 1; tr.push(`scale(${(s * (st.scaleX ?? 1)).toFixed(5)},${(s * (st.scaleY ?? 1)).toFixed(5)})`); }
    if (tr.length) el.style.transform = tr.join(' ');
    if (has('opacity')) el.style.opacity = clamp(st.opacity).toFixed(4);
    const fl = [];
    if (has('blur') && st.blur > 0.01) fl.push(`blur(${st.blur.toFixed(2)}px)`);
    if (has('brightness') && st.brightness !== 1) fl.push(`brightness(${st.brightness.toFixed(3)})`);
    if (has('saturate') && st.saturate !== 1) fl.push(`saturate(${st.saturate.toFixed(3)})`);
    if (has('blur') || has('brightness') || has('saturate')) el.style.filter = fl.join(' ');
    if (has('clipT') || has('clipR') || has('clipB') || has('clipL')) el.style.clipPath = `inset(${st.clipT ?? 0}% ${st.clipR ?? 0}% ${st.clipB ?? 0}% ${st.clipL ?? 0}%${st.radius != null ? ` round ${st.radius}px` : ''})`;
    for (const k in st.css || {}) {
      const v = valToCss(st.css[k]);
      if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v;
    }
  }

  // ---------- не-DOM цели: three.js-объекты, униформы, любые JS-объекты ----------
  const isEl = (o) => typeof Element !== 'undefined' && o instanceof Element;
  const DEG = Math.PI / 180;
  // сокращения для THREE.Object3D: x/y/z → position, rotX/rotY/rotZ (градусы) → rotation, scale → scale (все оси)
  const OBJ3D = { x: 'position.x', y: 'position.y', z: 'position.z', rotX: 'rotation.x', rotY: 'rotation.y', rotZ: 'rotation.z', scaleX: 'scale.x', scaleY: 'scale.y', scaleZ: 'scale.z' };
  function objPath(o, k) { return o && o.isObject3D && OBJ3D[k] ? OBJ3D[k] : k; }
  function getObj(o, k) {
    if (o && o.isObject3D && k === 'scale') return o.scale.x;
    const path = objPath(o, k).split('.'); let v = o;
    for (const p of path) v = v == null ? undefined : v[p];
    if (v && v.isColor) return '#' + v.getHexString();
    if (o && o.isObject3D && /^rot[XYZ]$/.test(k)) return v / DEG;
    return v;
  }
  function setObj(o, k, val) {
    if (o && o.isObject3D && k === 'scale') { o.scale.setScalar(val.n); return; }
    const path = objPath(o, k).split('.'); let t = o;
    for (let i = 0; i < path.length - 1; i++) t = t[path[i]];
    const last = path[path.length - 1], cur = t[last];
    if (cur && cur.isColor && val.c) { cur.setStyle(`rgb(${Math.round(val.c[0])},${Math.round(val.c[1])},${Math.round(val.c[2])})`); return; }
    if (val.n === undefined) { t[last] = val.raw; return; }
    t[last] = o && o.isObject3D && /^rot[XYZ]$/.test(k) ? val.n * DEG : val.n;
  }

  // ---------- timeline ----------
  class Timeline {
    constructor() { this.tweens = []; this.calls = []; this.built = false; this.cursor = 0; this.orig = new WeakMap(); }
    _add(targets, from, to, o = {}) {
      const els = toEls(targets);
      const ease = resolveEase(o.ease ?? 'land');
      const dur = o.dur ?? (ease.isSpring ? ease.settle : 0.6);
      const at = o.at ?? this.cursor;
      const st = o.stagger || 0;
      const each = typeof st === 'number' ? st : st.each || 0;
      const n = els.length;
      const order = els.map((_, i) => i);
      if (st.from === 'end') order.reverse();
      if (st.from === 'center') order.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
      if (st.from === 'random') { const r = rng(st.seed || 7); order.sort(() => r() - 0.5); }
      // исходные значения не-DOM целей запоминаем при добавлении (до любых перемоток)
      for (const el of els) if (!isEl(el)) {
        if (!this.orig.has(el)) this.orig.set(el, {});
        const rec = this.orig.get(el);
        for (const key of new Set([...Object.keys(from || {}), ...Object.keys(to || {})])) if (!(key in rec)) rec[key] = getObj(el, key);
      }
      order.forEach((idx, k) => {
        this.tweens.push({ el: els[idx], from, to, at: at + k * each, dur, ease, i: this.tweens.length });
      });
      this.cursor = at + dur + Math.max(0, n - 1) * each;
      this.built = false;
      return this;
    }
    /** to: от текущего значения к props */
    to(t, props, o) { return this._add(t, null, props, o); }
    /** from: от props к текущему (значение до начала — props, как immediateRender) */
    from(t, props, o) { return this._add(t, props, null, o); }
    fromTo(t, a, b, o) { return this._add(t, a, b, o); }
    set(t, props, at = 0) { return this._add(t, null, props, { at, dur: 0, ease: 'linear' }); }
    /** Вызов fn(local, p) в каждом кадре в окне [at, at+dur] (и с p=0/1 вне окна) */
    call(fn, o = {}) { this.calls.push({ fn, at: o.at ?? this.cursor, dur: o.dur ?? 0, ease: resolveEase(o.ease ?? 'linear') }); return this; }
    /** Счётчик: число в элементе от a до b */
    count(t, a, b, o = {}) {
      const els = toEls(t), fmt = o.format || ((v) => Math.round(v).toLocaleString('ru-RU'));
      return this.call((_, p) => { const v = lerp(a, b, p); els.forEach((el) => (el.textContent = fmt(v))); }, { ease: 'expo.out', dur: 1.2, ...o });
    }
    /** Печать текста: появляется посимвольно с авторским ритмом (seed) */
    type(t, text, o = {}) {
      const els = toEls(t), cps = o.cps || 18, r = rng(o.seed || 3), caret = o.caret ?? '▍';
      const times = []; let acc = 0;
      for (let i = 0; i < text.length; i++) { times.push(acc); acc += (1 / cps) * (0.55 + r() * 0.9) * (text[i] === ' ' ? 1.5 : 1); }
      const at = o.at ?? this.cursor, dur = acc;
      this.calls.push({ at, dur: dur + 0.0001, ease: EASE.linear, fn: (local, p, raw) => {
        if (raw < 0) return; // до начала печати текст не трогаем (там может быть плейсхолдер)
        let n = 0; while (n < times.length && times[n] <= local) n++;
        const blink = Math.floor((local + 10) * 2) % 2 === 0;
        els.forEach((el) => (el.textContent = text.slice(0, n) + (caret && (n < text.length || blink) ? caret : '')));
      } });
      this.cursor = at + dur; return this;
    }
    label(at) { this.cursor = at; return this; }
    _build() {
      // для каждого элемента и свойства — отрезки по порядку начала; «from» без конца берёт базовое значение
      const map = new Map();
      const sorted = [...this.tweens].sort((a, b) => a.at - b.at || a.i - b.i);
      for (const tw of sorted) {
        if (!map.has(tw.el)) map.set(tw.el, {});
        const props = map.get(tw.el);
        const keys = new Set([...Object.keys(tw.from || {}), ...Object.keys(tw.to || {})]);
        for (const k of keys) {
          (props[k] = props[k] || []).push({ tw, k });
        }
      }
      for (const [el, props] of map) {
        const rec = isEl(el) ? null : this.orig.get(el) || {};
        for (const k in props) {
          let prev = null;
          const base = rec ? (rec[k] !== undefined ? parseVal(rec[k]) : null) : DEFAULTS[k] !== undefined && DEFAULTS[k] !== null ? parseVal(DEFAULTS[k]) : null;
          for (const seg of props[k]) {
            const f = seg.tw.from && seg.tw.from[k] !== undefined ? parseVal(seg.tw.from[k]) : (prev || base || parseVal(0));
            const tt = seg.tw.to && seg.tw.to[k] !== undefined ? parseVal(seg.tw.to[k]) : (prev || base || f);
            seg.a = f; seg.b = tt; prev = tt;
          }
        }
      }
      this.map = map; this.built = true;
    }
    seek(t) {
      if (!this.built) this._build();
      for (const [el, props] of this.map) {
        const dom = isEl(el);
        const st = { css: {} };
        for (const k in props) {
          const segs = props[k];
          let seg = null;
          for (const s of segs) { if (s.tw.at <= t + 1e-9) seg = s; else break; }
          let v;
          if (!seg) v = segs[0].a; // до первого твина: стартовое значение (from) или базовое
          else {
            const tw = seg.tw;
            const p = tw.dur <= 0 ? 1 : clamp((t - tw.at) / tw.dur);
            const e = tw.ease.isSpring ? tw.ease(p, tw.dur) : tw.ease(p);
            v = interp(seg.a, seg.b, e);
          }
          if (!dom) setObj(el, k, v);
          else if (TRANSFORM.has(k) || FILTER.has(k) || CLIP.has(k) || k === 'opacity' || k === 'radius') st[k] = v.n; else st.css[k] = v;
        }
        if (dom) applyState(el, st);
      }
      for (const c of this.calls) {
        const local = t - c.at, p = c.dur <= 0 ? (local >= 0 ? 1 : 0) : clamp(local / c.dur);
        c.fn(Math.max(0, local), c.ease(p), local);
      }
    }
    get duration() { return Math.max(0, ...this.tweens.map((t) => t.at + t.dur), ...this.calls.map((c) => c.at + c.dur)); }
  }

  // ---------- text split ----------
  function split(target, mode = 'words') {
    const out = [];
    toEls(target).forEach((el) => {
      if (el.dataset.mgSplit) { out.push(...el.querySelectorAll(mode === 'chars' ? '.c' : '.w')); return; }
      el.dataset.mgSplit = mode;
      const walk = (node) => {
        Array.from(node.childNodes).forEach((ch) => {
          if (ch.nodeType === 3) {
            const frag = document.createDocumentFragment();
            ch.textContent.split(/(\s+)/).forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
              const w = document.createElement('span'); w.className = 'w';
              if (mode === 'chars') { Array.from(part).forEach((c) => { const s = document.createElement('span'); s.className = 'c'; s.textContent = c; w.appendChild(s); out.push(s); }); }
              else { w.textContent = part; out.push(w); }
              frag.appendChild(w);
            });
            ch.replaceWith(frag);
          } else if (ch.nodeType === 1) walk(ch);
        });
      };
      walk(el);
    });
    return out;
  }
  /** Маска для «выезда из-под линии»: оборачивает каждый элемент в overflow:hidden */
  function mask(target, pad = '0.12em') {
    return toEls(target).map((el) => {
      const m = document.createElement('span');
      m.style.cssText = `display:inline-block;overflow:hidden;vertical-align:top;padding:${pad} 0.02em;margin:-${pad} -0.02em`;
      el.parentNode.insertBefore(m, el); m.appendChild(el); return el;
    });
  }

  /** Уменьшает font-size, пока элемент не влезет в maxWidth (px). Вызывай после загрузки шрифтов (comp.ready). */
  function fit(target, maxWidth, minPx = 8) {
    toEls(target).forEach((el) => {
      el.style.whiteSpace = 'nowrap';
      let fs = parseFloat(getComputedStyle(el).fontSize), guard = 0;
      const w = () => el.scrollWidth;
      if (w() <= maxWidth) return;
      fs = Math.max(minPx, fs * (maxWidth / w()) * 0.995); el.style.fontSize = fs + 'px';
      while (w() > maxWidth && fs > minPx && guard++ < 40) { fs *= 0.97; el.style.fontSize = fs + 'px'; }
    });
  }

  // ---------- composition ----------
  const FORMATS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350], '4k': [3840, 2160], '2:1': [1920, 960] };
  function safeFor(w, h) {
    const r = h / w;
    if (r > 1.6) return { T: h * 0.12, B: h * 0.2, L: w * 0.06, R: w * 0.13 };   // Reels/TikTok/Shorts
    if (r > 1.1) return { T: h * 0.08, B: h * 0.12, L: w * 0.06, R: w * 0.06 }; // 4:5
    return { T: h * 0.07, B: h * 0.07, L: w * 0.05, R: w * 0.05 };              // title safe 16:9 / 1:1
  }

  let current = null;
  function comp(opts = {}) {
    const q = qs.get('format');
    let [W, H] = FORMATS[q || opts.format] || [opts.width || 1920, opts.height || 1080];
    const c = {
      width: W, height: H, fps: opts.fps || 30, duration: opts.duration || 5,
      bg: opts.bg ?? '#0b0b0f', format: q || opts.format || `${W}x${H}`,
      timeline: new Timeline(), hooks: [], setups: [], t: 0, events: [],
      /** fn() — сборка сцены после загрузки шрифтов и картинок (нужно для MG.fit и замеров) */
      setup(fn) { this.setups.push(fn); return this; },
      tl() { return this.timeline; },
      /** fn(t) — вызывается в каждом кадре после таймлайна (canvas, three.js, GSAP: t => gsapTl.seek(t)) */
      onSeek(fn) { this.hooks.push(fn); return this; },
      /** метка события для звука и проверки (whoosh, hit, click...) — render.mjs сохранит их в .events.json */
      mark(t, name, extra = {}) { this.events.push({ t, name, ...extra }); return this; },
      async seek(t) {
        this.t = t;
        this.timeline.seek(t);
        for (const h of this.hooks) await h(t);
        syncMedia(t); syncCss(t);
        if (window.__mgMediaPending && window.__mgMediaPending.length) { await Promise.all(window.__mgMediaPending); window.__mgMediaPending = []; }
      },
    };
    const stage = document.getElementById('stage') || (() => { const s = document.createElement('div'); s.id = 'stage'; document.body.appendChild(s); return s; })();
    const safe = safeFor(W, H);
    const rs = document.documentElement.style;
    rs.setProperty('--W', W); rs.setProperty('--H', H);
    rs.setProperty('--u', (Math.min(W, H) / 100) + 'px');
    rs.setProperty('--vw', (W / 100) + 'px'); rs.setProperty('--vh', (H / 100) + 'px');
    rs.setProperty('--safeT', safe.T); rs.setProperty('--safeB', safe.B); rs.setProperty('--safeL', safe.L); rs.setProperty('--safeR', safe.R);
    stage.style.setProperty('--bg', ALPHA ? 'transparent' : (c.bg || 'transparent'));
    if (W < H) document.documentElement.classList.add('mg-portrait');
    c.safe = safe; c.stage = stage; c.portrait = W < H;
    c.ready = (async () => {
      await new Promise((r) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r()));
      // шрифты грузятся лениво — догружаем все заранее, иначе замеры (MG.fit) сделаются по запасному шрифту
      try { await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {}))); await document.fonts.ready; } catch (e) {}
      await Promise.all(Array.from(document.images).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      await new Promise((r) => requestAnimationFrame(() => r()));
      for (const fn of c.setups) await fn();
    })();
    current = c;
    window.__MG = c;
    if (RENDER) document.documentElement.classList.add('mg-render');
    else c.ready.then(() => player(c));
    return c;
  }

  // <video>/<audio data-start="2"> — синхронизация с временем композиции (только для превью/коротких вставок;
  // для монтажа поверх исходника используй engine/composite.mjs)
  function syncMedia(t) {
    document.querySelectorAll('video[data-start],audio[data-start]').forEach((m) => {
      const local = t - parseFloat(m.dataset.start || 0);
      if (!RENDER) return; // в превью играют сами
      m.pause();
      const target = clamp(local, 0, (m.duration || 1e9) - 0.001);
      if (Math.abs(m.currentTime - target) > 0.0005) {
        (window.__mgMediaPending = window.__mgMediaPending || []).push(new Promise((r) => { m.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); }));
        m.currentTime = target;
      }
    });
  }
  // CSS @keyframes и Web Animations тоже детерминированы: ставим currentTime
  function syncCss(t) {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
  }

  // ---------- preview player ----------
  function player(c) {
    const stage = c.stage;
    const bar = document.createElement('div');
    bar.setAttribute('data-preview-only', '');
    bar.innerHTML = `<button id="mgp">▶</button><input id="mgs" type="range" min="0" max="${c.duration}" step="${1 / c.fps}" value="0"><span id="mgt"></span><span class="mgk">${c.width}×${c.height} · ${c.fps} fps · пробел ←/→ G</span>`;
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:44px;display:flex;gap:10px;align-items:center;padding:0 12px;background:rgba(15,15,20,.92);color:#ddd;font:12px/1 Inter,system-ui;z-index:100000;backdrop-filter:blur(8px)';
    document.body.appendChild(bar);
    const style = document.createElement('style');
    style.textContent = '#mgp{width:32px;height:28px;border:0;border-radius:6px;background:#333;color:#fff;cursor:pointer}#mgs{flex:1;accent-color:#ff5a1f}.mgk{opacity:.55}#mgt{font-variant-numeric:tabular-nums;min-width:110px}';
    document.head.appendChild(style);
    const guide = document.createElement('div'); guide.className = 'safe-guide'; guide.setAttribute('data-preview-only', ''); stage.appendChild(guide);
    const fit = () => { const s = Math.min(innerWidth / c.width, (innerHeight - 44) / c.height); stage.style.transform = `translate(${(innerWidth - c.width * s) / 2}px,${(innerHeight - 44 - c.height * s) / 2}px) scale(${s})`; };
    addEventListener('resize', fit); fit();
    const btn = bar.querySelector('#mgp'), sl = bar.querySelector('#mgs'), tx = bar.querySelector('#mgt');
    let playing = false, t0 = 0, start = 0, t = parseFloat(qs.get('t') || 0);
    const show = (tt) => { t = tt; sl.value = tt; tx.textContent = `${tt.toFixed(2)} / ${c.duration.toFixed(2)} s · f${Math.round(tt * c.fps)}`; c.seek(tt); };
    const loop = (now) => { if (!playing) return; let tt = start + (now - t0) / 1000; if (tt > c.duration) { start = 0; t0 = now; tt = 0; } show(tt); requestAnimationFrame(loop); };
    const play = () => { playing = !playing; btn.textContent = playing ? '❚❚' : '▶'; if (playing) { start = t >= c.duration - 0.01 ? 0 : t; t0 = performance.now(); requestAnimationFrame(loop); } };
    btn.onclick = play;
    sl.oninput = () => { playing = false; btn.textContent = '▶'; show(parseFloat(sl.value)); };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); play(); }
      if (e.code === 'ArrowRight') show(Math.min(c.duration, t + (e.shiftKey ? 1 : 1 / c.fps)));
      if (e.code === 'ArrowLeft') show(Math.max(0, t - (e.shiftKey ? 1 : 1 / c.fps)));
      if (e.code === 'KeyG') document.documentElement.classList.toggle('mg-guides');
    });
    show(t);
    if (qs.has('autoplay')) play();
  }

  window.MG = { comp, Timeline, split, mask, fit, ease: EASE, bezier, spring: springFn, resolveEase, clamp, lerp, map, rng, noise, parseColor, FORMATS, RENDER, ALPHA, get current() { return current; },
    /** p(t, at, dur, ease) — прогресс 0..1 для ручной анимации в onSeek */
    p: (t, at, dur, ease = 'land') => resolveEase(ease)(clamp((t - at) / dur)) };
})();
