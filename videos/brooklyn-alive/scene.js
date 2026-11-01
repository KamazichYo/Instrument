/* Brooklyn Alive — сцена маслом: константы, камера, шарик, нить, физика, раскладка улицы и статичная живопись.
 * Две версии одного города: живая (солнце, цвет) и унылая (дождь, серость). Геометрия мазков у них общая (одни сиды),
 * поэтому на границе мазок продолжается, а цвет «высыхает». */
'use strict';
const W = 1920, H = 1080, BASE = 850, SIDE = 895, ROAD = 918, R = 34;
const PK = 1.25;                                    // пикселей холста на единицу мира (запас под наезд камеры)
const WX0 = -80, WY0 = -360, WW = 5760, WH = 1500;  // холст мира
const DURATION = 12.4;

// ---------- палитра ----------
let MODE = 'alive';
const A = () => MODE === 'alive';
function dullRGB(c) {
  c = PAINT.rgb(c);
  const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255, v = (0.19 + 0.54 * l) * 255;
  return [v * 0.95 + c[0] * 0.03, v * 0.99 + c[1] * 0.03, v * 1.05 + c[2] * 0.03];
}
const C = (hex) => (A() ? PAINT.rgb(hex) : dullRGB(hex));
const WARM = [255, 208, 150], COOL = [52, 60, 118];
// свет/тень по логике солнца (справа сверху): k > 0 — освещено, k < 0 — в тени. В унылой — плоский рассеянный свет.
function L(hex, k) {
  const c = C(hex);
  if (A()) {
    if (k >= 0) { const m = PAINT.mix(c, WARM, k * 0.42); return [m[0] * (1 + k * 0.16), m[1] * (1 + k * 0.12), m[2] * (1 + k * 0.05)]; }
    const m = PAINT.mix(c, COOL, -k * 0.5); return [m[0] * (1 + k * 0.3), m[1] * (1 + k * 0.28), m[2] * (1 + k * 0.18)];
  }
  const f = 1 + k * 0.1; return [c[0] * f, c[1] * f, c[2] * f];
}
// 2D-шум для пятен света и грязи
function vnoise(x, y, s = 0) {
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263 + s * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.3, y * 2.3, s + 7) * 0.3 + vnoise(x * 5.1, y * 5.1, s + 13) * 0.1;

// ---------- реквизит и сюжет ----------
const STOOP_X = 900, TAXI_X = 1500, STAND_X = 2620, MAIL_X = 3650, BIN_X = 2150;
const BOUNCES = [ // [x мира, высота поверхности, время касания, сила удара]
  [380, SIDE, 0.5, 0.6], [STOOP_X, 748, 1.5, 0.8], [TAXI_X + 40, 842, 2.5, 1.0], [2060, SIDE, 3.5, 0.7], [STAND_X, 640, 4.5, 1.0],
  [3150, SIDE, 5.5, 0.6], [MAIL_X, 792, 6.5, 0.85], [4160, SIDE, 7.5, 0.7], [4660, SIDE, 8.5, 0.8],
];
const TREES = [620, 1820, 2980, 4010, 4900, 5750];
const LAMPS = [260, 1300, 2260, 3420, 4560, 5600];
const EXIT_T = 9.15, DROP_T0 = 9.45, LAND_T = 10.0;

// ---------- траектория шарика ----------
function ballWorld(t) {
  const b = BOUNCES;
  if (t <= b[0][2]) { const p = MG.clamp(t / b[0][2], -1, 1); return { x: -140 + (b[0][0] + 140) * p, y: -160 + (b[0][1] - R + 160) * p * p, vx: (b[0][0] + 140) / 0.5, vy: (2 * (b[0][1] - R + 160) * p) / 0.5, surf: b[0][1] }; }
  for (let i = 0; i < b.length - 1; i++) {
    const [x0, s0, t0] = b[i], [x1, s1, t1] = b[i + 1];
    if (t <= t1) {
      const d = t1 - t0, p = (t - t0) / d, hgt = 230 + Math.max(0, s0 - s1) * 0.6, y0 = s0 - R, y1 = s1 - R;
      return { x: x0 + (x1 - x0) * p, y: y0 + (y1 - y0) * p - 4 * hgt * p * (1 - p), vx: (x1 - x0) / d, vy: (y1 - y0 - 4 * hgt * (1 - 2 * p)) / d, surf: s0 + (s1 - s0) * p };
    }
  }
  const [x8, s8, t8] = b[b.length - 1], p = MG.clamp((t - t8) / (EXIT_T - t8), 0, 1.4), y8 = s8 - R;
  return { x: x8 + 760 * p, y: y8 + (-420 - y8) * (1 - (1 - p) * (1 - p)), vx: 760 / (EXIT_T - t8), vy: ((-420 - y8) * 2 * (1 - p)) / (EXIT_T - t8), surf: SIDE };
}
// ---------- камера: центр в мире cx, зум z, низ кадра yb. Экран = W/2 + (x−cx)·z, H + (y−yb)·z ----------
const CAM_END_T = 10.7, Z_ACT = 1.45, Z_END = 0.78, YB_ACT = 1045, YB_END = 1045;
const pull = (t) => MG.ease.glide(MG.clamp((t - 8.75) / (CAM_END_T - 8.75)));
const zoom = (t) => Z_ACT + (Z_END - Z_ACT) * pull(t) + 0.035 * MG.ease.sine.inOut(MG.clamp((t - CAM_END_T) / (DURATION - CAM_END_T)));
const yb = (t) => YB_ACT + (YB_END - YB_ACT) * pull(t);
function camC(t) {
  const z = zoom(t), half = W / 2 / z;
  const follow = (tt) => { let s = 0; for (let k = 0; k < 9; k++) s += ballWorld(Math.min(tt - k * 0.05, EXIT_T)).x; return s / 9 + (0.1 * W) / Z_ACT; };
  const raw = t < 8.75 ? follow(t) : follow(8.75) + (3700 - follow(8.75)) * pull(t);
  return MG.clamp(raw, half - 40, WX0 + WW - half - 60);
}
function shake(t) {
  let x = 0, y = 0;
  BOUNCES.forEach(([, , ct, k]) => { const d = t - ct; if (d > 0 && d < 0.5) { const a = (k > 0.9 ? 1 : k * 0.4) * 7 * Math.exp(-d * 9); y += a * Math.cos(d * 70); x += a * 0.4 * Math.sin(d * 55); } });
  const d = t - LAND_T; if (d > 0 && d < 0.6) y += 9 * Math.exp(-d * 8) * Math.cos(d * 60);
  return { x, y };
}
function camera(t) { const z = zoom(t), sh = shake(t), cx = camC(t), y0 = yb(t); return { z, cx, yb: y0, sx: sh.x, sy: sh.y, ox: W / 2 - cx * z + sh.x, oy: H - y0 * z + sh.y }; }
const toScreen = (x, y, cam) => ({ x: cam.ox + x * cam.z, y: cam.oy + y * cam.z });

// ---------- нить: верх и низ экрана → шарик ----------
function threadAt(t, cam) {
  if (t > EXIT_T + 0.3) return null;
  cam = cam || camera(t);
  const tb = Math.min(t, EXIT_T), bw = ballWorld(Math.min(t, EXIT_T));
  const B = toScreen(bw.x, bw.y, cam), lag = toScreen(ballWorld(Math.max(-0.2, tb - 0.2)).x, 0, cam).x;
  const Atop = { x: lag, y: -4 }, Abot = { x: lag, y: H + 4 };
  let vib = Math.sin(t * 11) * 1.5;
  for (const b of BOUNCES) if (t > b[2]) vib += 26 * Math.exp(-(t - b[2]) * 4.5) * Math.sin((t - b[2]) * 2 * Math.PI * 6.5);
  const seg = (P0, P1, amp) => { const mx = (P0.x + P1.x) / 2, my = (P0.y + P1.y) / 2, dx = P1.x - P0.x, dy = P1.y - P0.y, Ln = Math.hypot(dx, dy) || 1; return { x: mx - (dy / Ln) * amp, y: my + (dx / Ln) * amp }; };
  const c1 = seg(Atop, B, vib), c2 = seg(B, Abot, -vib);
  const q = (P0, Cc, P1, u) => ({ x: (1 - u) * (1 - u) * P0.x + 2 * (1 - u) * u * Cc.x + u * u * P1.x, y: (1 - u) * (1 - u) * P0.y + 2 * (1 - u) * u * Cc.y + u * u * P1.y });
  const pts = []; for (let i = 0; i <= 16; i++) pts.push(q(Atop, c1, B, i / 16)); for (let i = 1; i <= 16; i++) pts.push(q(B, c2, Abot, i / 16));
  return { pts, Atop, Abot, B, c1, c2 };
}
// живая ли точка мира в момент t (левее нити)
function aliveAt(xw, yw, t) {
  if (t > EXIT_T + 0.3) return true;
  const cam = camera(t), th = threadAt(t, cam), s = toScreen(xw, yw, cam), p = th.pts;
  for (let i = 1; i < p.length; i++) if ((p[i - 1].y <= s.y && s.y <= p[i].y) || (p[i].y <= s.y && s.y <= p[i - 1].y)) {
    const f = (s.y - p[i - 1].y) / (p[i].y - p[i - 1].y || 1); return s.x < p[i - 1].x + (p[i].x - p[i - 1].x) * f;
  }
  return s.x < th.B.x;
}
// когда граница проходит через точку (первый живой момент)
const TPASS = new Map();
function tPass(xw, yw) {
  const key = Math.round(xw) + ':' + Math.round(yw); if (TPASS.has(key)) return TPASS.get(key);
  let lo = 99;
  for (let t = 0; t <= EXIT_T + 0.32; t += 1 / 60) if (aliveAt(xw, yw, t)) { lo = t; break; }
  if (lo < 99) { let a = lo - 1 / 60, b = lo; for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (aliveAt(xw, yw, m)) b = m; else a = m; } lo = b; }
  TPASS.set(key, lo); return lo;
}

