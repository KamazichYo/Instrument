/* PAINT — масляная живопись для MG.
 * Мазки кистью с щетинками рисуются сразу в два холста: цвет и рельеф (высота краски).
 * Финальный проход (WebGL) освещает рельеф: блики на гребнях мазков, тени во впадинах, переплетение холста.
 * Всё детерминировано: случайность только из PAINT.rng(seed).
 *
 *   const pen = PAINT.surface(w, h)            // {c, h, cx, hx}: canvas цвета и рельефа + контексты
 *   PAINT.stroke(pen, x, y, angDeg, len, w, '#c33', { r, bend, var, thick })
 *   PAINT.path(pen, [[x,y],...], w, col, o)    // длинный мазок по линии (конечности, провода, нить)
 *   PAINT.rect / poly / ellipse(pen, ..., col, { ang, len, sw, dens, col: (u,v,x,y)=>rgb })  // закраска области мазками
 *   const imp = PAINT.impasto(canvas, W, H); imp.render(colorCanvas, heightCanvas)
 */
(function () {
  const P = {};
  // ---------- случайность ----------
  P.rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  P.hash = (...a) => { let h = 2166136261; for (const v of a) { h ^= Math.floor(v * 1000) | 0; h = Math.imul(h, 16777619); } return h >>> 0; };
  // ---------- цвет ----------
  const cache = new Map();
  const rgb = (c) => { if (typeof c !== 'string') return c; let v = cache.get(c); if (v) return v; const n = parseInt(c.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; cache.set(c, v); return v; };
  const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const css = (c, a) => (a == null || a >= 1 ? `rgb(${cl(c[0]) | 0},${cl(c[1]) | 0},${cl(c[2]) | 0})` : `rgba(${cl(c[0]) | 0},${cl(c[1]) | 0},${cl(c[2]) | 0},${a.toFixed(3)})`);
  const mix = (a, b, t) => { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const mul = (c, k) => { c = rgb(c); return [c[0] * k, c[1] * k, c[2] * k]; };
  const lum = (c) => { c = rgb(c); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };
  const vary = (c, r, amt, hue) => { c = rgb(c); const l = 1 + (r() - 0.5) * 2 * amt, h = hue * 255; return [c[0] * l + (r() - 0.5) * h, c[1] * l + (r() - 0.5) * h, c[2] * l + (r() - 0.5) * h]; };
  Object.assign(P, { rgb, css, mix, mul, lum, vary });

  // ---------- поверхность ----------
  P.surface = (w, h, opts = {}) => {
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
    const c = mk(), hh = opts.noHeight ? null : mk();
    const cx = c.getContext('2d', { willReadFrequently: false }), hx = hh ? hh.getContext('2d') : null;
    return { c, h: hh, cx, hx, W: w, H: h };
  };
  // перо поверх контекстов (для рисования в кадр): P.pen(ctxColor, ctxHeight)
  P.pen = (cx, hx) => ({ cx, hx });
  const gray = (v) => { const k = cl(v * 255) | 0; return `rgb(${k},${k},${k})`; };
  P.gray = gray;

  // ---------- мазок ----------
  // Лента вдоль квадратичной кривой: тупое начало (кисть полна краски), сухой рваный хвост.
  // o: r (rng), bend (изгиб, доля длины), var (разброс тона 0..), hue, alpha, thick (высота краски 0..1), nb (щетинок), taper, flat (без щетинок)
  const PTS = new Float32Array(256 * 4);
  function ribbon(pen, n, col, w, o, r) {
    const { cx, hx } = pen;
    const a = o.alpha == null ? 1 : o.alpha;
    // контур
    cx.beginPath();
    for (let i = 0; i < n; i++) { const k = i * 4, hw = PTS[k + 3]; cx.lineTo(PTS[k] - NX[i] * hw, PTS[k + 1] - NY[i] * hw); }
    for (let i = n - 1; i >= 0; i--) { const k = i * 4, hw = PTS[k + 3]; cx.lineTo(PTS[k] + NX[i] * hw, PTS[k + 1] + NY[i] * hw); }
    cx.closePath();
    const base = vary(col, r, o.var == null ? 0.06 : o.var, o.hue == null ? 0.02 : o.hue);
    cx.fillStyle = css(base, a); cx.fill();
    let g0 = 0;
    if (hx) {
      hx.beginPath();
      for (let i = 0; i < n; i++) { const k = i * 4, hw = PTS[k + 3]; hx.lineTo(PTS[k] - NX[i] * hw, PTS[k + 1] - NY[i] * hw); }
      for (let i = n - 1; i >= 0; i--) { const k = i * 4, hw = PTS[k + 3]; hx.lineTo(PTS[k] + NX[i] * hw, PTS[k + 1] + NY[i] * hw); }
      hx.closePath();
      const th = o.thick == null ? 0.6 : o.thick;
      g0 = 0.5 + th * (0.05 + r() * 0.1);
      hx.fillStyle = gray(g0); hx.globalAlpha = Math.min(1, a * 1.1); hx.fill(); hx.globalAlpha = 1;
    }
    // щетинки: полоски вдоль мазка разного тона, часть обрывается раньше (сухая кисть)
    const nb = o.flat ? 0 : (o.nb != null ? o.nb : w < 3.5 ? 0 : Math.min(7, 2 + ((w / 4) | 0)));
    if (!nb) return;
    const v = o.var == null ? 0.06 : o.var, hue = o.hue == null ? 0.02 : o.hue;
    for (let b = 0; b < nb; b++) {
      const off = -0.8 + (1.6 * (b + 0.5)) / nb + (r() - 0.5) * (0.9 / nb);
      const i0 = Math.floor(r() * n * 0.18), i1 = n - 1 - Math.floor(r() * r() * n * 0.45);
      if (i1 - i0 < 1) continue;
      const lw = (w / nb) * (0.5 + r() * 0.7);
      const cc = vary(base, r, v * 0.9, hue * 0.6);
      cx.beginPath();
      for (let i = i0; i <= i1; i++) { const k = i * 4, hw = PTS[k + 3] * off; cx.lineTo(PTS[k] + NX[i] * hw, PTS[k + 1] + NY[i] * hw); }
      cx.lineWidth = lw; cx.strokeStyle = css(cc, a * (0.3 + r() * 0.35)); cx.stroke();
      if (hx) {
        hx.beginPath();
        for (let i = i0; i <= i1; i++) { const k = i * 4, hw = PTS[k + 3] * off; hx.lineTo(PTS[k] + NX[i] * hw, PTS[k + 1] + NY[i] * hw); }
        hx.lineWidth = lw; hx.strokeStyle = gray(g0 + (b % 2 ? 0.02 : -0.018) + (r() - 0.5) * 0.012); hx.stroke();
      }
    }
  }
  const NX = new Float32Array(256), NY = new Float32Array(256);
  function shapeWidth(u, o) { // профиль ширины мазка
    const s = o.taper == null ? 1 : o.taper;
    const head = Math.min(1, u / 0.1), tail = Math.min(1, (1 - u) / (0.3 * s + 0.0001));
    return Math.sqrt(head) * Math.pow(Math.max(0, tail), 0.55);
  }
  // мазок от (x,y) в направлении ang (градусы) длиной len
  P.stroke = (pen, x, y, ang, len, w, col, o = {}) => {
    const r = o.r || P.rng(P.hash(x, y, len));
    const a = (ang * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const bend = (o.bend == null ? (r() - 0.5) * 0.25 : o.bend) * len;
    const n = Math.max(3, Math.min(64, Math.ceil(len / 5)));
    const x1 = x + dx * len, y1 = y + dy * len, mx = x + dx * len * 0.5 - dy * bend, my = y + dy * len * 0.5 + dx * bend;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), k = i * 4, iu = 1 - u;
      PTS[k] = iu * iu * x + 2 * iu * u * mx + u * u * x1;
      PTS[k + 1] = iu * iu * y + 2 * iu * u * my + u * u * y1;
      const tx = 2 * iu * (mx - x) + 2 * u * (x1 - mx), ty = 2 * iu * (my - y) + 2 * u * (y1 - my), L = Math.hypot(tx, ty) || 1;
      NX[i] = -ty / L; NY[i] = tx / L;
      PTS[k + 3] = (w / 2) * shapeWidth(u, o) * (1 + (o.wob || 0.08) * Math.sin(u * 9 + x));
    }
    ribbon(pen, n, col, w, o, r);
  };
  // мазок по ломаной/кривой (точки сглаживаются)
  P.path = (pen, pts, w, col, o = {}) => {
    if (pts.length < 2) return;
    const r = o.r || P.rng(P.hash(pts[0][0], pts[0][1], w));
    // ресэмпл по длине
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    const n = Math.max(3, Math.min(128, Math.ceil(total / 5)));
    let si = 0, acc = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / (n - 1)) * total;
      while (si < seg.length - 1 && acc + seg[si] < target) { acc += seg[si]; si++; }
      const f = seg[si] ? (target - acc) / seg[si] : 0, p0 = pts[si], p1 = pts[si + 1];
      const k = i * 4;
      PTS[k] = p0[0] + (p1[0] - p0[0]) * f; PTS[k + 1] = p0[1] + (p1[1] - p0[1]) * f;
      const L = seg[si] || 1; NX[i] = -(p1[1] - p0[1]) / L; NY[i] = (p1[0] - p0[0]) / L;
      const u = i / (n - 1);
      PTS[k + 3] = (w / 2) * (o.even ? Math.min(1, Math.min(u, 1 - u) * 12 + 0.35) : shapeWidth(u, o)) * (o.wfn ? o.wfn(u) : 1);
    }
    // сгладить нормали
    for (let i = 1; i < n - 1; i++) { const ax = NX[i - 1] + NX[i] * 2 + NX[i + 1], ay = NY[i - 1] + NY[i] * 2 + NY[i + 1], L = Math.hypot(ax, ay) || 1; NX[i] = ax / L; NY[i] = ay / L; }
    ribbon(pen, n, col, w, o, r);
  };
  // мазок-точка (листья, цветы, блики)
  P.dab = (pen, x, y, size, col, o = {}) => {
    const r = o.r || P.rng(P.hash(x, y, size));
    const ang = o.ang == null ? r() * 360 : o.ang + (r() - 0.5) * 40;
    const a = (ang * Math.PI) / 180, len = size * (o.elong || 1.3);
    P.stroke(pen, x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5, ang, len, size, col, Object.assign({ taper: 0.8, nb: size > 6 ? 3 : 0 }, o, { r }));
  };

  // круглый мазок-шарик (фрукт, мяч, бусина): заливка + рельеф-купол + пара мазков фактуры
  P.blob = (pen, x, y, rad, col, o = {}) => {
    const r = o.r || P.rng(P.hash(x, y, rad)), c = rgb(col), { cx, hx } = pen, a = o.alpha == null ? 1 : o.alpha;
    cx.fillStyle = css(vary(c, r, 0.05, 0.02), a); cx.beginPath(); cx.ellipse(x, y, rad, rad * (o.sy || 1), 0, 0, Math.PI * 2); cx.fill();
    if (hx) { const g = hx.createRadialGradient(x - rad * 0.3, y - rad * 0.35, rad * 0.1, x, y, rad); g.addColorStop(0, gray(0.5 + (o.thick == null ? 0.8 : o.thick) * 0.3)); g.addColorStop(1, gray(0.52)); hx.fillStyle = g; hx.globalAlpha = a; hx.beginPath(); hx.ellipse(x, y, rad, rad * (o.sy || 1), 0, 0, Math.PI * 2); hx.fill(); hx.globalAlpha = 1; }
    if (rad > 4) { P.stroke({ cx, hx: null }, x - rad * 0.6, y + rad * 0.2, -20, rad * 1.2, rad * 0.5, mul(c, 0.82), { r, alpha: 0.5 * a, nb: 2 }); P.stroke({ cx, hx: null }, x - rad * 0.45, y - rad * 0.45, -25, rad * 0.7, rad * 0.35, mix(c, '#ffffff', 0.45), { r, alpha: 0.7 * a, nb: 0 }); }
  };

  // ---------- закраска областей ----------
  // col: цвет или функция (u, v, x, y) → цвет. o: ang (градусы), angJ (разброс), len, sw, dens (перекрытие), var, thick, under (подмалёвок), clip
  function region(pen, bx, by, bw, bh, clipFn, col, o) {
    const r = o.r || P.rng(o.seed || P.hash(bx, by, bw, bh));
    const { cx, hx } = pen;
    const len = o.len || 26, sw = o.sw || 9, dens = o.dens || 1.3, ang = o.ang || 0, angJ = o.angJ == null ? 10 : o.angJ;
    const cf = typeof col === 'function' ? col : () => col;
    if (o.clip !== false) { cx.save(); clipFn(cx); cx.clip(); if (hx) { hx.save(); clipFn(hx); hx.clip(); } }
    if (o.under !== false) { // подмалёвок: плоский средний тон, чтобы между мазками не просвечивало
      cx.fillStyle = css(o.underCol ? rgb(o.underCol) : cf(0.5, 0.5, bx + bw / 2, by + bh / 2)); clipFn(cx); cx.fill();
      if (hx) { hx.fillStyle = gray(0.5 + (o.thick == null ? 0.6 : o.thick) * 0.06); clipFn(hx); hx.fill(); }
    }
    const a = (ang * Math.PI) / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const stepAlong = len * 0.62 / dens, stepAcross = sw * 0.62 / dens;
    const gx = ca * stepAlong + sa * stepAcross, gy = sa * stepAlong + ca * stepAcross;
    const ex = len * 0.5, ey = len * 0.5;
    let row = 0;
    for (let y = by - ey * 0.4; y < by + bh + ey * 0.3; y += gy, row++) {
      const shift = (row % 2) * gx * 0.5;
      for (let x = bx - ex * 0.6 + shift; x < bx + bw + ex * 0.2; x += gx) {
        const px = x + (r() - 0.5) * gx * 0.9, py = y + (r() - 0.5) * gy * 0.9;
        const u = (px - bx) / bw, v = (py - by) / bh;
        const c = cf(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), px, py);
        if (!c) continue;
        const an = ang + (r() - 0.5) * 2 * angJ + (o.flow ? o.flow(u, v) : 0);
        const L = len * (0.7 + r() * 0.6), Wd = sw * (0.75 + r() * 0.5);
        const ar = (an * Math.PI) / 180;
        P.stroke(pen, px - Math.cos(ar) * L * 0.5, py - Math.sin(ar) * L * 0.5, an, L, Wd, c, { r, var: o.var, hue: o.hue, thick: o.thick, alpha: o.alpha, nb: o.nb, flat: o.flat });
      }
    }
    if (o.clip !== false) { cx.restore(); if (hx) hx.restore(); }
  }
  P.rect = (pen, x, y, w, h, col, o = {}) => region(pen, x, y, w, h, (g) => { g.beginPath(); g.rect(x, y, w, h); }, col, o);
  P.ellipse = (pen, x, y, rx, ry, col, o = {}) => region(pen, x - rx, y - ry, rx * 2, ry * 2, (g) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }, col, o);
  P.poly = (pen, pts, col, o = {}) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    region(pen, x0, y0, x1 - x0, y1 - y0, (g) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }, col, o);
  };
  // плоская заливка без мазков (в оба холста) — для подмалёвка и мелочей
  P.fill = (pen, pathFn, col, o = {}) => {
    const { cx, hx } = pen;
    cx.fillStyle = css(rgb(col), o.alpha); pathFn(cx); cx.fill();
    if (hx && o.h != null) { hx.fillStyle = gray(o.h); hx.globalAlpha = o.alpha == null ? 1 : o.alpha; pathFn(hx); hx.fill(); hx.globalAlpha = 1; }
  };
  // мягкое свечение/лессировка (только цвет): радиальный градиент
  P.glow = (cx, x, y, r, col, a, mode) => {
    const c = rgb(col), g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(c, a)); g.addColorStop(0.45, css(c, a * 0.45)); g.addColorStop(1, css(c, 0));
    const prev = cx.globalCompositeOperation; if (mode) cx.globalCompositeOperation = mode;
    cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2); cx.globalCompositeOperation = prev;
  };
  // текст «густой краской»: заливка + рельеф (буквы выпуклые) + мазки внутри букв
  P.text = (pen, str, x, y, font, col, o = {}) => {
    const { cx, hx } = pen; const r = o.r || P.rng(P.hash(x, y, str.length));
    cx.save(); cx.font = font; cx.textAlign = o.align || 'center'; cx.textBaseline = o.base || 'alphabetic';
    cx.fillStyle = css(rgb(col), o.alpha); cx.fillText(str, x, y);
    if (hx) { hx.save(); hx.font = font; hx.textAlign = o.align || 'center'; hx.textBaseline = o.base || 'alphabetic'; hx.fillStyle = gray(0.5 + (o.thick == null ? 0.35 : o.thick)); hx.fillText(str, x, y); hx.restore(); }
    if (o.strokes) { // мазки по буквам: обрезка по тексту через source-atop
      const m = cx.measureText(str), w = m.width, asc = m.actualBoundingBoxAscent || 20, desc = m.actualBoundingBoxDescent || 4;
      const x0 = (o.align || 'center') === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      cx.globalCompositeOperation = 'source-atop';
      const sw = o.strokes, n = Math.ceil((w * (asc + desc)) / (sw * sw * 1.6));
      for (let i = 0; i < n; i++) { const px = x0 + r() * w, py = y - asc + r() * (asc + desc); P.stroke({ cx, hx: null }, px - sw, py, (o.sang || -8) + (r() - 0.5) * 30, sw * 2.6, sw, vary(col, r, 0.12, 0.03), { r, nb: 3 }); }
      cx.globalCompositeOperation = 'source-over';
    }
    cx.restore();
  };
  // спрайт: нарисовать содержимое в отдельные холсты (цвет+рельеф) один раз и потом ставить с поворотом
  P.sprite = (w, h, ox, oy, k, draw) => {
    const s = P.surface(w * k, h * k);
    s.cx.setTransform(k, 0, 0, k, ox * k, oy * k); s.hx.setTransform(k, 0, 0, k, ox * k, oy * k);
    draw({ cx: s.cx, hx: s.hx });
    s.cx.setTransform(1, 0, 0, 1, 0, 0); s.hx.setTransform(1, 0, 0, 1, 0, 0);
    return { c: s.c, h: s.h, w, h_: h, ox, oy, k };
  };
  // поставить спрайт: точка привязки (ox,oy) спрайта → (x,y), поворот rot (рад), масштаб sx/sy
  P.put = (pen, spr, x, y, rot = 0, sx = 1, sy = 1, alpha = 1) => {
    for (const [g, cv] of [[pen.cx, spr.c], [pen.hx, spr.h]]) {
      if (!g) continue;
      g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (sx !== 1 || sy !== 1) g.scale(sx, sy);
      if (alpha !== 1) g.globalAlpha = alpha;
      g.drawImage(cv, -spr.ox, -spr.oy, spr.w, spr.h_);
      g.restore();
    }
  };

  // ---------- импасто: финальный свет по рельефу (WebGL) ----------
  P.impasto = (canvas, W, H, opts = {}) => {
    canvas.width = W; canvas.height = H;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false });
    if (!gl) throw new Error('WebGL недоступен');
    const vs = `attribute vec2 p; varying vec2 v; void main(){ v = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }`;
    const fs = `precision highp float; varying vec2 v;
      uniform sampler2D uC, uH; uniform vec2 uRes; uniform float uK, uSpec, uWeave, uGrain, uVig, uWarm, uLift;
      uniform vec3 uL;
      float H(vec2 o){ return texture2D(uH, v + o / uRes).r; }
      vec2 sob(float k){
        float tl=H(vec2(-k,-k)), tc=H(vec2(0.,-k)), tr=H(vec2(k,-k)), ml=H(vec2(-k,0.)), mr=H(vec2(k,0.)), bl=H(vec2(-k,k)), bc=H(vec2(0.,k)), br=H(vec2(k,k));
        return vec2((tr + 2.*mr + br) - (tl + 2.*ml + bl), (bl + 2.*bc + br) - (tl + 2.*tc + tr)) / k; }
      float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }
      float weave(vec2 p){ vec2 q = p / 2.7; vec2 c = floor(q); vec2 f = fract(q);
        float warp = sin(f.x*3.14159), weft = sin(f.y*3.14159);
        float over = mod(c.x + c.y, 2.0);
        return mix(weft, warp, over) * (0.8 + 0.4*hash(c)) + vn(p*0.08)*0.5; }
      void main(){
        vec2 px = v * uRes;
        vec2 g1 = sob(1.0), g2 = sob(2.2);
        float gx = g1.x*0.45 + g2.x*0.55, gy = g1.y*0.45 + g2.y*0.55;
        float hc = H(vec2(0.));
        float w0 = weave(px);
        float wx = weave(px+vec2(1.,0.)) - weave(px-vec2(1.,0.)), wy = weave(px+vec2(0.,1.)) - weave(px-vec2(0.,1.));
        float paint = smoothstep(0.5, 0.56, hc); // где краска толстая, холст не виден
        gx = gx*uK + wx*uWeave*(1.-paint*0.85); gy = gy*uK + wy*uWeave*(1.-paint*0.85);
        vec3 n = normalize(vec3(-gx, -gy, 1.0));
        vec3 L = normalize(uL);
        float d = dot(n, L) - L.z;
        vec3 c = texture2D(uC, v).rgb;
        c *= 1.0 + d * 0.8;
        vec3 hv = normalize(L + vec3(0.,0.,1.));
        float s = pow(max(dot(n, hv), 0.), 34.);
        float edge = clamp(length(vec2(gx,gy))*1.6, 0., 1.);
        c += uSpec * s * edge * vec3(1., .96, .88);
        c *= 0.955 + 0.07 * w0 * (1.-paint*0.7);
        c += (hash(floor(px)) - 0.5) * uGrain;
        // лак: тёплый оттенок в светах, лёгкое поднятие теней
        float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c, c*vec3(1.04,1.0,0.93), uWarm*smoothstep(.3,1.,l));
        c = c*(1.-uLift) + uLift*vec3(.12,.10,.12);
        vec2 q = (v - 0.5) * vec2(1.0, 0.86); float rr = length(q);
        c *= 1.0 - uVig * smoothstep(0.32, 0.86, rr);
        gl_FragColor = vec4(clamp(c,0.,1.), 1.);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const tC = tex(0), tH = tex(1);
    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(U('uC'), 0); gl.uniform1i(U('uH'), 1); gl.uniform2f(U('uRes'), W, H);
    const set = (o) => {
      gl.uniform1f(U('uK'), o.relief ?? 3.0); gl.uniform1f(U('uSpec'), o.spec ?? 0.16); gl.uniform1f(U('uWeave'), o.weave ?? 0.35);
      gl.uniform1f(U('uGrain'), o.grain ?? 0.025); gl.uniform1f(U('uVig'), o.vignette ?? 0.32); gl.uniform1f(U('uWarm'), o.warm ?? 0.6); gl.uniform1f(U('uLift'), o.lift ?? 0.03);
      const l = o.light || [-0.5, -0.62, 0.62]; gl.uniform3f(U('uL'), l[0], l[1], l[2]);
    };
    set(opts);
    gl.viewport(0, 0, W, H);
    return {
      set,
      render(colorCanvas, heightCanvas) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tC); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, colorCanvas);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tH); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, heightCanvas);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  };
  window.PAINT = P;
})();