// ---------- физика (всё — замкнутые формулы от t) ----------
const PHY = {
  // переход «уныло → живо»: пружина 0→1 с перелётом, стартует, когда граница прошла
  wake(d, f = 1.5, z = 0.42) { if (d <= 0) return 0; const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * d) * (Math.cos(wd * d) + ((z * w) / wd) * Math.sin(wd * d)); },
  osc: (d, f, k) => (d > 0 ? Math.exp(-k * d) * Math.sin(2 * Math.PI * f * d) : 0),
  // толчок от отскоков шарика: волна расходится от точки удара (задержка по расстоянию), знак — от удара
  kick(x, y, t, f = 3, k = 4, range = 260) {
    let s = 0;
    for (const b of BOUNCES) { const dx = x - b[0], dist = Math.hypot(dx, y - b[1]); if (dist > range * 4) continue; const d = t - b[2] - dist / 2200; if (d <= 0 || d > 3) continue; s += b[3] * Math.exp(-dist / range) * (dx < 0 ? -1 : 1) * PHY.osc(d, f, k); }
    return s;
  },
  // ближайший удар рядом: сколько прошло и сила (для «вздрогнул»)
  near(x, y, t, range = 300) { let best = null; for (const b of BOUNCES) { const dist = Math.hypot(x - b[0], y - b[1]); const d = t - b[2] - dist / 2200; if (d > 0 && dist < range && (!best || d < best.d)) best = { d, k: b[3] * (1 - dist / range), dir: x < b[0] ? -1 : 1 }; } return best; },
  // ветер: в живой — тёплый лёгкий бриз туда-сюда, в унылой — порывистый косой ветер с дождём влево
  wind(x, t) { return A() ? 0.32 * Math.sin(t * 1.15 + x * 0.003) + 0.22 * MG.noise(t * 0.55 + x * 0.0013, 3) + 0.08 : -0.5 + 0.32 * MG.noise(t * 0.9 + x * 0.002, 5) - 0.12 * Math.sin(t * 2.4 + x * 0.01); },
  // прыжки по земле с потерей энергии: высота над землёй через d секунд (v0 вверх, g, e — упругость)
  hop(d, v0, g = 2400, e = 0.45) { if (d <= 0) return 0; let v = v0; for (let i = 0; i < 6; i++) { const T = (2 * v) / g; if (d < T) return v * d - 0.5 * g * d * d; d -= T; v *= e; } return 0; },
};

// ---------- раскладка улицы ----------
const BUILD = [
  { t: 'walkup', x: -80, w: 410, fl: 4, fac: '#c9a67c' },
  { t: 'brick', x: 330, w: 430, fl: 3, fac: '#b0503a' },
  { t: 'brown', x: 760, w: 420, fl: 3, fac: '#8a4a38', door: STOOP_X },
  { t: 'brown', x: 1180, w: 380, fl: 3, fac: '#9a5b43', door: 1290 },
  { t: 'pizza', x: 1560, w: 430, fl: 3, fac: '#a8452f' },
  { t: 'walkup', x: 1990, w: 410, fl: 5, fac: '#d1a979' },
  { t: 'deli', x: 2400, w: 460, fl: 3, fac: '#5d7380' },
  { t: 'brown', x: 2860, w: 380, fl: 3, fac: '#7d4334', door: 2960 },
  { t: 'coffee', x: 3240, w: 460, fl: 4, fac: '#3f6f63' },
  { t: 'brick', x: 3700, w: 420, fl: 5, fac: '#bd5f43' },
  { t: 'walkup', x: 4120, w: 440, fl: 4, fac: '#b99b77' },
  { t: 'barber', x: 4560, w: 420, fl: 3, fac: '#4f5d7a' },
  { t: 'brown', x: 4980, w: 420, fl: 4, fac: '#8d4c3b', door: 5090 },
  { t: 'brick', x: 5400, w: 440, fl: 4, fac: '#a8452f' },
];
const STORE = { deli: 1, pizza: 1, coffee: 1, barber: 1 };
const WINDOWS = [];           // каждое окно — со своей историей
const ACTORS = [];            // живые элементы (заполняет actors.js и раскладка окон)
{
  const r = PAINT.rng(1984);
  const stories = ['flowers', 'curtain', 'ac', 'flowers', 'blinds', 'person', 'plant', 'cat', 'tv', 'dark', 'flowers', 'curtain', 'ac', 'laundry'];
  BUILD.forEach((b, bi) => {
    const store = STORE[b.t], brown = b.t === 'brown';
    const ground = store ? 222 : brown ? 250 : 150;
    b.h = ground + (brown ? b.fl - 1 : b.fl) * 122 + 34;
    b.top = BASE - b.h;
    b.tower = bi === 1 || bi === 5 || bi === 9 || bi === 12;
    b.frame = brown ? '#2a211c' : b.t === 'walkup' ? '#3a3a3a' : '#efe6d0';
    b.stone = brown ? '#6a3a2c' : '#e6d8b8';
    b.seed = 100 + bi * 17;
    const cols = Math.max(2, Math.floor((b.w - 60) / 104)), ww = brown ? 60 : 58, gap = (b.w - cols * ww) / (cols + 1);
    b.cols = cols; b.gap = gap; b.ww = ww;
    const floors = brown ? b.fl - 1 : b.fl;
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = b.x + gap + c * (ww + gap), y = b.top + 64 + f * 122;
      let story = stories[Math.floor(r() * stories.length)];
      if (story === 'laundry' && b.t !== 'walkup') story = 'flowers';
      WINDOWS.push({ b, x, y, w: ww, h: 86, story, seed: 5000 + WINDOWS.length * 13, f, c });
    }
    if (brown) { // парадный (гостиный) этаж: высокие окна над цоколем, правее двери
      for (let c = 0; c < cols; c++) {
        const x = b.x + gap + c * (ww + gap); if (Math.abs(x + ww / 2 - b.door) < 90) continue;
        WINDOWS.push({ b, x, y: 612, w: ww, h: 118, story: c % 2 ? 'plant' : 'curtain', seed: 5000 + WINDOWS.length * 13, parlor: true });
      }
    }
  });
  // особые окна в местах действия (логика: рядом с шариком всё должно реагировать)
  const pick = (x0, x1, f, story) => { const w = WINDOWS.find((w) => w.x > x0 && w.x < x1 && w.f === f); if (w) w.story = story; };
  pick(330, 760, 1, 'cat'); pick(760, 1180, 0, 'person'); pick(1560, 1990, 1, 'person'); pick(2400, 2860, 0, 'flowers'); pick(2400, 2860, 1, 'cat');
  pick(3240, 3700, 1, 'person'); pick(3700, 4120, 2, 'flag'); pick(4120, 4560, 1, 'laundry'); pick(4560, 4980, 0, 'person'); pick(3700, 4120, 0, 'boarded');
}

// ---------- статичная живопись ----------
const R_ = PAINT.rect, S_ = PAINT.stroke, PA = PAINT.path, DB = PAINT.dab;
const shadowPen = (pen) => ({ cx: pen.cx, hx: null }); // тени — только цвет, без рельефа
const SH = () => (A() ? [40, 34, 78] : [40, 44, 52]);

function paintSky(pen) { // экранные координаты, x −200..2320, y −80..1180
  const r = PAINT.rng(11);
  if (A()) {
    R_(pen, -200, -80, 2520, 1260, (u, v, x, y) => {
      const k = MG.clamp((y + 80) / 1000), base = k < 0.55 ? PAINT.mix('#2a6fc4', '#6fb4ea', k / 0.55) : PAINT.mix('#6fb4ea', '#ffe1b4', (k - 0.55) / 0.45);
      const sun = Math.max(0, 1 - Math.hypot(x - 1790, y - 140) / 640);
      return PAINT.mix(base, '#fff1c8', sun * sun * 0.8);
    }, { ang: -8, angJ: 12, len: 110, sw: 34, var: 0.06, hue: 0.025, thick: 0.4, underCol: '#9fb9d6', dens: 1.6, r, flow: (u, v) => { // мазки неба закручиваются вокруг солнца
      const x = -200 + u * 2520, y = -80 + v * 1260, d = Math.hypot(x - 1790, y - 140), w = Math.exp(-((d / 420) ** 2));
      let tang = (Math.atan2(y - 140, x - 1790) * 180) / Math.PI + 90 + 8; tang = ((tang % 180) + 270) % 180 - 90;
      return Math.sin(u * 7 + v * 3) * 10 * (1 - w) + tang * w; } });
    // солнце: кольца коротких мазков по окружности — свет «вибрирует» вокруг диска
    for (let rad = 0; rad > 50; rad -= 8) {
      const n = Math.floor((rad * 2 * Math.PI) / 16), f = (rad - 50) / 150;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.3, x = 1790 + Math.cos(a) * rad, y = 140 + Math.sin(a) * rad;
        if (r() < f * 0.75) continue;
        S_(pen, x, y, (a * 180) / Math.PI + 90 + (r() - 0.5) * 24, 18 + r() * 10, 7 + r() * 4, PAINT.mix(PAINT.mix('#fffbe6', '#ffe2a0', f), '#bcdcf4', f * 0.8), { r, thick: 0.7 - f * 0.45, var: 0.03, alpha: 0.85 - f * 0.55 });
      }
    }
    PAINT.glow(pen.cx, 1790, 140, 260, '#fff2c0', 0.75); PAINT.glow(pen.cx, 1790, 140, 110, '#fffbe6', 0.9);
    for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 46; DB(pen, 1790 + Math.cos(a) * rr, 140 + Math.sin(a) * rr, 13 + r() * 7, PAINT.mix('#fffdf2', '#ffe48a', rr / 46), { r, thick: 1, var: 0.02, hue: 0.005 }); }
  } else {
    R_(pen, -200, -80, 2520, 1260, (u, v, x, y) => {
      const k = MG.clamp((y + 80) / 1000), n = fbm(x * 0.0022, y * 0.004, 3);
      return PAINT.mix(PAINT.mix('#6f757c', '#aeb2b6', k), '#5d6268', MG.clamp((n - 0.45) * 2.2) * 0.8);
    }, { ang: 12, angJ: 16, len: 130, sw: 36, var: 0.05, hue: 0.01, thick: 0.35, underCol: '#7d8288', r, flow: (u, v) => Math.sin(u * 5) * 10 });
    for (let i = 0; i < 700; i++) S_(pen, -200 + r() * 2520, -80 + r() * 1200, 104, 40 + r() * 60, 1.6, '#c9cdd1', { r, alpha: 0.25, thick: 0.1, flat: true }); // косые следы дождя
  }
}
function cloudSprite(seed, dark, w = 520, h = 210) { // поля по краям, чтобы мазки не обрезались краем холста спрайта
  const M = 90;
  return PAINT.sprite(w + M * 2, h + M * 2, M, M, 0.8, (pen) => {
    const r = PAINT.rng(seed), blobs = [];
    for (let i = 0; i < 7; i++) blobs.push([w * (0.2 + r() * 0.6), h * (0.3 + r() * 0.3), 40 + r() * 55]);
    blobs.push([w * 0.5, h * 0.62, 110], [w * 0.3, h * 0.66, 70], [w * 0.72, h * 0.66, 76]);
    for (const [x, y, rad] of blobs) PAINT.ellipse(pen, x, y, rad * 1.15, rad * 0.62, (u, v) => {
      if (dark) return PAINT.mix('#9a9fa5', '#5d6268', v * 0.9);
      return v < 0.45 ? PAINT.mix('#fffaf0', '#ffe7c2', u * 0.8) : PAINT.mix('#f4f1f6', '#a7b2d8', (v - 0.45) * 1.6);
    }, { r, ang: -4, angJ: 25, len: 30, sw: 13, var: 0.05, thick: 0.75, under: false, clip: false, alpha: 0.9, dens: 1.1, flow: (u, v) => (u - 0.5) * 60 });
  });
}
function paintFar(pen) { // Манхэттен и Бруклинский мост в дымке (воздушная перспектива)
  const r = PAINT.rng(7), haze = A() ? '#a8c9e6' : '#a6aaaf';
  const col = (hex, k = 0) => PAINT.mix(L(hex, k), haze, A() ? 0.55 : 0.72);
  for (const row of [0, 1]) for (let x = 480 + row * 40; x < 3720;) { // два ряда: дальний светлее (воздушная перспектива)
    const w = 46 + r() * 70, h = (row ? 200 : 120) + r() * (row ? 300 : 280), top = 640 - h, fade = row ? 0.25 : 0;
    const base = ['#6f86a8', '#7d8fb0', '#8a95b3', '#6a7c9c', '#8c86a6'][Math.floor(r() * 5)];
    const fc = (k) => PAINT.mix(col(base, k), haze, fade);
    R_(pen, x, top, w, h + 260, (u, v) => fc(u > 0.72 ? 0.55 : -0.1 - v * 0.2), { r, ang: 90, angJ: 4, len: 40, sw: 12, var: 0.05, thick: 0.25 });
    if (r() < 0.5) R_(pen, x + w * 0.2, top - 40 - r() * 40, w * 0.6, 90, (u) => fc(u > 0.7 ? 0.5 : 0), { r, ang: 90, len: 26, sw: 10, thick: 0.25 }); // уступ
    if (r() < 0.25) PA(pen, [[x + w / 2, top - 40], [x + w / 2, top - 120 - r() * 60]], 3, fc(0), { r, even: true, nb: 0 }); // антенна
    for (let yy = top + 14; yy < 640; yy += 18) PA(pen, [[x + 5, yy], [x + w - 5, yy]], 2.2, A() ? PAINT.mix(fc(0.3), r() < 0.2 ? '#fff0c8' : '#d6e4f2', 0.5) : PAINT.mix(fc(0), '#c0c4c8', 0.4), { r, even: true, nb: 0, alpha: 0.5, thick: 0.1 });
    x += w + (row ? 30 : 6) + r() * 40;
  }
  // шпиль высотки
  PAINT.poly(pen, [[1500, 640], [1500, 250], [1516, 180], [1532, 250], [1532, 640]], col('#7083a4', 0.2), { r, ang: 90, len: 30, sw: 8, thick: 0.25 });
  // мост: две готические башни, настил, тросы
  const bx = 2200, deck = 610, steel = '#5d7fa3';
  R_(pen, bx - 900, deck, 2100, 14, col(steel, -0.2), { r, ang: 0, len: 60, sw: 8, thick: 0.3 });
  for (const tx of [bx - 300, bx + 600]) {
    R_(pen, tx - 42, deck - 260, 84, 470, col('#8a8070', 0.25), { r, ang: 90, len: 30, sw: 10, thick: 0.4 });
    for (const ax of [tx - 22, tx + 8]) PAINT.fill(pen, (g) => { g.beginPath(); g.moveTo(ax, deck - 20); g.lineTo(ax, deck - 150); g.quadraticCurveTo(ax + 7, deck - 190, ax + 14, deck - 150); g.lineTo(ax + 14, deck - 20); g.closePath(); }, col('#3f4f66'), { h: 0.48 });
  }
  const cab = col('#4f6a8a', -0.1);
  const cable = (x0, y0, xm, ym, x1, y1) => { const pts = []; for (let i = 0; i <= 30; i++) { const u = i / 30; pts.push([(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * xm + u * u * x1, (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * ym + u * u * y1]); } PA(pen, pts, 3, cab, { r, even: true, thick: 0.3, nb: 0 }); return pts; };
  cable(bx - 900, deck - 30, bx - 600, deck - 20, bx - 300, deck - 250);
  const mid = cable(bx - 300, deck - 250, bx + 150, deck + 10, bx + 600, deck - 250);
  cable(bx + 600, deck - 250, bx + 900, deck - 20, bx + 1200, deck - 30);
  for (let i = 1; i < mid.length - 1; i++) PA(pen, [[mid[i][0], mid[i][1]], [mid[i][0], deck]], 1.2, cab, { r, even: true, nb: 0, thick: 0.1, alpha: 0.6 });
}

// --- дома ---
function facadeCol(b) {
  return (u, v, x, y) => {
    const n = fbm(x * 0.012, y * 0.012, b.seed);
    let k = A() ? 0.32 - v * 0.55 + (n - 0.5) * 0.35 : -0.15 - v * 0.2 + (n - 0.5) * 0.25;
    if (!A()) { const streak = vnoise(x * 0.09, 3, b.seed) > 0.72 ? -0.35 : 0; k += streak * (0.3 + v * 0.7); } // потёки от дождя
    return L(b.fac, k);
  };
}
function paintBuilding(pen, b) {
  const r = PAINT.rng(b.seed), top = b.top, store = STORE[b.t], brown = b.t === 'brown';
  const brick = b.t === 'brick' || b.t === 'walkup' || b.t === 'pizza';
  // фасад: подмалёвок + мазки по фактуре материала
  R_(pen, b.x, top, b.w + 1, b.h, facadeCol(b), { r, ang: brick ? 0 : 82, angJ: brick ? 8 : 16, len: brick ? 46 : 42, sw: brick ? 16 : 16, var: A() ? 0.1 : 0.07, hue: A() ? 0.025 : 0.004, thick: 0.5, taper: 0.55, underCol: PAINT.mul(C(b.fac), 0.7) });
  if (brick) { // кирпич намёком: короткие горизонтальные мазки рядами, не везде (импрессионизм)
    const fc = facadeCol(b);
    for (let y = top + 40, row = 0; y < BASE - 10; y += 15, row++) for (let x = b.x + (row % 2) * 14; x < b.x + b.w - 20; x += 29) {
      if (r() > 0.4) continue; const k = (r() - 0.5) * 0.6;
      S_(pen, x, y, (r() - 0.5) * 4, 24, 8, PAINT.mix(fc((x - b.x) / b.w, (y - top) / b.h, x, y), k > 0 ? '#e48a6a' : '#5a2418', Math.abs(k) * (A() ? 1 : 0.4)), { r, thick: 0.75, var: 0.08, hue: A() ? 0.02 : 0.004 });
    }
  }
  if (brown) for (let y = BASE - 238; y < BASE; y += 24) PA(pen, [[b.x + 2, y], [b.x + b.w - 2, y]], 3, L(b.fac, -0.7), { r, even: true, thick: 0.2, alpha: 0.7 }); // руст цоколя
  // карниз: кронштейны, зубчики, тень под ним на фасад
  const cTop = top - 10, cor = brown ? '#4a2a20' : b.t === 'walkup' ? '#8a6f52' : '#5a3326';
  R_(pen, b.x - 10, cTop, b.w + 20, 30, (u, v) => L(cor, 0.5 - v * 1.1), { r, ang: 0, len: 36, sw: 9, thick: 0.8, var: 0.06 });
  PA(pen, [[b.x - 10, cTop + 2], [b.x + b.w + 10, cTop + 2]], 4, L(cor, 0.9), { r, even: true, thick: 0.9 });
  for (let x = b.x + 8; x < b.x + b.w - 6; x += 34) R_(pen, x, cTop + 30, 12, 22, (u, v) => L(cor, 0.2 - v * 0.8), { r, ang: 90, len: 12, sw: 6, thick: 0.8, under: true });
  if (A()) R_(shadowPen(pen), b.x - 10, cTop + 52, b.w + 20, 26, SH(), { r, ang: 0, len: 50, sw: 10, alpha: 0.22, under: false, flat: true });
  // крыша: парапет, трубы, антенны, водонапорная башня
  for (let i = 0; i < 2; i++) { const x = b.x + 30 + r() * (b.w - 80); R_(pen, x, cTop - 46, 30, 46, (u, v) => L('#7a4434', 0.4 - u * 0.8), { r, ang: 90, len: 16, sw: 7, thick: 0.7 }); b.chimney = b.chimney || [x + 15, cTop - 46]; }
  if (r() < 0.6) { const x = b.x + 60 + r() * (b.w - 120); PA(pen, [[x, cTop], [x, cTop - 90]], 2.5, L('#2a2a2a', 0), { r, even: true }); PA(pen, [[x - 22, cTop - 70], [x + 22, cTop - 76]], 2, L('#2a2a2a', 0), { r, even: true }); PA(pen, [[x - 14, cTop - 84], [x + 14, cTop - 88]], 2, L('#2a2a2a', 0), { r, even: true }); }
  if (b.tower) paintTower(pen, b.x + b.w * 0.55, cTop, r);
  // окна
  for (const wn of WINDOWS) if (wn.b === b) paintWindow(pen, wn);
  if (b.t === 'walkup') paintFireEscape(pen, b, r);
  // первый этаж
  if (store) paintStore(pen, b, r);
  else if (brown) paintStoop(pen, b, r);
  else paintEntry(pen, b, r);
}
function paintTower(pen, tx, roof, r) { // деревянный бак на стальных ногах — символ Нью-Йорка
  const steel = '#3a3a3a';
  for (const lx of [tx - 6, tx + 76]) PA(pen, [[lx, roof], [lx + (lx < tx ? 8 : -8), roof - 92]], 5, L(steel, 0), { r, even: true });
  PA(pen, [[tx - 4, roof - 46], [tx + 78, roof - 46]], 4, L(steel, 0), { r, even: true });
  PA(pen, [[tx, roof - 4], [tx + 72, roof - 86]], 2.5, L(steel, -0.2), { r, even: true }); PA(pen, [[tx + 72, roof - 4], [tx, roof - 86]], 2.5, L(steel, -0.2), { r, even: true });
  PAINT.poly(pen, [[tx - 14, roof - 176], [tx + 88, roof - 176], [tx + 86, roof - 94], [tx + 37, roof - 88], [tx - 12, roof - 94]], (u, v) => L('#8a6343', 0.45 - u * 0.9 + v * -0.2), { r, ang: 90, angJ: 3, len: 30, sw: 9, thick: 0.75, var: 0.1 });
  for (let k = 0; k < 4; k++) PA(pen, [[tx - 14, roof - 164 + k * 21], [tx + 88, roof - 164 + k * 21]], 2.5, L('#4a3322', -0.2), { r, even: true, thick: 0.6 });
  PAINT.poly(pen, [[tx - 22, roof - 174], [tx + 37, roof - 224], [tx + 96, roof - 174]], (u, v) => L('#5a3d29', 0.5 - u * 1.0), { r, ang: -35, len: 26, sw: 8, thick: 0.8 });
}
function paintWindow(pen, wn) {
  const { x, y, w, h, b, story } = wn, r = PAINT.rng(wn.seed), sp = shadowPen(pen), alive = A();
  const lit = alive && (story === 'curtain' || story === 'cat' || story === 'person' || story === 'plant' || story === 'tv' || story === 'flag');
  // перемычка с замковым камнем
  R_(pen, x - 8, y - 18, w + 16, 14, (u, v) => L(b.stone, 0.35 - v * 0.6), { r, ang: 0, len: 22, sw: 7, thick: 0.75, var: 0.06 });
  R_(pen, x + w / 2 - 7, y - 22, 14, 19, (u, v) => L(b.stone, 0.5 - v * 0.6), { r, ang: 90, len: 12, sw: 7, thick: 0.9 });
  // стекло: отражение неба сверху, комната снизу
  const glass = (u, v, gx, gy) => {
    if (story === 'boarded' && !alive) return null;
    if (alive) {
      const sky = PAINT.mix('#cfe9ff', '#5d86c0', v * 1.1), room = PAINT.mix('#ffd58a', '#b8743e', v);
      const g = lit ? PAINT.mix(sky, room, MG.clamp((v - 0.25) * 1.8)) : PAINT.mix(sky, '#2c3a5e', MG.clamp(v * 1.2));
      return PAINT.mix(g, '#ffffff', Math.max(0, 1 - Math.abs(u * 1.1 - v * 0.9 - 0.15) * 7) * 0.55); // косой блик
    }
    const tv = story === 'tv' ? 0.12 : 0;
    return PAINT.mix(PAINT.mix('#8e959c', '#3d4249', MG.clamp(v * 1.4)), '#6f86a0', tv);
  };
  R_(pen, x, y, w, h, glass, { r, ang: 90, angJ: 6, len: 22, sw: 7, var: 0.07, thick: 0.35, underCol: alive ? '#3c4a6a' : '#454a52' });
  // содержимое окна
  if (story === 'curtain' || story === 'tv') {
    if (alive) { for (const side of [0, 1]) R_(pen, x + (side ? w - w * 0.28 : 0), y, w * 0.28, h, (u, v) => L(['#e8506f', '#2a9d8f', '#f4a261'][wn.seed % 3], 0.2 - Math.abs(Math.sin(u * 9)) * 0.5), { r, ang: 90, len: 18, sw: 5, thick: 0.6 }); }
    else R_(pen, x, y, w, h, (u, v) => L('#8b8f94', -Math.abs(Math.sin(u * 12)) * 0.5), { r, ang: 90, len: 20, sw: 5, thick: 0.5 }); // задёрнуто
  }
  if (story === 'blinds') for (let yy = y + 4; yy < y + h - (alive ? h * 0.45 : 2); yy += 6) PA(pen, [[x + 2, yy], [x + w - 2, yy]], 3, alive ? '#f3ead2' : C('#b9bcc0'), { r, even: true, thick: 0.4, alpha: 0.9 });
  if (story === 'plant') { // комнатное растение за стеклом
    const pc = alive ? '#3f9e4a' : '#7a7258'; for (let i = 0; i < 14; i++) DB(pen, x + w * 0.5 + (r() - 0.5) * w * 0.7, y + h * 0.55 + (r() - 0.5) * h * 0.4, 9, alive ? PAINT.mix(pc, '#9be36a', r() * 0.5) : PAINT.mix(pc, '#5a5444', r()), { r, ang: alive ? -60 : 80, thick: 0.6 });
    R_(pen, x + w * 0.32, y + h * 0.78, w * 0.36, h * 0.2, L('#b5653c', 0.2), { r, len: 10, sw: 5 });
  }
  if (story === 'person' && !alive) R_(pen, x + w * 0.3, y + h * 0.25, w * 0.4, h * 0.75, '#2f3338', { r, ang: 90, len: 16, sw: 7, thick: 0.3, alpha: 0.6 }); // силуэт за стеклом
  if (story === 'boarded') {
    if (!alive) { for (let i = 0; i < 4; i++) R_(pen, x - 2, y + 4 + i * 21, w + 4, 18, L('#9a8a72', -0.2), { r, ang: (i % 2 ? 3 : -3), len: 30, sw: 8, thick: 0.8 }); R_(pen, x + 6, y + 30, w - 12, 26, '#e9e4d6', { r, len: 14, sw: 5 }); PAINT.text(pen, 'FOR RENT', x + w / 2, y + 48, '700 9px Inter', '#c0392b', { thick: 0.2 }); }
  }
  // рама: переплёт и средник
  const fr = (pts, wd) => PA(pen, pts, wd, L(b.frame, alive ? 0.25 : 0), { r, even: true, thick: 0.85, var: 0.05 });
  fr([[x, y], [x + w, y]], 4); fr([[x, y + h], [x + w, y + h]], 4); fr([[x, y], [x, y + h]], 4); fr([[x + w, y], [x + w, y + h]], 4);
  fr([[x + w / 2, y], [x + w / 2, y + h]], 3); fr([[x, y + h * 0.47], [x + w, y + h * 0.47]], 4);
  // глубина проёма: тень слева и сверху внутри (солнце справа сверху)
  if (alive) { R_(sp, x + 2, y + 2, 7, h - 4, SH(), { r, ang: 90, len: 20, sw: 5, alpha: 0.35, under: false, flat: true }); R_(sp, x + 2, y + 2, w - 4, 7, SH(), { r, ang: 0, len: 20, sw: 5, alpha: 0.3, under: false, flat: true }); }
  // подоконник + тень под ним; в унылой — потёк вниз
  R_(pen, x - 9, y + h + 1, w + 18, 9, (u, v) => L(b.stone, 0.55 - v * 0.9), { r, ang: 0, len: 22, sw: 5, thick: 0.85 });
  if (alive) R_(sp, x - 14, y + h + 10, w + 14, 11, SH(), { r, ang: 0, len: 26, sw: 6, alpha: 0.28, under: false, flat: true });
  else for (let i = 0; i < 3; i++) S_(sp, x + 6 + r() * (w - 12), y + h + 10, 90, 30 + r() * 60, 5, '#3c4148', { r, alpha: 0.28, flat: true });
  // ящик для цветов / кондиционер (сами цветы и капли — живые элементы)
  if (story === 'flowers') R_(pen, x - 8, y + h + 10, w + 16, 15, (u, v) => L(alive ? '#a0522d' : '#6b5a4a', 0.3 - v * 0.7), { r, ang: 0, len: 18, sw: 6, thick: 0.8 });
  if (story === 'ac') { R_(pen, x + 4, y + h - 30, w - 8, 34, (u, v) => L('#d8d4cc', 0.4 - v * 0.6 - u * 0.2), { r, ang: 0, len: 16, sw: 5, thick: 0.8 }); for (let yy = y + h - 26; yy < y + h + 2; yy += 5) PA(pen, [[x + 8, yy], [x + w - 8, yy]], 1.3, L('#7d7a74', 0), { r, even: true, nb: 0 }); }
}
function paintFireEscape(pen, b, r) { // пожарная лестница: площадки, перила, марши; в живой — тень на фасад и горшки с цветами
  const fx = b.x + b.gap - 26, fw = Math.min(270, b.w - 2 * b.gap + 52), iron = L('#1f1f22', 0.1), sp = shadowPen(pen);
  for (let f = 0; f < b.fl; f++) {
    const py = b.top + 64 + f * 122 + 94;
    if (A()) R_(sp, fx - 14, py + 8, fw, 12, SH(), { r, ang: 0, len: 40, sw: 8, alpha: 0.25, under: false, flat: true });
    PA(pen, [[fx, py], [fx + fw, py]], 6, iron, { r, even: true, thick: 0.9 }); PA(pen, [[fx, py - 36], [fx + fw, py - 36]], 3, iron, { r, even: true, thick: 0.8 });
    for (let k = 0; k <= fw; k += 15) PA(pen, [[fx + k, py - 36], [fx + k, py]], 1.6, iron, { r, even: true, nb: 0, thick: 0.6 });
    if (f < b.fl - 1) PA(pen, [[fx + fw - 44, py], [fx + 44, py + 122]], 5, iron, { r, even: true, thick: 0.9 });
    if (A() && f % 2 === 0) for (const px of [fx + 26, fx + fw - 30]) { R_(pen, px - 9, py - 16, 18, 15, L('#b5653c', 0.3), { r, len: 10, sw: 5 }); for (let i = 0; i < 6; i++) DB(pen, px + (r() - 0.5) * 22, py - 22 - r() * 12, 7, i % 2 ? '#3f9e4a' : ['#ff4f6d', '#ffd23f', '#ffffff'][i % 3], { r, thick: 0.8 }); }
    if (!A() && f % 2 === 0) R_(pen, fx + 17, py - 16, 18, 15, L('#6b5a4a', 0), { r, len: 10, sw: 5 });
  }
}
function paintEntry(pen, b, r) { // вход в жилой дом + окна цоколя с решётками
  const dx = b.x + b.w / 2;
  R_(pen, dx - 46, BASE - 136, 92, 12, (u, v) => L(b.stone, 0.4 - v * 0.6), { r, len: 20, sw: 6, thick: 0.8 });
  R_(pen, dx - 36, BASE - 124, 72, 118, (u, v) => L('#3d2a20', 0.25 - u * 0.5), { r, ang: 90, len: 26, sw: 8, thick: 0.6 });
  R_(pen, dx - 26, BASE - 116, 52, 36, alive() ? '#ffe2a6' : '#5c6168', { r, ang: 90, len: 12, sw: 6, thick: 0.4 });
  for (let i = 0; i < 2; i++) R_(pen, dx - 56 - i * 8, BASE - 8 + i * 0, 112 + i * 16, 10, (u, v) => L('#9a8f80', 0.3 - v * 0.6), { r, len: 22, sw: 6 });
  for (const gx of [b.x + 30, b.x + b.w - 30 - 64]) { R_(pen, gx, BASE - 100, 64, 62, PAINT.mix(L('#3a4255', 0), '#000', 0.2), { r, ang: 90, len: 16, sw: 6, thick: 0.35 }); for (let k = 6; k < 64; k += 11) PA(pen, [[gx + k, BASE - 104], [gx + k, BASE - 36]], 2.2, L('#1b1b1e', 0.1), { r, even: true, nb: 0, thick: 0.8 }); }
  if (A()) R_(shadowPen(pen), dx - 50, BASE - 124, 14, 118, SH(), { r, ang: 90, len: 30, sw: 8, alpha: 0.25, under: false, flat: true });
}
function alive() { return A(); }
function paintStoop(pen, b, r) { // крыльцо браунстоуна: лестница вниз к тротуару, кованые перила, арка двери
  const X = b.door, sp = shadowPen(pen);
  R_(pen, X - 62, 612, 124, 140, (u, v) => L('#4a2c22', 0.2 - u * 0.4), { r, ang: 90, len: 28, sw: 9, thick: 0.6 });
  PAINT.poly(pen, (() => { const p = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; p.push([X + Math.cos(a) * 62, 616 + Math.sin(a) * 42]); } return p; })(), (u, v) => L(b.stone, 0.4 - v * 0.4), { r, len: 14, sw: 6, thick: 0.9 });
  R_(pen, X - 46, 626, 92, 122, (u, v) => L('#5a2f22', 0.3 - u * 0.6 - v * 0.2), { r, ang: 90, len: 24, sw: 8, thick: 0.6 }); // дверь
  R_(pen, X - 36, 636, 30, 50, A() ? '#ffd58a' : '#596069', { r, ang: 90, len: 12, sw: 5 }); R_(pen, X + 6, 636, 30, 50, A() ? '#ffd58a' : '#596069', { r, ang: 90, len: 12, sw: 5 });
  DB(pen, X + 30, 700, 6, A() ? '#ffd23f' : '#9a9a9a', { r, thick: 1 }); // ручка
  for (let k = 0; k < 6; k++) { const y = 748 + k * 24.5, w = 150 + k * 22; R_(pen, X - w / 2, y, w, 24.5, (u, v) => L(k % 2 ? '#7b4434' : '#844a39', 0.45 - v * 1.2), { r, ang: 0, len: 30, sw: 8, thick: 0.75 }); PA(pen, [[X - w / 2, y + 1.5], [X + w / 2, y + 1.5]], 3, L('#b0705a', 0.6), { r, even: true, thick: 0.9 }); }
  for (const s of [-1, 1]) { // перила: прямой спуск + завиток
    const pts = []; for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push([X + s * (78 + u * 76), 700 + u * 190 - Math.sin(u * Math.PI) * 6]); }
    PA(pen, pts, 5, L('#1c1c1f', 0.1), { r, even: true, thick: 0.9 });
    for (let i = 1; i < 10; i += 1.5) { const p = pts[Math.floor(i)]; PA(pen, [[p[0], p[1]], [p[0], p[1] + 48 + i * 4]], 2, L('#1c1c1f', 0.1), { r, even: true, nb: 0 }); }
    PA(pen, [[X + s * 78, 700], [X + s * 78, 752]], 6, L('#1c1c1f', 0.1), { r, even: true }); DB(pen, X + s * 78, 698, 8, L('#1c1c1f', 0.3), { r });
  }
  if (A()) R_(sp, X - 150, 760, 60, 130, SH(), { r, ang: 60, len: 40, sw: 12, alpha: 0.18, under: false, flat: true });
  // цоколь под крыльцом: дверь и окна с решёткой
  R_(pen, X + 100, BASE - 92, 56, 82, PAINT.mix(L('#2f3646', 0), '#000', 0.15), { r, ang: 90, len: 14, sw: 6, thick: 0.3 });
  for (let k = 6; k < 56; k += 10) PA(pen, [[X + 100 + k, BASE - 96], [X + 100 + k, BASE - 10]], 2, L('#1b1b1e', 0.1), { r, even: true, nb: 0 });
}
function paintStore(pen, b, r) {
  const sy = BASE - 150, alive = A(), sp = shadowPen(pen);
  const theme = { deli: ['#2a9d8f', '#f1faee', 'DELI · GROCERY', '#7bf1a8'], pizza: ['#c0392b', '#f6e8d0', 'PIZZA', '#ff6b5c'], coffee: ['#6d4c41', '#ffe8cc', 'COFFEE', '#ffd166'], barber: ['#1d3557', '#f1faee', 'BARBER', '#9fd3ff'] }[b.t];
  R_(pen, b.x + 14, sy - 8, b.w - 28, 158, (u, v) => L('#2b2b30', 0.2 - v * 0.3), { r, ang: 90, len: 26, sw: 9, thick: 0.6 });
  // витрина: интерьер магазина
  const gx = b.x + 32, gw = b.w - 150, gy = sy + 46, gh = 96;
  R_(pen, gx, gy, gw, gh, (u, v) => alive ? PAINT.mix('#fff0c4', '#d49a5a', v * 0.9) : PAINT.mix('#6a7078', '#4a4f56', v), { r, ang: 90, len: 18, sw: 7, thick: 0.35 });
  if (b.t === 'deli') for (let s = 0; s < 3; s++) { PA(pen, [[gx + 4, gy + 30 + s * 28], [gx + gw - 4, gy + 30 + s * 28]], 3, L('#6d4c41', 0), { r, even: true }); for (let x = gx + 8; x < gx + gw - 8; x += 9) DB(pen, x, gy + 22 + s * 28, 6, alive ? ['#e63946', '#ffd23f', '#2a9d8f', '#f4a261', '#457b9d', '#ffffff'][Math.floor(r() * 6)] : C(['#e63946', '#ffd23f', '#2a9d8f'][Math.floor(r() * 3)]), { r, ang: 90, elong: 1.6, thick: 0.6 }); }
  if (b.t === 'pizza') { R_(pen, gx + gw - 90, gy + 20, 80, 60, alive ? '#ff8c42' : '#5d6168', { r, len: 12, sw: 6 }); if (alive) PAINT.glow(pen.cx, gx + gw - 50, gy + 50, 70, '#ff9a3c', 0.5); for (let i = 0; i < 3; i++) PAINT.poly(pen, [[gx + 20 + i * 50, gy + 70], [gx + 60 + i * 50, gy + 70], [gx + 40 + i * 50, gy + 30]], L('#f4c45a', 0.2), { r, len: 10, sw: 5, thick: 0.8 }); }
  if (b.t === 'coffee') for (let i = 0; i < 3; i++) { const px = gx + 30 + i * (gw / 3); R_(pen, px - 10, gy + 34, 20, 50, alive ? '#7a4a3a' : '#4a4e55', { r, ang: 90, len: 12, sw: 6, alpha: 0.85 }); DB(pen, px, gy + 28, 14, alive ? '#c98d6b' : '#555a60', { r }); }
  if (b.t === 'barber') for (let i = 0; i < 2; i++) { const px = gx + 50 + i * 110; R_(pen, px - 22, gy + 50, 44, 34, alive ? '#c0392b' : '#4d5157', { r, len: 12, sw: 6 }); PA(pen, [[px, gy + 84], [px, gy + 96]], 4, '#888', { r, even: true }); }
  PAINT.fill(pen, (g) => { g.beginPath(); g.rect(gx, gy, gw, gh); }, '#ffffff', { alpha: alive ? 0.06 : 0.03 });
  S_(pen, gx + gw * 0.15, gy + gh - 10, -58, gh * 1.1, 8, '#ffffff', { r, alpha: alive ? 0.35 : 0.15, thick: 0.4 }); // блик на витрине
  // дверь
  R_(pen, b.x + b.w - 104, sy + 36, 64, 114, (u, v) => L('#3a2a22', 0.3 - u * 0.5), { r, ang: 90, len: 18, sw: 7 });
  R_(pen, b.x + b.w - 96, sy + 46, 48, 60, alive ? '#ffe2a6' : '#596069', { r, ang: 90, len: 12, sw: 5 });
  // вывеска (буквы — густой краской)
  R_(pen, b.x + 28, sy - 64, b.w - 56, 48, (u, v) => L('#1b1b1f', 0.15 - v * 0.3), { r, ang: 0, len: 30, sw: 9, thick: 0.6 });
  const fs = Math.min(30, (b.w - 90) / (theme[2].length * 0.95));
  PAINT.text(pen, theme[2], b.x + b.w / 2, sy - 30, `700 ${fs}px Unbounded`, alive ? theme[3] : '#8a8f96', { thick: 0.45 });
  if (alive) PAINT.glow(pen.cx, b.x + b.w / 2, sy - 40, b.w * 0.42, theme[3], 0.18);
  // OPEN: неон горит только в живой
  PAINT.text(pen, 'OPEN', gx + 40, gy + 22, '800 18px Inter', alive ? '#ff3b5c' : '#6d7177', { thick: 0.35 });
  if (alive) PAINT.glow(pen.cx, gx + 40, gy + 16, 40, '#ff3b5c', 0.35);
  // маркиза (у лавки на тротуаре — своя, живая)
  if (b.t !== 'deli') {
    const ay = sy - 12;
    for (let k = 0; k < (b.w - 28) / 30; k++) R_(pen, b.x + 14 + k * 30, ay, 30, 42, (u, v) => L(k % 2 ? theme[1] : theme[0], 0.4 - v * 0.6), { r, ang: 90, len: 16, sw: 7, thick: 0.75 });
    for (let k = 0; k < (b.w - 28) / 30; k++) PAINT.ellipse(pen, b.x + 29 + k * 30, ay + 42, 15, 9, L(theme[0], -0.1), { r, len: 10, sw: 5, thick: 0.8 });
    if (alive) R_(sp, b.x + 8, ay + 50, b.w - 20, 22, SH(), { r, ang: 0, len: 40, sw: 10, alpha: 0.24, under: false, flat: true });
  }
  if (b.t === 'barber') { R_(pen, b.x + b.w - 28, sy - 4, 14, 100, '#e9e9e9', { r, ang: 90, len: 14, sw: 6, thick: 0.8 }); b.pole = [b.x + b.w - 21, sy - 4]; }
}

// --- улица ---
function paintStreet(pen) {
  const r = PAINT.rng(31), alive = A(), sp = shadowPen(pen);
  // тротуар: плиты, швы, тёплый бетон / мокрый холодный
  R_(pen, WX0, BASE, WW, ROAD - 14 - BASE, (u, v, x, y) => L(alive ? '#d8cbb4' : '#c2c4c4', 0.25 - v * 0.4 + (fbm(x * 0.01, y * 0.05, 2) - 0.5) * 0.3), { r, ang: 0, angJ: 3, len: 60, sw: 12, var: 0.06, thick: 0.45 });
  for (let x = WX0 + 40; x < WX0 + WW; x += 120) PA(pen, [[x, BASE + 2], [x - 10, ROAD - 16]], 2, L('#8c8270', -0.3), { r, even: true, nb: 0, thick: 0.2, alpha: 0.7 });
  // бордюр и дорога
  R_(pen, WX0, ROAD - 14, WW, 14, (u, v) => L('#b9ad99', 0.6 - v * 1.3), { r, ang: 0, len: 70, sw: 7, thick: 0.75 });
  R_(pen, WX0, ROAD, WW, 1120 - ROAD + 10, (u, v, x, y) => alive ? L('#4a4d55', -0.05 + (fbm(x * 0.006, y * 0.02, 4) - 0.5) * 0.5 + v * 0.1) : PAINT.mix(L('#3b3f46', 0), '#7a8088', MG.clamp((fbm(x * 0.004, y * 0.03, 6) - 0.55) * 2) * 0.5), { r, ang: 0, angJ: 2, len: 90, sw: 16, var: 0.08, thick: 0.4 });
  for (let x = WX0; x < WX0 + WW; x += 180) R_(pen, x + 20, 1032, 92, 9, L('#efe8d8', alive ? 0.2 : -0.1), { r, ang: 0, len: 30, sw: 6, thick: 0.8, alpha: 0.9 }); // разметка
  // люки (из них идёт пар — живой элемент)
  for (const mx of [2850, 4500]) { PAINT.ellipse(pen, mx, 990, 46, 9, L('#2a2c30', 0.1), { r, len: 12, sw: 4, thick: 0.6 }); PA(pen, [[mx - 40, 988], [mx + 40, 988]], 1.5, L('#5a5c60', 0.3), { r, even: true, nb: 0 }); }
  // мокрая дорога в унылой: вертикальные отражения окон и фонарей
  if (!alive) for (const b of BUILD) for (let i = 0; i < 6; i++) { const x = b.x + 30 + r() * (b.w - 60); S_(sp, x, ROAD + 8 + r() * 30, 90, 40 + r() * 80, 6 + r() * 6, '#8d949b', { r, alpha: 0.22, flat: true }); }
  if (!alive) for (const lx of LAMPS) S_(sp, lx + 32, ROAD + 6, 90, 150, 18, '#b9b39a', { r, alpha: 0.2, flat: true });
  // лужи (в унылой; в живой — высохли)
  if (!alive) for (const [px, py, pw] of PUDDLES) { PAINT.ellipse(pen, px, py, pw, pw * 0.11, (u, v) => PAINT.mix('#9aa1a8', '#5d636a', v), { r, ang: 0, len: 30, sw: 5, thick: 0.15 }); PA(pen, [[px - pw * 0.7, py - 1], [px + pw * 0.5, py - 1]], 2, '#c7ccd1', { r, even: true, nb: 0, alpha: 0.6 }); }
  // приствольные лунки: в живой — цветы, в унылой — голая земля с мусором
  for (const tx of TREES) {
    PAINT.ellipse(pen, tx, SIDE + 1, 48, 7, L('#4a3626', -0.2), { r, len: 12, sw: 5, thick: 0.5 });
    PA(pen, [[tx - 50, SIDE - 10], [tx + 50, SIDE - 10]], 2, L('#1f1f22', 0.1), { r, even: true, nb: 0 }); for (let k = -48; k <= 48; k += 12) PA(pen, [[tx + k, SIDE - 12], [tx + k, SIDE]], 1.6, L('#1f1f22', 0.1), { r, even: true, nb: 0 });
    if (alive) for (let i = 0; i < 9; i++) DB(pen, tx - 40 + i * 10, SIDE - 4 - r() * 6, 6, ['#ff4f8b', '#ffd23f', '#ffffff', '#c77dff'][i % 4], { r, thick: 0.9 });
    else for (let i = 0; i < 3; i++) DB(pen, tx - 30 + r() * 60, SIDE - 1, 5, ['#d9d6cf', '#8a7f70'][i % 2], { r, elong: 1.8, ang: 0, thick: 0.4 });
  }
  // трещины с одуванчиками (живая) / окурки и жвачка (унылая)
  for (let i = 0; i < 40; i++) {
    const x = WX0 + 100 + r() * (WW - 200), y = BASE + 6 + r() * 40;
    if (alive) { if (r() < 0.5) { PA(pen, [[x, y], [x + 3, y - 6]], 1.4, '#3f9e4a', { r, even: true, nb: 0 }); DB(pen, x + 3, y - 8, 5, '#ffd23f', { r, thick: 0.9 }); } }
    else DB(pen, x, y, 3, r() < 0.5 ? '#e6e2da' : '#6a6e72', { r, elong: 2, ang: r() * 180, thick: 0.3 });
  }
}
const PUDDLES = [[380, 902, 110], [1130, 960, 120], [1980, 1000, 150], [2760, 950, 110], [3500, 985, 140], [4300, 960, 120], [5100, 1000, 150]];

// --- реквизит, который не двигается ---
function paintLamp(pen, x) { // фонарь: в живой днём выключен, в унылой горит холодным светом в дожде
  const r = PAINT.rng(x), g = L('#24433a', 0.15), alive = A();
  PA(pen, [[x, SIDE], [x, SIDE - 300]], 10, g, { r, even: true, thick: 0.9 });
  R_(pen, x - 14, SIDE - 14, 28, 14, L('#24433a', 0.3), { r, len: 10, sw: 6 });
  const pts = []; for (let i = 0; i <= 10; i++) { const a = Math.PI - (i / 10) * Math.PI * 0.5; pts.push([x + 34 + Math.cos(a) * 34, SIDE - 300 - Math.sin(a) * 30]); }
  PA(pen, pts, 7, g, { r, even: true, thick: 0.9 });
  PAINT.poly(pen, [[x + 16, SIDE - 330], [x + 50, SIDE - 330], [x + 44, SIDE - 308], [x + 22, SIDE - 308]], L('#24433a', 0.2), { r, len: 10, sw: 5, thick: 0.9 });
  R_(pen, x + 22, SIDE - 310, 22, 8, alive ? '#efe8cf' : '#f2ecc8', { r, len: 8, sw: 4, thick: 0.9 });
  if (alive) R_(shadowPen(pen), x - 70, SIDE + 2, 66, 8, SH(), { r, ang: 4, len: 30, sw: 6, alpha: 0.3, under: false, flat: true });
}
function paintTrunk(pen, x) {
  const r = PAINT.rng(x * 3);
  PA(pen, [[x, SIDE - 2], [x - 2, SIDE - 120], [x + 3, SIDE - 210]], 18, L('#6b4a32', 0.1), { r, thick: 0.9, wfn: (u) => 1.2 - u * 0.5 });
  PA(pen, [[x + 5, SIDE - 4], [x + 4, SIDE - 200]], 4, L('#a07850', 0.6), { r, thick: 0.9, alpha: 0.7 }); // освещённая сторона
  if (!A()) for (const [a, l] of [[-120, 90], [-60, 100], [-95, 120], [-140, 60], [-30, 70]]) { const ar = (a * Math.PI) / 180, bx = x + 2, by = SIDE - 190; PA(pen, [[bx, by], [bx + Math.cos(ar) * l * 0.5, by + Math.sin(ar) * l * 0.5 - 6], [bx + Math.cos(ar) * l, by + Math.sin(ar) * l]], 6, L('#5a4030', 0), { r, thick: 0.8 }); }
}
function paintHydrant(pen, x) {
  const r = PAINT.rng(x * 7);
  R_(pen, x - 12, SIDE - 46, 24, 44, (u, v) => L('#d62828', 0.5 - u * 1.0), { r, ang: 90, len: 14, sw: 6, thick: 0.85 });
  R_(pen, x - 20, SIDE - 34, 40, 9, L('#b51f1f', 0.2), { r, len: 12, sw: 5, thick: 0.9 }); PAINT.ellipse(pen, x, SIDE - 48, 12, 9, L('#d62828', 0.4), { r, len: 8, sw: 4, thick: 0.9 });
}
function paintProps(pen) {
  const r = PAINT.rng(77), alive = A();
  LAMPS.forEach((x) => paintLamp(pen, x));
  TREES.forEach((x) => paintTrunk(pen, x));
  paintHydrant(pen, 1700); paintHydrant(pen, 4800);
  // газетные автоматы у пиццерии
  for (const [x, c] of [[1880, '#c0392b'], [1930, '#2b59c3']]) { R_(pen, x - 20, SIDE - 70, 40, 52, (u, v) => L(c, 0.4 - u * 0.8), { r, ang: 90, len: 14, sw: 6, thick: 0.8 }); R_(pen, x - 14, SIDE - 62, 28, 18, alive ? '#f1ece0' : '#a7aaad', { r, len: 8, sw: 4 }); PA(pen, [[x - 14, SIDE - 18], [x - 14, SIDE]], 3, L('#222', 0), { r, even: true }); PA(pen, [[x + 14, SIDE - 18], [x + 14, SIDE]], 3, L('#222', 0), { r, even: true }); }
  // велосипед у фонаря 3420 (в живой с корзинкой цветов)
  { const x = 3470, y = SIDE - 26, col = L('#2a9d8f', 0.2); for (const wx of [x - 34, x + 34]) { const p = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; p.push([wx + Math.cos(a) * 24, y + Math.sin(a) * 24]); } PA(pen, p, 3.5, L('#1b1b1e', 0), { r, even: true, nb: 0 }); }
    PA(pen, [[x - 34, y], [x - 4, y - 30], [x + 26, y - 30], [x + 34, y], [x, y], [x - 4, y - 30]], 4, col, { r, even: true }); PA(pen, [[x + 26, y - 30], [x + 22, y - 44], [x + 32, y - 46]], 3, L('#222', 0), { r, even: true }); R_(pen, x - 14, y - 40, 22, 6, L('#3a2a22', 0), { r, len: 8, sw: 4 });
    if (alive) { R_(pen, x + 22, y - 44, 26, 16, L('#c8a26a', 0.3), { r, len: 8, sw: 4 }); for (let i = 0; i < 6; i++) DB(pen, x + 26 + i * 4, y - 48 - r() * 6, 6, ['#ff4f8b', '#ffd23f', '#ffffff'][i % 3], { r }); } }
  // скамейка у браунстоуна 4980
  { const x = 5230; R_(pen, x - 70, SIDE - 44, 140, 8, L('#7a5233', 0.4), { r, len: 20, sw: 5, thick: 0.8 }); R_(pen, x - 70, SIDE - 70, 140, 8, L('#7a5233', 0.3), { r, len: 20, sw: 5, thick: 0.8 }); for (const lx of [x - 60, x + 60]) PA(pen, [[lx, SIDE - 74], [lx, SIDE]], 4, L('#1b1b1e', 0), { r, even: true }); }
  // знаки «не парковаться»
  for (const x of [1010, 3820]) { PA(pen, [[x, SIDE + 6], [x, SIDE - 190]], 4, L('#7a7d80', 0.3), { r, even: true }); R_(pen, x - 18, SIDE - 196, 36, 46, alive ? '#f6f1e6' : '#b5b8bb', { r, len: 10, sw: 5 }); PAINT.text(pen, 'NO', x, SIDE - 176, '800 11px Inter', alive ? '#c0392b' : '#6d7177', {}); PAINT.text(pen, 'PARKING', x, SIDE - 162, '800 7px Inter', alive ? '#c0392b' : '#6d7177', {}); }
  // мусор: у бака. Унылая — пакеты, переполнено, бумажки; живая — чисто, на баке ящик с цветами (горожане сами привели улицу в порядок)
  for (const [bx, big] of [[170, 1], [BIN_X, 0], [3080, 0], [5330, 1]]) {
    if (!alive) {
      if (big) for (let i = 0; i < 4; i++) { const px = bx + 40 + i * 30 + r() * 8, rad = 22 + r() * 10; PAINT.ellipse(pen, px, SIDE - rad * 0.8, rad, rad * 0.85, (u, v) => PAINT.mix('#3b3e44', '#15171a', u * 0.6 + v * 0.4), { r, ang: -40, len: 16, sw: 6, thick: 0.8 }); DB(pen, px - rad * 0.3, SIDE - rad * 1.3, 6, '#7c8087', { r, thick: 0.9 }); }
      for (let i = 0; i < 6; i++) { const px = bx - 60 + r() * 140, py = SIDE - 2 - r() * 8; if (r() < 0.5) R_(pen, px, py - 6, 12, 7, '#d8d4cc', { r, ang: r() * 90, len: 8, sw: 4, thick: 0.4 }); else PAINT.ellipse(pen, px, py - 4, 7, 4, '#9a9fa4', { r, len: 6, sw: 3, thick: 0.6 }); }
    } else if (big) { R_(pen, bx + 40, SIDE - 50, 110, 46, L('#7a5233', 0.3), { r, len: 16, sw: 6, thick: 0.8 }); for (let i = 0; i < 18; i++) DB(pen, bx + 46 + r() * 100, SIDE - 56 - r() * 22, 9, i % 3 ? '#3f9e4a' : ['#ff4f8b', '#ffd23f', '#ffffff', '#c77dff'][i % 4], { r, thick: 0.9 }); }
  }
}

// ---------- сборка холстов ----------
const LAYERS = {};
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
async function paintAll() {
  for (const mode of ['alive', 'dull']) {
    MODE = mode;
    const sky = PAINT.surface(2520 * 0.6, 1260 * 0.6); sky.cx.setTransform(0.6, 0, 0, 0.6, 200 * 0.6, 80 * 0.6); sky.hx.setTransform(0.6, 0, 0, 0.6, 200 * 0.6, 80 * 0.6);
    paintSky({ cx: sky.cx, hx: sky.hx }); await yieldUI();
    const far = PAINT.surface(3300 * 0.7, 1150 * 0.7); far.cx.setTransform(0.7, 0, 0, 0.7, -460 * 0.7, 220 * 0.7); far.hx.setTransform(0.7, 0, 0, 0.7, -460 * 0.7, 220 * 0.7);
    paintFar({ cx: far.cx, hx: far.hx }); await yieldUI();
    const world = PAINT.surface(WW * PK, WH * PK); world.cx.setTransform(PK, 0, 0, PK, -WX0 * PK, -WY0 * PK); world.hx.setTransform(PK, 0, 0, PK, -WX0 * PK, -WY0 * PK);
    const pen = { cx: world.cx, hx: world.hx };
    for (const b of BUILD) { MODE = mode; paintBuilding(pen, b); await yieldUI(); }
    MODE = mode; paintStreet(pen); paintProps(pen); await yieldUI();
    MODE = mode; 
    const clouds = mode === 'alive' ? [cloudSprite(1, false), cloudSprite(2, false, 420, 180), cloudSprite(3, false, 600, 220)] : [cloudSprite(4, true, 700, 260), cloudSprite(5, true, 600, 230), cloudSprite(6, true, 760, 280), cloudSprite(7, true, 560, 210)];
   
    LAYERS[mode] = { sky, far, world, clouds };
    await yieldUI();
  }
  MODE = 'alive';
}
