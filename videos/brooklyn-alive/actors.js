/* Brooklyn Alive — живые элементы. Каждый рисуется мазками в каждом кадре в обеих версиях города.
 * Логика перехода: живая версия стартует из унылой позы в момент, когда нить проходит через элемент
 * (w = пружина 0→1), поэтому на границе формы совпадают, а дальше элемент «просыпается».
 * Физика — замкнутые формулы от t: ветер, толчки от отскоков шарика, полёт, падение листа, пружины. */
'use strict';
const ACTOR_MARKS = [];
const ACT = [];
const D2R = Math.PI / 180;
const lerp = (a, b, k) => a + (b - a) * k;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const k = sat((v - a) / (b - a)); return k * k * (3 - 2 * k); };
const RG = (seed, k = 0) => PAINT.rng(seed * 131 + k * 7919 + 17);
const actor = (o) => { o.seed = o.seed || 300 + ACT.length * 37; o.z = o.z || 0; o.r = o.r || 120; ACT.push(o); return o; };
const SP = (pen) => ({ cx: pen.cx, hx: null }); // только цвет: тени, свет, вода, дым
const tf = (pen, fn, x, y, rot = 0, sx = 1, sy = 1) => { for (const g of [pen.cx, pen.hx]) { if (!g) continue; g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(sx, sy); } fn(); for (const g of [pen.cx, pen.hx]) if (g) g.restore(); };
const SPR = { alive: {}, dull: {} };
const spr = (name) => SPR[MODE][name];

// ---------- люди ----------
const PEOPLE = [ // x, кожа, верх, низ, волосы, роль, зонт в унылой
  { x: 1120, skin: '#c98d6b', top: '#3a86ff', bot: '#22313f', hair: '#2b1d16', role: 'dog', umb: '#1d2a44' },
  { x: 2330, skin: '#f1c7a5', top: '#ff6b6b', bot: '#2d3142', hair: '#e2b33c', role: 'cust', umb: '#2b2b2f' },
  { x: 2405, skin: '#8d5a3b', top: '#ffd23f', bot: '#3d405b', hair: '#1b1b1b', role: 'cust', hat: '#2a9d8f', umb: '#3a2a4a' },
  { x: 2478, skin: '#e0ac86', top: '#9b5de5', bot: '#264653', hair: '#6d3b1f', role: 'cust', kid: true, hood: true },
  { x: STAND_X + 10, skin: '#c58c63', top: '#ffffff', bot: '#333333', hair: '#1b1b1b', role: 'vendor', hat: '#e63946' },
  { x: 3250, skin: '#f0c4a0', top: '#06d6a0', bot: '#1d3557', hair: '#a0522d', role: 'pair', umb: '#24303a', face: 1 },
  { x: 3318, skin: '#6f4a34', top: '#ef476f', bot: '#2b2d42', hair: '#111111', role: 'pair', umb: '#3b2430', face: -1 },
  { x: 3960, skin: '#f3d0b5', top: '#118ab2', bot: '#073b4c', hair: '#f4a261', role: 'kid', kid: true, hood: true },
  { x: 4380, skin: '#9c6644', top: '#f77f00', bot: '#2d2d2d', hair: '#111111', role: 'music', hat: '#222222' },
  { x: 5050, skin: '#e8b996', top: '#e76f51', bot: '#264653', hair: '#3b2a20', role: 'walk', umb: '#1f2a33', face: -1 },
  { x: 5480, skin: '#7a5236', top: '#4cc9f0', bot: '#3a0ca3', hair: '#111111', role: 'walk', umb: '#2b2b2f', face: -1 },
];
const J = (x, y, ang, len) => [x + Math.sin(ang * D2R) * len, y + Math.cos(ang * D2R) * len]; // угол от «вниз», + к лицу
function poseSad(p, t) {
  const ph = p.ph, br = Math.sin(t * 1.3 + ph);
  const o = { jump: 0, hipX: 0, lean: 7 + br * 0.6, head: 14, armL: [6, 10], armR: [-5, 12], legL: [-3, 3], legR: [3, -2], umb: p.umb ? 1 : 0, eye: 0, mouth: 0, walk: 0 };
  if (p.umb) o.armL = [28, -112];
  if (p.role === 'vendor') { o.armL = [62, -34]; o.armR = [58, -30]; o.lean = 14; o.head = 10; }
  if (p.role === 'music') { o.head = 20; o.lean = 5; }
  if (p.kid) { o.armL = [10, 25]; o.armR = [-10, 25]; o.head = 12; }
  if (p.role === 'dog') o.armR = [38, -10];
  if (p.role === 'walk') { const s = Math.sin(t * 4.2 + ph); o.legL = [s * 13, 4]; o.legR = [-s * 13, 4]; o.armR = [-s * 8, 10]; o.walk = 1; }
  return o;
}
function poseHappy(p, t) {
  const ph = p.ph, s = Math.sin(t * 9 + ph), b5 = Math.abs(Math.sin(t * 5.2 + ph));
  const o = { jump: b5 * 14, hipX: 0, lean: -2, head: Math.sin(t * 5 + ph) * 7, armL: [150 + s * 22, 20], armR: [-150 + s * 22, -20], legL: [-4, b5 * 18], legR: [4, b5 * 18], umb: 0, eye: 1, mouth: 1, walk: 0 };
  if (p.role === 'vendor') { const k = ((t * 0.72 + ph) % 1); o.jump = Math.abs(Math.sin(t * 5)) * 3; o.armR = [-40 - Math.sin(k * Math.PI * 2) * 50, -60]; o.armL = [130 + s * 30, 30]; }
  if (p.role === 'music') { o.jump = Math.abs(Math.sin(t * 6.3)) * 4; o.armR = [40 + Math.sin(t * 14) * 18, -70]; o.armL = [55, -95]; o.head = Math.sin(t * 6.3) * 9; o.legR = [8, Math.abs(Math.sin(t * 6.3)) * 14]; }
  if (p.role === 'pair') { const sw = Math.sin(t * 4.2 + (p.face > 0 ? 0 : Math.PI)); o.jump = Math.abs(Math.sin(t * 4.2)) * 8; o.hipX = sw * 6; o.armR = [72, -18]; o.armL = [-150 + s * 15, -20]; o.head = sw * 9; }
  if (p.role === 'kid') { o.jump = Math.abs(Math.sin(t * 6 + ph)) * 22; o.armL = [168, 8]; o.armR = [-140 + s * 25, -20]; }
  if (p.role === 'walk') { const st = Math.sin(t * 7 + ph); o.jump = Math.abs(Math.cos(t * 7 + ph)) * 6; o.legL = [st * 26, 8]; o.legR = [-st * 26, 8]; o.armL = [-st * 30, 20]; o.armR = [st * 30, 20]; o.walk = 1; }
  if (p.role === 'dog') { o.armR = [40, -10]; o.armL = [150 + s * 25, 20]; o.jump = b5 * 6; }
  return o;
}
function blendPose(a, b, w) { const o = {}; for (const k in a) o[k] = Array.isArray(a[k]) ? [lerp(a[k][0], b[k][0], w), lerp(a[k][1], b[k][1], w)] : lerp(a[k], b[k], w); return o; }
function personX(p, t, w, a) { // гуляющие идут: унылые — медленно влево, живые — бодро; у живого путь продолжается из точки встречи с нитью
  if (p.role !== 'walk') return p.x;
  const xs = (tt) => p.x - 28 * tt;
  if (!A() || t < a.tp) return xs(t);
  return xs(a.tp) - 28 * (t - a.tp) - 34 * (t - a.tp) * sat(w);
}
function drawUmbrella(pen, hx, hy, open, ang, col, seed, t) {
  const r = RG(seed, 9), a = (ang * Math.PI) / 180, UL = 72, tx = hx + Math.sin(a) * UL, ty = hy - Math.cos(a) * UL;
  PAINT.path(pen, [[hx, hy + 6], [hx - 4, hy + 10], [hx, hy], [tx, ty]], 2.6, L_(('#2a2a2e')), { r, even: true, nb: 0, thick: 0.7 });
  const rad = 52 * (0.18 + 0.82 * open), hgt = 30 * (0.4 + 0.6 * open) + (1 - open) * 26;
  const pts = []; for (let i = 0; i <= 14; i++) { const u = i / 14, xx = (u - 0.5) * 2 * rad; pts.push([xx, -Math.sqrt(Math.max(0, 1 - (xx / rad) * (xx / rad))) * hgt * (open > 0.3 ? 1 : 0.5)]); }
  for (let i = 1; i <= 6; i++) { const u = i / 7; pts.push([(0.5 - u) * 2 * rad, Math.sin(u * 7 * Math.PI) * 4 * open]); }
  tf(pen, () => {
    PAINT.poly(pen, pts, (u, v) => L(col, 0.45 - u * 0.9 - v * 0.2), { r, ang: 0, angJ: 20, len: 22, sw: 8, thick: 0.75, var: 0.08 });
    for (let k = -2; k <= 2; k++) PAINT.path(pen, [[0, -hgt], [k * rad * 0.45, 0]], 1.2, L(col, -0.5), { r, even: true, nb: 0, thick: 0.3, alpha: 0.6 });
    if (!A() && open > 0.5) for (let i = 0; i < 4; i++) { const q = RG(seed, Math.floor(t * 12) * 4 + i), xx = (q() - 0.5) * rad * 1.6; PAINT.dab(SP(pen), xx, -Math.sqrt(Math.max(0, 1 - (xx / rad) ** 2)) * hgt - 3, 3.2, '#e2e6ea', { r: q, alpha: 0.75 }); } // дождь бьёт по куполу
  }, tx, ty, a, 1, 1);
}
const L_ = (hex) => L(hex, 0);
function personSkel(a, t, w) { // скелет человека в момент t (без рисования) — нужен и соседям: поводок, шарик, яблоко
  const p = a.p, sc = (p.kid ? 0.74 : 1) * 1.12, alive = A();
  const po = blendPose(poseSad(p, t), poseHappy(p, t), alive ? w : 0);
  const x = personX(p, t, w, a), y = p.role === 'vendor' ? 884 : SIDE, face = p.face || 1;
  const up = -po.jump, hipY = -60 + up, hip = [po.hipX, hipY];
  const sh = J(hip[0], hip[1], 180 + po.lean, 54), neck = J(sh[0], sh[1], 180 + po.lean * 0.6, 8);
  const arms = [[-1, po.armL], [1, po.armR]].map(([s, arm]) => { const s0 = [sh[0] + s * 14, sh[1] + 4], el = J(s0[0], s0[1], arm[0], 26), hd = J(el[0], el[1], arm[0] + arm[1], 24); return { s, s0, el, hd }; });
  const toW = (pt) => [x + pt[0] * sc * face, y + pt[1] * sc];
  return { p, sc, po, x, y, face, up, hipY, hip, sh, neck, arms, handW: arms.map((q) => toW(q.hd)) };
}
const wOf = (a, t) => (A() ? PHY.wake(t - a.tp, a.wf || 1.5, a.wz || 0.42) : 0);
const findP = (role) => ACT.find((q) => q.p && q.p.role === role);
function drawPerson(pen, a, t, w) {
  const alive = A(), K = personSkel(a, t, w), { p, sc, po, x, y, face, up, hipY, hip, sh, neck } = K;
  // тень: в живой — косая от солнца влево, в унылой — пятно под ногами (мокрый асфальт)
  if (p.role !== 'vendor') {
    const g = pen.cx; g.save(); g.fillStyle = alive ? 'rgba(40,34,80,0.28)' : 'rgba(30,34,40,0.25)';
    g.beginPath(); if (alive) { g.ellipse(x - 34 * sc, y + 3, 42 * sc * (1 - po.jump / 90), 6, -0.05, 0, Math.PI * 2); } else g.ellipse(x, y + 2, 22 * sc, 4.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  tf(pen, () => {
    const r = (k) => RG(a.seed, k);
    const top = L(p.top, 0.25), bot = L(p.bot, 0.1), skin = L(p.skin, 0.25), dark = L('#1e1e22', 0);
    // ноги
    if (p.role !== 'vendor') for (const [s, lg] of [[-1, po.legL], [1, po.legR]]) {
      const h0 = [hip[0] + s * 6, hipY], knee = J(h0[0], h0[1], lg[0] + lg[1] * 0.5, 31), foot = J(knee[0], knee[1], lg[0] - lg[1] * 0.4, 30);
      const fy = Math.min(foot[1], up);
      PAINT.path(pen, [h0, knee, [foot[0], fy]], 11, s > 0 ? bot : L(p.bot, -0.15), { r: r(s + 5), even: true, thick: 0.75, nb: 2 });
      PAINT.dab(pen, foot[0] + 4, fy, 9, dark, { r: r(s + 8), ang: 0, elong: 1.5, thick: 0.8 });
    }
    // корпус: пальто
    const coat = [[sh[0] - 15, sh[1] + 1], [sh[0] + 15, sh[1] + 1], [hip[0] + 19, hipY + 9], [hip[0] - 19, hipY + 9]]; // пальто: плечи уже подола
    PAINT.poly(pen, coat, (u, v) => L(p.top, 0.5 - u * 0.75 - v * 0.15), { r: r(1), ang: 92, angJ: 8, len: 18, sw: 8, thick: 0.8, var: 0.07 });
    PAINT.path(pen, [[sh[0] - 15, sh[1] + 6], [sh[0], sh[1]], [sh[0] + 15, sh[1] + 6]], 10, top, { r: r(2), even: true, thick: 0.8, nb: 2 });
    PAINT.path(pen, [[sh[0] + 1, sh[1] + 6], [hip[0] + 1, hipY + 6]], 1.4, L(p.top, -0.6), { r: r(4), even: true, nb: 0, alpha: 0.6 }); // шов/молния
    PAINT.path(pen, [neck, [neck[0], neck[1] + 6]], 8, skin, { r: r(5), even: true, nb: 0 });
    if (p.umb) { PAINT.path(pen, [[sh[0] - 9, sh[1] - 2], [sh[0], sh[1] + 1], [sh[0] + 9, sh[1] - 2]], 7, L(alive ? '#f4d35e' : '#8a8f96', 0.2), { r: r(6), even: true, thick: 0.8 }); PAINT.path(pen, [[sh[0] + 6, sh[1]], [sh[0] + 8, sh[1] + 20 + Math.sin(t * 2 + p.ph) * 2]], 6, L(alive ? '#f4d35e' : '#8a8f96', 0), { r: r(7), even: true }); } // шарф: холодно и мокро
    if (p.role === 'vendor') PAINT.path(pen, [[hip[0], hipY - 2], [sh[0] * 0.6, sh[1] + 18]], 26, L('#2a9d8f', 0.2), { r: r(3), even: true, thick: 0.7 }); // фартук
    // руки
    const hands = K.arms.map((q) => q.hd);
    for (const q of K.arms) {
      PAINT.path(pen, [q.s0, q.el, q.hd], 10, q.s < 0 ? L(p.top, 0.05) : top, { r: r(10 + q.s), even: true, thick: 0.75, nb: 2 });
      PAINT.dab(pen, q.hd[0], q.hd[1], 8.5, skin, { r: r(12 + q.s), thick: 0.7 });
    }
    // голова
    const hc = J(neck[0], neck[1], 180 + po.lean * 0.3 + po.head * 0.2, 16);
    tf(pen, () => {
      PAINT.dab(pen, 0, 0, 32, skin, { r: r(20), ang: 90, elong: 1.05, thick: 0.75, nb: 4 });
      PAINT.dab(pen, -6, 5, 16, L(p.skin, -0.5), { r: r(21), alpha: alive ? 0.45 : 0.3, ang: 70 }); // тень щеки
      if (p.hood && (!alive || w < 0.5)) PAINT.path(pen, [[-17, 8], [-18, -10], [0, -21], [18, -10], [17, 8]], 8, L(p.top, 0.1), { r: r(22), even: true, thick: 0.8 });
      else if (p.hat) { PAINT.path(pen, [[-17, -8], [0, -27], [17, -8]], 14, L(p.hat, 0.3), { r: r(23), even: true, thick: 0.85 }); PAINT.path(pen, [[-22, -9], [22, -9]], 5, L(p.hat, 0.1), { r: r(24), even: true }); }
      else { PAINT.path(pen, [[-16, 0], [-15, -14], [0, -20], [15, -14], [16, -2]], 9, L(p.hair, 0.2), { r: r(25), thick: 0.8, nb: 3 }); }
      const happy = alive && w > 0.5, ink = '#1b1b1b';
      if (happy) { for (const ex of [-6, 6]) PAINT.path(pen, [[ex - 3.5, 0], [ex, -3.5], [ex + 3.5, 0]], 2.2, ink, { r: r(26), even: true, nb: 0, thick: 0.5 }); for (const ex of [-10, 10]) PAINT.dab(SP(pen), ex, 6, 6, '#ff7d9a', { r: r(27), alpha: 0.5 }); }
      else { for (const ex of [-5.5, 5.5]) PAINT.dab(pen, ex, 0, 3.4, ink, { r: r(28), nb: 0, thick: 0.4 }); PAINT.path(pen, [[-9.5, -7], [-3, -5]], 1.8, ink, { r: r(29), even: true, nb: 0 }); PAINT.path(pen, [[9.5, -7], [3, -5]], 1.8, ink, { r: r(30), even: true, nb: 0 }); }
      const my = lerp(2, 14, alive ? sat(w) : 0); PAINT.path(pen, [[-6, 8], [0, my], [6, 8]], 2.2, happy ? '#7a1f2a' : ink, { r: r(31), even: true, nb: 0, thick: 0.5 });
    }, hc[0], hc[1], (po.head + po.lean * 0.4) * D2R, 1, 1);
    // реквизит
    if (p.role === 'music') { const g = J(sh[0], sh[1] + 30, 0, 0); tf(pen, () => { PAINT.ellipse(pen, 0, 18, 20, 16, L('#c8742c', 0.3), { r: r(40), len: 12, sw: 6, thick: 0.85 }); PAINT.dab(pen, 0, 18, 8, '#1b1b1b', { r: r(41) }); PAINT.path(pen, [[0, 6], [0, -48]], 6, L('#5b3a29', 0.2), { r: r(42), even: true }); }, g[0] + 4, g[1], (alive ? lerp(20, -30, sat(w)) : 20) * D2R); }
    if (po.umb > 0.01 && p.umb) { const open = alive ? sat(1 - w * 1.7) : 1, ang = alive ? lerp(0, 168, sstep(0.15, 0.9, w)) : 0; drawUmbrella(pen, hands[0][0], hands[0][1], open, ang + Math.sin(t * 1.1 + p.ph) * 2, p.umb, a.seed, t); }
  }, x, y, 0, sc * face, sc);
}

// ---------- собака ----------
function drawDog(pen, a, t, w) {
  const alive = A(), x = 1078, y = SIDE, wk = alive ? w : 0, r = (k) => RG(a.seed, k);
  const jump = wk > 0.5 ? Math.abs(Math.sin(t * 6.5)) * 18 * sat(w) : 0, lie = 1 - sat(wk * 1.4);
  const body = [x, y - 22 - jump + lie * 10], fur = L('#c58c48', 0.3);
  const walker = findP('dog');
  if (walker) { const [hx, hy] = personSkel(walker, t, wOf(walker, t)).handW[1], dx = body[0] + 26, dy = body[1] - 12; PAINT.path(pen, [[hx, hy], [(hx + dx) / 2, Math.max(hy, dy) + 24 - wk * 18], [dx, dy]], 2, L('#d62828', 0.2), { r: r(1), even: true, nb: 0, thick: 0.5 }); }
  if (!alive || wk < 0.3) { const g = pen.cx; g.save(); g.fillStyle = 'rgba(30,30,40,0.22)'; g.beginPath(); g.ellipse(x, y + 2, 34, 4, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  PAINT.path(pen, [[body[0] - 28, body[1]], [body[0] + 22, body[1] - 2]], 24 - lie * 4, fur, { r: r(2), even: true, thick: 0.8, nb: 4 });
  for (const lx of [-22, -12, 12, 20]) PAINT.path(pen, [[body[0] + lx, body[1] + 6], [body[0] + lx + (lie * 10), y - lie * 2 - (wk > 0.5 ? jump * 0.4 : 0)]], 6, L('#a06a32', 0.1), { r: r(3 + lx), even: true, nb: 0 });
  const head = [body[0] + 30, body[1] - 14 + lie * 12];
  PAINT.dab(pen, head[0], head[1], 24, fur, { r: r(4), ang: 0, thick: 0.8 });
  PAINT.dab(pen, head[0] + 12, head[1] + 4, 11, L('#d9a46a', 0.3), { r: r(5), ang: 0 });
  PAINT.dab(pen, head[0] + 18, head[1] + 2, 5, '#111', { r: r(6) });
  PAINT.dab(pen, head[0] + 4, head[1] - 3, 3.5, '#111', { r: r(7) });
  const ear = lerp(40, -25, sat(wk)); PAINT.stroke(pen, head[0] - 4, head[1] - 8, 90 + ear, 16, 8, L('#8a5a2b', 0), { r: r(8), thick: 0.8 });
  if (alive && w > 0.5) PAINT.stroke(pen, head[0] + 14, head[1] + 8, 80, 8, 5, '#e5383b', { r: r(9) });
  const wag = alive ? lerp(30, -40 + Math.sin(t * 22) * 30, sat(w)) : 32 + Math.sin(t * 1.2) * 3;
  PAINT.stroke(pen, body[0] - 28, body[1] - 4, 180 + wag, 22, 7, fur, { r: r(10), thick: 0.8 });
}

// ---------- голуби ----------
function drawPigeon(pen, x, y, t, s, fly, seed, flip = 1) {
  const r = (k) => RG(seed, k), alive = A(), body = alive ? '#8f93a3' : '#8e9196';
  tf(pen, () => {
    if (fly > 0) { // взмахи: крылья вверх-вниз
      const f = Math.sin(t * 38 + seed) * 0.9;
      for (const sd of [-1, 1]) PAINT.stroke(pen, 0, -2, -90 + sd * (70 + f * 40), 20, 9, L(body, sd > 0 ? 0.3 : -0.1), { r: r(sd + 3), thick: 0.6 });
    }
    PAINT.dab(pen, 0, 0, 13, L(body, 0.2), { r: r(1), ang: -10, elong: 1.5, thick: 0.7 });
    const hb = fly > 0 ? 0 : Math.max(0, Math.sin(t * 7 + seed)) * 6; // клюёт
    PAINT.dab(pen, 9, -6 + hb, 8, L(body, 0.3), { r: r(2), thick: 0.7 });
    if (alive) PAINT.dab(SP(pen), 6, -1 + hb * 0.5, 6, '#4fb38a', { r: r(4), alpha: 0.55 }); // переливы на шее
    PAINT.stroke(pen, 12, -6 + hb, 0, 4, 2.2, '#e0a050', { r: r(5), nb: 0 });
    PAINT.stroke(pen, -8, -1, 180, 9, 6, L(body, -0.3), { r: r(6) });
    if (!fly) for (const lx of [-2, 3]) PAINT.path(pen, [[lx, 5], [lx, 10]], 1.6, '#c0603a', { r: r(7), even: true, nb: 0 });
  }, x, y, fly > 0 ? -0.2 : 0, s * flip, s);
}

// ---------- регистрация живых элементов ----------
function initActors() {
  PEOPLE.forEach((p, i) => { p.ph = i * 1.37; actor({ x: p.x, y: SIDE - 80, z: p.role === 'vendor' ? 2.0 : 2.5, r: 200, p, wf: 1.3, draw: drawPerson }); });
  actor({ x: 1078, y: SIDE - 30, z: 2.4, r: 140, wf: 1.6, draw: drawDog });
  initWindows(); initStreet(); initSky(); initSprites();
  for (const a of ACT) a.tp = tPass(a.tx != null ? a.tx : a.x, a.ty != null ? a.ty : a.y);
  ACT.sort((a, b) => a.z - b.z);
}
function drawActors(pen, t, cam) {
  const x0 = -cam.ox / cam.z, x1 = (W - cam.ox) / cam.z, alive = A();
  for (const a of ACT) {
    if (a.x + a.r < x0 || a.x - a.r > x1) continue;
    if (a.only && a.only !== MODE) continue;
    const w = alive ? PHY.wake(t - a.tp, a.wf || 1.5, a.wz || 0.42) : 0;
    a.draw(pen, a, t, w, cam);
  }
}

// ---------- окна: у каждого своя история ----------
function initWindows() {
  for (const wn of WINDOWS) {
    const { x, y, w, h } = wn, base = { x: x + w / 2, y: y + h / 2, z: 0, r: 80, seed: wn.seed };
    if (wn.story === 'flowers') actor(Object.assign(base, { wf: 1.2, draw: (pen, a, t, wk) => drawFlowerBox(pen, x, y + h + 10, w, t, wk, a.seed) }));
    if (wn.story === 'cat') actor(Object.assign(base, { draw: (pen, a, t, wk) => drawCat(pen, x + w * 0.5, y + h, t, wk, a.seed) }));
    if (wn.story === 'person') actor(Object.assign(base, { wf: 1.1, wz: 0.5, draw: (pen, a, t, wk) => drawWindowPerson(pen, wn, t, wk, a.seed) }));
    if (wn.story === 'ac') actor(Object.assign(base, { only: 'dull', draw: (pen, a, t) => drawDrip(pen, x + w * 0.7, y + h + 4, t, a.seed, 260) }));
    if (wn.story === 'tv') actor(Object.assign(base, { only: 'dull', draw: (pen, a, t) => { const f = 0.5 + 0.5 * MG.noise(t * 9, a.seed); pen.cx.fillStyle = `rgba(150,180,230,${(0.08 + 0.16 * f).toFixed(3)})`; pen.cx.fillRect(x + 3, y + 3, w - 6, h - 6); } }));
    if (wn.story === 'flag') actor(Object.assign(base, { r: 160, draw: (pen, a, t, wk) => drawFlag(pen, x + w + 4, y + 10, t, wk, a.seed) }));
    if (wn.story === 'laundry' && wn.b.t === 'walkup') actor(Object.assign(base, { r: 260, draw: (pen, a, t, wk) => drawLaundry(pen, wn, t, wk, a.seed) }));
  }
  // голуби на карнизах
  BUILD.forEach((b, i) => { if (i % 3 === 1) for (let k = 0; k < 2; k++) { const px = b.x + 60 + k * 70 + (i * 37) % 90; actor({ x: px, y: b.top - 10, z: 0.2, r: 30, seed: 900 + i * 11 + k, draw: (pen, a, t) => drawPigeon(pen, px, b.top - 16, t, 0.9, 0, a.seed, k ? -1 : 1) }); } });
}
function drawFlowerBox(pen, x, y, w, t, wk, seed) {
  const alive = A(), n = 6;
  for (let i = 0; i < n; i++) {
    const r = RG(seed, i), fx = x + 4 + (i + 0.5) * (w / n), hgt = 18 + r() * 9;
    const sway = (PHY.wind(fx, t) * 7 + PHY.kick(fx, y, t, 3.5, 3.5, 300) * 28 + Math.sin(t * 2.2 + i) * 2) * D2R;
    const droop = alive ? lerp(1, 0, sat(wk)) : 1; // вялые — стебель согнут вниз; оживают — распрямляются
    const tip = [fx + Math.sin(sway + droop * 1.9) * hgt, y - Math.cos(sway + droop * 1.9) * hgt * (1 - droop * 0.35)];
    const mid = [fx + Math.sin(sway * 0.5 + droop * 0.6) * hgt * 0.55, y - hgt * 0.55];
    PAINT.path(pen, [[fx, y], mid, tip], 2.6, alive ? L('#3f9e4a', 0.2) : C('#6f6a55'), { r, even: true, nb: 0, thick: 0.6 });
    PAINT.dab(pen, mid[0] + 4, mid[1] + 3, 6, alive ? L('#4cbf68', 0.2) : C('#77705a'), { r, ang: -30, thick: 0.6 });
    const bloom = alive ? 0.45 + 0.55 * sat(wk) : 0.4, col = ['#ff4f6d', '#ffd23f', '#ff7b39', '#ffffff', '#c77dff', '#ff4f8b'][(seed + i) % 6];
    if (alive) { for (let k = 0; k < 5; k++) { const ang = k * 1.256 + i; PAINT.dab(pen, tip[0] + Math.cos(ang) * 4.5 * bloom, tip[1] + Math.sin(ang) * 4.5 * bloom, 6 * bloom, L(col, 0.3), { r, thick: 0.85 }); } PAINT.dab(pen, tip[0], tip[1], 3.5, '#ffd23f', { r, thick: 0.9 }); }
    else PAINT.dab(pen, tip[0], tip[1] + 2, 5, C('#7a6a55'), { r, ang: 90, thick: 0.6 });
  }
}
function drawCat(pen, x, y, t, wk, seed) {
  const alive = A(), r = (k) => RG(seed, k), up = alive ? sat(wk) : 0, fur = L('#e8a35a', 0.2);
  const ball = ballWorld(Math.min(t, EXIT_T)), look = MG.clamp((ball.x - x) / 400, -1, 1) * up;
  PAINT.dab(pen, x, y - 8 - up * 8, 26 - up * 6, fur, { r: r(1), ang: 0, elong: 1.4 - up * 0.5, thick: 0.8 });
  const head = [x + lerp(-12, 2, up) + look * 4, y - lerp(8, 32, up)];
  PAINT.dab(pen, head[0], head[1], 16, fur, { r: r(2), thick: 0.8 });
  for (const s of [-1, 1]) PAINT.stroke(pen, head[0] + s * 5, head[1] - 5, -90 + s * 20, 9, 6, fur, { r: r(3 + s), taper: 0.4 });
  if (up > 0.5) for (const s of [-1, 1]) PAINT.dab(pen, head[0] + s * 3.5 + look * 2, head[1], 2.5, '#2a3a1a', { r: r(5) });
  else PAINT.path(pen, [[head[0] - 5, head[1]], [head[0] + 5, head[1]]], 1.5, '#3a2a1a', { r: r(6), even: true, nb: 0 });
  const tail = up > 0.3 ? Math.sin(t * 3.2 + seed) * 35 : 10;
  PAINT.path(pen, [[x + 12, y - 8], [x + 22, y - 14 - up * 4], [x + 24 + Math.sin(tail * D2R) * 10, y - 26 - up * 10]], 5, fur, { r: r(7), thick: 0.8 });
}
function drawWindowPerson(pen, wn, t, wk, seed) { // в живой: открывает окно и высовывается помахать шарику
  if (!A()) return;
  const k = sat(wk), r = (q) => RG(seed, q), cx0 = wn.x + wn.w / 2, sill = wn.y + wn.h;
  const p = PEOPLE[seed % PEOPLE.length], rise = k * 34;
  pen.cx.fillStyle = 'rgba(60,40,30,0.55)'; pen.cx.fillRect(wn.x + 4, wn.y + wn.h * 0.5, wn.w - 8, wn.h * 0.5 - 2); // открытая створка: тёмный проём
  PAINT.path(pen, [[cx0, sill + 2], [cx0, sill - 12 - rise]], 26, L(p.top, 0.2), { r: r(1), even: true, thick: 0.7 });
  PAINT.dab(pen, cx0, sill - 26 - rise, 24, L(p.skin, 0.25), { r: r(2), thick: 0.75 });
  PAINT.path(pen, [[cx0 - 10, sill - 33 - rise], [cx0, sill - 38 - rise], [cx0 + 10, sill - 33 - rise]], 6, L(p.hair, 0.1), { r: r(3), even: true });
  for (const ex of [-4, 4]) PAINT.path(pen, [[cx0 + ex - 2.5, sill - 26 - rise], [cx0 + ex, sill - 28.5 - rise], [cx0 + ex + 2.5, sill - 26 - rise]], 1.6, '#1b1b1b', { r: r(4), even: true, nb: 0 });
  PAINT.path(pen, [[cx0 - 4, sill - 21 - rise], [cx0, sill - 18 - rise], [cx0 + 4, sill - 21 - rise]], 1.6, '#7a1f2a', { r: r(5), even: true, nb: 0 });
  const wave = Math.sin(t * 9 + seed) * 25 * k, sh = [cx0 + 11, sill - 6 - rise], el = J(sh[0], sh[1], 150 + wave, 18), hd = J(el[0], el[1], 170 + wave, 16);
  PAINT.path(pen, [sh, el, hd], 7, L(p.top, 0.3), { r: r(6), even: true }); PAINT.dab(pen, hd[0], hd[1], 7, L(p.skin, 0.3), { r: r(7) });
}
function drawDrip(pen, x, y, t, seed, fallH) { // капли с кондиционера: срываются, падают с ускорением
  for (let i = 0; i < 2; i++) {
    const per = 0.9 + (seed % 5) * 0.11, ph = ((t + i * per * 0.5 + seed * 0.13) % per) / per, d = ph * per;
    if (d < 0.25) { PAINT.dab(SP(pen), x, y + 2, 3 + d * 6, '#c7ccd2', { r: RG(seed, i), alpha: 0.8 }); continue; }
    const fy = y + 0.5 * 1800 * (d - 0.25) * (d - 0.25); if (fy > y + fallH) continue;
    PAINT.stroke(SP(pen), x, fy - 6, 90, 10, 3, '#d7dce2', { r: RG(seed, i), alpha: 0.8, nb: 0 });
  }
}
function drawFlag(pen, x, y, t, wk, seed) { // флаг на древке: в унылой обвис и намок, в живой — полощется на ветру
  const alive = A(), k = alive ? sat(wk) : 0, r = (q) => RG(seed, q);
  PAINT.path(pen, [[x - 6, y + 20], [x + 70, y - 34]], 3, L('#c9c3b5', 0.4), { r: r(1), even: true });
  const fw = 74, fh = 46, n = 8;
  for (let row = 0; row < 6; row++) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, wave = Math.sin(u * 5 - t * 7 + row * 0.15) * 7 * u * (0.25 + k), limp = (1 - k) * u * u * 34;
      pts.push([x + 70 - 2 + u * fw * (1 - (1 - k) * 0.55), y - 34 + (row / 5) * fh + wave + limp]);
    }
    const col = row < 3 && false ? '#2b4a9a' : row % 2 ? '#f4f1ea' : '#c8202f';
    PAINT.path(pen, pts, fh / 6 + 1.5, L(col, 0.2 + (row % 2) * 0.1), { r: r(2 + row), even: true, thick: 0.65, nb: 2 });
  }
  const cpts = []; for (let i = 0; i <= 4; i++) { const u = i / n; cpts.push([x + 68 + u * fw * (1 - (1 - k) * 0.55), y - 34 + fh * 0.25 + Math.sin(u * 5 - t * 7) * 7 * u * (0.25 + k) + (1 - k) * u * u * 34]); }
  PAINT.path(pen, cpts, fh * 0.5, L('#2b4a9a', 0.15), { r: r(9), even: true, thick: 0.7 });
}
function drawLaundry(pen, wn, t, wk, seed) { // бельё на верёвке между пожарной лестницей и соседним домом
  const alive = A(), k = alive ? sat(wk) : 0, x0 = wn.b.x + 10, x1 = wn.b.x + wn.b.w - 10, y0 = wn.y - 30;
  const sag = 26, n = 7, rope = [];
  for (let i = 0; i <= 20; i++) { const u = i / 20; rope.push([lerp(x0, x1, u), y0 + 4 * sag * u * (1 - u)]); }
  PAINT.path(pen, rope, 1.6, L('#e8e2d0', 0.2), { r: RG(seed, 1), even: true, nb: 0, thick: 0.4 });
  for (let i = 1; i < n; i++) {
    const u = i / n, px = lerp(x0, x1, u), py = y0 + 4 * sag * u * (1 - u), r = RG(seed, i + 3);
    const sw = (alive ? PHY.wind(px, t) * 18 * (0.4 + k) + Math.sin(t * 3 + i) * 6 * k : Math.sin(t * 0.8 + i) * 1.5) * D2R;
    const type = (seed + i) % 3, col = alive ? ['#ff6b6b', '#ffd23f', '#3a86ff', '#ffffff', '#06d6a0', '#c77dff'][(seed + i) % 6] : '#b8bcc0';
    tf(pen, () => {
      if (type === 0) { PAINT.poly(pen, [[-14, 0], [14, 0], [16, 8], [11, 9], [11, 30], [-11, 30], [-11, 9], [-16, 8]], (uu, vv) => L(col, 0.3 - vv * 0.5), { r, ang: 90, len: 12, sw: 5, thick: 0.7 }); }
      else if (type === 1) { PAINT.poly(pen, [[-9, 0], [9, 0], [10, 34], [2, 34], [0, 12], [-2, 34], [-10, 34]], (uu, vv) => L(col, 0.2 - vv * 0.5), { r, ang: 90, len: 12, sw: 5, thick: 0.7 }); }
      else { PAINT.path(pen, [[-4, 0], [-4, 16], [3, 20]], 6, L(col, 0.2), { r, even: true }); }
      if (!alive) PAINT.dab(SP(pen), 0, 34 + ((t * 60 + i * 13) % 50), 2.5, '#d7dce2', { r, alpha: 0.8 }); // мокрое бельё капает
    }, px, py, sw);
  }
}

// ---------- улица ----------
function initStreet() {
  // кроны деревьев: качаются от ветра и от ударов; лепестки (живая) / сухие листья (унылая)
  TREES.forEach((tx, i) => actor({ x: tx, y: SIDE - 260, z: 3.2, r: 200, seed: 1500 + i, draw: (pen, a, t, wk) => drawTree(pen, tx, t, wk, a.seed) }));
  // гирлянда-флажки между фонарями — только в живой (праздник на улице)
  for (let i = 0; i < LAMPS.length - 1; i++) { const x0 = LAMPS[i] + 30, x1 = LAMPS[i + 1] + 30; actor({ x: (x0 + x1) / 2, y: SIDE - 300, tx: x0 + 40, z: 3.3, r: (x1 - x0) / 2 + 60, only: 'alive', seed: 1600 + i, wf: 1.1, draw: (pen, a, t, wk) => drawBunting(pen, x0, x1, t, a.seed) }); }
  // фонари: в унылой горят в дожде
  LAMPS.forEach((lx) => actor({ x: lx + 32, y: SIDE - 310, z: 3.4, r: 260, only: 'dull', draw: (pen, a, t) => { const g = pen.cx; PAINT.glow(g, lx + 32, SIDE - 300, 120, '#f3e7b0', 0.35, 'screen'); g.save(); g.globalCompositeOperation = 'screen'; const gr = g.createLinearGradient(0, SIDE - 300, 0, SIDE); gr.addColorStop(0, 'rgba(240,230,180,0.16)'); gr.addColorStop(1, 'rgba(240,230,180,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(lx + 22, SIDE - 300); g.lineTo(lx + 44, SIDE - 300); g.lineTo(lx + 130, SIDE); g.lineTo(lx - 66, SIDE); g.closePath(); g.fill(); g.restore(); } }));
  // птицы по-над крышами (живая)
  // голуби на тротуаре — взлетают от первого удара
  for (let i = 0; i < 6; i++) {
    const px = 455 + i * 34 + (i % 2) * 9, s = RG(77, i), tk = 0.5 + Math.abs(px - 380) / 2200 + 0.04 + s() * 0.12, vx = (s() < 0.5 ? -1 : 1) * (220 + s() * 260), vy = -(380 + s() * 260);
    actor({ x: px, y: SIDE - 10, z: 2.6, r: 900, seed: 1700 + i, draw: (pen, a, t) => { const d = t - tk; if (d <= 0) return drawPigeon(pen, px, SIDE - 9, t, 1, 0, a.seed, i % 2 ? -1 : 1); const fx = px + vx * d, fy = SIDE - 9 + vy * d + 90 * d * d; if (fy < -400) return; drawPigeon(pen, fx, fy, t, 1, 1, a.seed, vx < 0 ? -1 : 1); } });
  }
  ACTOR_MARKS.push([0.6, 'swish', { gain: -15 }], [0.68, 'swish', { gain: -18, pitch: 1.2 }]);
  // голуби на навесе лавки — взлетают от удара по навесу
  for (let i = 0; i < 2; i++) { const px = STAND_X + 120 + i * 30, tk = 4.52 + i * 0.06; actor({ x: px, y: 630, z: 2.15, r: 700, seed: 1720 + i, draw: (pen, a, t) => { const d = t - tk; if (d <= 0) return drawPigeon(pen, px, 632 + awningDent(px, t), t, 0.95, 0, a.seed, -1); drawPigeon(pen, px + 300 * d, 632 - 420 * d + 80 * d * d, t, 0.95, 1, a.seed, 1); } }); }
  // лавка: задник, навес (прогибается от удара), продавец между ними, прилавок, фрукты (подпрыгивают)
  actor({ x: STAND_X, y: 700, z: 1.9, r: 260, draw: (pen, a, t) => drawStandBack(pen, t) });
  actor({ x: STAND_X, y: 830, z: 2.1, r: 260, draw: (pen, a, t, wk) => drawStandFront(pen, t, wk) });
  ACTOR_MARKS.push([4.6, 'tap', { gain: -15 }], [4.72, 'tap', { gain: -17, pitch: 1.2 }], [4.86, 'tap', { gain: -18, pitch: 0.9 }], [5.05, 'tap', { gain: -20, pitch: 1.1 }]);
  // крыльцо: горшки с цветами на ступенях — качаются от удара
  for (const [sx, sy, i] of [[STOOP_X - 62, 772, 0], [STOOP_X + 66, 772, 1], [STOOP_X - 84, 821, 2]]) actor({ x: sx, y: sy, z: 1.2, r: 60, seed: 1750 + i, draw: (pen, a, t, wk) => drawPot(pen, sx, sy, t, wk, a.seed) });
  ACTOR_MARKS.push([1.53, 'tap', { gain: -18, pitch: 0.8 }]);
  // такси: подвеска проседает от удара, водитель; выхлоп в унылой
  actor({ x: TAXI_X, y: 920, z: 3.6, r: 300, draw: (pen, a, t, wk) => drawTaxi(pen, t, wk) });
  // почтовый ящик: качается, из щели вылетают письма и планируют вниз
  actor({ x: MAIL_X, y: 840, z: 2.3, r: 400, draw: (pen, a, t) => drawMailbox(pen, t) });
  ACTOR_MARKS.push([6.56, 'swish', { gain: -17, pitch: 1.3 }]);
  // урна: крышка подскакивает от удара рядом; в унылой выкатывается банка
  actor({ x: BIN_X, y: 860, z: 2.2, r: 500, draw: (pen, a, t) => drawBin(pen, BIN_X, t) });
  ACTOR_MARKS.push([3.58, 'click', { gain: -10 }], [3.86, 'tap', { gain: -13 }], [4.02, 'tap', { gain: -17 }]);
  // газета: в унылой ветер тащит её по тротуару; в живой — складывается в самолётик и улетает
  actor({ x: 2200, y: 870, z: 2.35, r: 2000, wf: 1.0, draw: (pen, a, t, wk) => drawPaper(pen, a, t, wk) });
  // пар из люков
  for (const mx of [2850, 4500]) actor({ x: mx, y: 900, z: 3.5, r: 260, seed: mx, draw: (pen, a, t) => drawSteam(pen, mx, 988, t, a.seed) });
  // дым из труб: в унылой валит серый, в живой — тёплый день, не топят
  BUILD.forEach((b, i) => { if (b.chimney && i % 2 === 0) actor({ x: b.chimney[0], y: b.chimney[1] - 100, z: 0.1, r: 300, only: 'dull', seed: 1900 + i, draw: (pen, a, t) => drawSmoke(pen, b.chimney[0], b.chimney[1], t, a.seed) }); });
  // гидрант 1700: в живой открыт — фонтан на дорогу (лето в Бруклине), в унылой капает
  actor({ x: 1700, y: SIDE - 40, z: 2.45, r: 380, draw: (pen, a, t, wk) => drawHydrant(pen, 1700, t, wk, a.seed) });
  // барбершоп: столб крутится только в живой
  BUILD.forEach((b) => { if (b.pole) actor({ x: b.pole[0], y: b.pole[1] + 50, z: 1.0, r: 40, draw: (pen, a, t, wk) => drawPole(pen, b.pole[0], b.pole[1], t, wk) }); });
  // музыкант: футляр с монетами (монеты подпрыгивают от удара), ноты
  actor({ x: 4440, y: SIDE - 10, z: 2.55, r: 300, draw: (pen, a, t, wk) => drawCase(pen, 4440, t, wk) });
  ACTOR_MARKS.push([8.6, 'tick', { gain: -16 }], [8.68, 'tick', { gain: -18, pitch: 1.2 }]);
  // воздушный шарик ребёнка (надувается, когда оживает)
  actor({ x: 3990, y: SIDE - 250, z: 2.6, r: 260, only: 'alive', wf: 1.2, draw: (pen, a, t, wk) => drawBalloon(pen, a, t, wk) });
  // сердечки над парой и очередью, ноты над музыкантом
  actor({ x: 3284, y: SIDE - 250, z: 2.7, r: 200, only: 'alive', draw: (pen, a, t, wk) => drawHearts(pen, 3284, SIDE - 230, t, wk, a.seed) });
  actor({ x: 4400, y: SIDE - 260, z: 2.7, r: 260, only: 'alive', draw: (pen, a, t, wk) => drawNotes(pen, 4420, SIDE - 200, t, wk, a.seed) });
  // бабочки над цветами (живая)
  for (const [bx, by] of [[1000, 720], [2700, 600], [3500, 820], [4300, 640], [4900, 760]]) actor({ x: bx, y: by, z: 3.0, r: 120, only: 'alive', seed: bx, draw: (pen, a, t, wk) => drawButterfly(pen, bx, by, t, wk, a.seed) });
  // лужи: круги от капель (унылая)
  for (const [px, py, pw] of PUDDLES) actor({ x: px, y: py, z: 1.4, r: pw + 20, only: 'dull', seed: px, draw: (pen, a, t) => drawRipples(pen, px, py, pw, t, a.seed) });
  // брызги дождя на тротуаре (унылая)
  for (let k = 0; k < 18; k++) actor({ x: k * 320 + 80, y: SIDE, z: 1.45, r: 180, only: 'dull', seed: 2100 + k, draw: (pen, a, t) => drawRainSplashes(pen, a.x - 160, a.x + 160, t, a.seed) });
  // кляксы краски там, где шарик коснулся (живая)
  BOUNCES.forEach((b, i) => actor({ x: b[0], y: b[1], z: b[1] < SIDE - 10 ? 2.25 : 1.5, r: 80, only: 'alive', seed: 2200 + i, draw: (pen, a, t) => drawSplat(pen, b, t, a.seed) }));
  // брызги в момент касания: в живой — краска, в унылой — вода
  BOUNCES.forEach((b, i) => actor({ x: b[0], y: b[1], z: 4, r: 400, seed: 2300 + i, draw: (pen, a, t) => drawSplash(pen, b, t, a.seed) }));
}
function drawTree(pen, tx, t, wk, seed) {
  const alive = A(), ty = SIDE - 210;
  const sway = (PHY.wind(tx, t) * 1.6 + PHY.kick(tx, ty + 120, t, 2.2, 2.6, 320) * 5) * D2R;
  PAINT.put(pen, spr('canopy' + (seed % 3)), tx, ty, sway);
  // падающие лепестки (живая) / сухие листья (унылая): петля «падающего листа»
  const n = alive ? 9 : 5;
  for (let i = 0; i < n; i++) {
    const r = RG(seed, i), per = 3 + r() * 2, ph = (t / per + r()) % 1, d = ph * per;
    const x = tx + (r() - 0.5) * 220 + PHY.wind(tx, t) * 40 * d + Math.sin(d * 3 + i) * 18, y = ty - 40 + r() * 60 + d * (alive ? 55 : 80);
    if (y > SIDE) continue;
    PAINT.dab(pen, x, y, alive ? 5 : 6, alive ? (i % 2 ? '#ffc2d4' : '#fff0f4') : C(i % 2 ? '#8a6a3a' : '#6a5a40'), { r, ang: Math.sin(d * 4 + i) * 80, elong: 1.6, thick: 0.6 });
  }
  const nb = PHY.near(tx, ty + 150, t, 360); // удар рядом — с кроны осыпается пучок
  if (nb && nb.d < 2.5) for (let i = 0; i < 14; i++) {
    const r = RG(seed, 50 + i), d = nb.d, x = tx + (r() - 0.5) * 200 + nb.dir * 60 * d + Math.sin(d * 4 + i) * 14, y = ty - 30 + r() * 70 + d * 70 + 30 * d * d;
    if (y < SIDE) PAINT.dab(pen, x, y, 5, alive ? (i % 2 ? '#ffc2d4' : '#bfe58a') : C('#7a6a4a'), { r, ang: d * 200 + i * 30, elong: 1.6, thick: 0.6 });
  }
}
function canopySprite(seed, mode) {
  MODE = mode;
  return PAINT.sprite(340, 300, 170, 230, 1.3, (pen) => {
    const r = PAINT.rng(seed);
    if (mode === 'alive') {
      const cl = [[-60, -20, 70], [55, -30, 74], [0, -80, 84], [-30, -130, 60], [40, -120, 58], [-90, -70, 46], [90, -80, 44]];
      for (const [cx, cy, rad] of cl) for (let i = 0; i < rad * 1.1; i++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.85;
        const lightK = sat(((x + 120) / 240) * 0.5 + ((-y - 20) / 200) * 0.5 + (r() - 0.5) * 0.4);
        const col = lightK > 0.7 ? PAINT.mix('#8fd25a', '#e6f59a', (lightK - 0.7) * 2) : lightK > 0.35 ? PAINT.mix('#3f9e4a', '#8fd25a', (lightK - 0.35) / 0.35) : PAINT.mix('#24563a', '#3f9e4a', lightK / 0.35);
        PAINT.dab(pen, x, y, 11 + r() * 7, col, { r, ang: -40 + (r() - 0.5) * 60, thick: 0.8, var: 0.08 });
      }
      for (let i = 0; i < 46; i++) { const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 110; PAINT.dab(pen, Math.cos(a) * rr, -70 + Math.sin(a) * rr * 0.8, 6 + r() * 3, r() < 0.5 ? '#ffb8cc' : '#fff1f5', { r, thick: 0.9 }); }
    } else {
      for (let i = 0; i < 26; i++) { const a = (-150 + r() * 120) * D2R, l = 50 + r() * 80, x0 = (r() - 0.5) * 30, y0 = -r() * 40; PAINT.path(pen, [[x0, y0], [x0 + Math.cos(a) * l * 0.5, y0 + Math.sin(a) * l * 0.5 - 6], [x0 + Math.cos(a) * l, y0 + Math.sin(a) * l]], 2.5 + r() * 2, dullRGB('#5a4030'), { r, thick: 0.6, nb: 0 }); }
      for (let i = 0; i < 22; i++) PAINT.dab(pen, (r() - 0.5) * 200, -40 - r() * 130, 7, dullRGB(i % 2 ? '#8a6a3a' : '#6a5a40'), { r, thick: 0.6 });
    }
  });
}
function drawBunting(pen, x0, x1, t, seed) {
  const sag = 70, y = SIDE - 330, n = Math.floor((x1 - x0) / 42), rope = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24; rope.push([lerp(x0, x1, u), y + 4 * sag * u * (1 - u) + Math.sin(t * 1.4 + u * 3) * 3]); }
  PAINT.path(pen, rope, 1.8, '#fdf8ec', { r: RG(seed, 1), even: true, nb: 0, thick: 0.4 });
  for (let k = 1; k < n; k++) {
    const u = k / n, fx = lerp(x0, x1, u), fy = y + 4 * sag * u * (1 - u) + Math.sin(t * 1.4 + u * 3) * 3, tp = tPass(fx, fy);
    const pop = PHY.wake(t - tp, 2.2, 0.35); if (pop <= 0.01) continue;
    const sw = (Math.sin(t * 5.5 + k * 0.7) * 12 + PHY.wind(fx, t) * 18 + PHY.kick(fx, fy, t, 3, 3, 300) * 30) * D2R;
    const col = ['#ff4f8b', '#ffd23f', '#3a86ff', '#06d6a0', '#ff7b39', '#c77dff'][k % 6];
    tf(pen, () => PAINT.poly(pen, [[-12, 0], [12, 0], [0, 26]], (uu, vv) => L(col, 0.35 - vv * 0.5), { r: RG(seed, k + 3), ang: 90, len: 10, sw: 5, thick: 0.8 }), fx, fy, sw, 1, pop);
  }
}
// навес лавки: прогиб в точке удара + затухающие колебания ткани
function awningDent(x, t) { const d = t - 4.5; if (d <= 0) return 0; return 16 * Math.exp(-(((x - STAND_X) / 110) ** 2)) * Math.exp(-d * 5) * Math.cos(d * 2 * Math.PI * 3.2) * (d < 0.03 ? d / 0.03 : 1); }
function drawStandBack(pen, t) {
  const X = STAND_X, r = (k) => RG(77, k);
  for (const px of [-172, 172]) PAINT.path(pen, [[X + px, 650], [X + px, 893]], 8, L('#5b3a29', 0.2), { r: r(px), even: true, thick: 0.85 });
  PAINT.rect(pen, X - 168, 700, 336, 92, (u, v) => L('#3a2a22', 0.1 - v * 0.3), { r: r(1), ang: 90, len: 20, sw: 8, thick: 0.6 });
  // ящики на полках за продавцом
  for (let i = 0; i < 5; i++) { PAINT.rect(pen, X - 150 + i * 62, 742, 52, 30, L('#a0703f', 0.2), { r: r(10 + i), len: 14, sw: 6, thick: 0.7 }); for (let k = 0; k < 5; k++) PAINT.dab(pen, X - 142 + i * 62 + k * 9, 740, 8, L(['#8ac926', '#ffca3a', '#ff9f1c', '#e63946', '#c1121f'][i], 0.3), { r: r(20 + i * 5 + k), thick: 0.85 }); }
  // навес: полосы следуют прогибу
  const n = 12;
  for (let k = 0; k < n; k++) {
    const xa = X - 190 + k * 32, xb = xa + 32, da = awningDent(xa, t), db = awningDent(xb, t), col = k % 2 ? '#fbf6ec' : '#e63946';
    PAINT.poly(pen, [[xa, 640 + da], [xb, 640 + db], [xb, 686 + db * 0.6], [xa, 686 + da * 0.6]], (u, v) => L(col, 0.45 - v * 0.6), { r: r(30 + k), ang: 90, angJ: 4, len: 16, sw: 7, thick: 0.8 });
    PAINT.ellipse(pen, xa + 16, 686 + (da + db) * 0.3, 16, 10, L('#e63946', 0.0), { r: r(50 + k), len: 10, sw: 5, thick: 0.8 });
  }
  if (A()) PAINT.rect(SP(pen), X - 200, 696, 360, 26, SH(), { r: r(2), ang: 0, len: 40, sw: 10, alpha: 0.25, under: false, flat: true });
  if (!A()) drawDrip(pen, X + 150, 690, t, 81, 200), drawDrip(pen, X - 120, 690, t, 82, 200);
}
function drawStandFront(pen, t, wk) {
  const X = STAND_X, r = (k) => RG(78, k), alive = A();
  PAINT.rect(pen, X - 180, 790, 360, 105, (u, v) => L('#7a5233', 0.2 - v * 0.4), { r: r(1), ang: 0, len: 30, sw: 9, thick: 0.75 });
  PAINT.path(pen, [[X - 180, 792], [X + 180, 792]], 6, L('#c8925a', 0.5), { r: r(2), even: true, thick: 0.9 });
  const fruit = ['#e63946', '#ff9f1c', '#8ac926', '#ffca3a', '#c1121f', '#ff9f1c'];
  for (let c = 0; c < 6; c++) {
    PAINT.rect(pen, X - 172 + c * 58, 806, 54, 40, (u, v) => L('#a0703f', 0.3 - v * 0.5), { r: r(3 + c), len: 14, sw: 6, thick: 0.75 });
    for (let k = 0; k < 6; k++) {
      const fx = X - 160 + c * 58 + (k % 3) * 15, fy0 = 812 + Math.floor(k / 3) * 12, s = RG(79, c * 6 + k);
      const dist = Math.abs(fx - X), d = t - 4.5 - dist / 2200, v0 = (260 + s() * 160) * Math.max(0, 1 - dist / 230);
      let fx2 = fx, fy = fy0 - PHY.hop(d, v0, 2600, 0.35);
      const flyer = (c === 2 && k === 0) || (c === 3 && k === 2) || (c === 4 && k === 1); // три фрукта вылетают из ящиков и катятся по тротуару
      if (flyer && d > 0) { const dir = c < 3 ? -1 : 1, vx = dir * (120 + s() * 90); const tl = Math.min(d, 1.6); fx2 = fx + vx * (tl - 0.25 * tl * tl); const h = PHY.hop(d, 520, 2600, 0.42); const ground = Math.min(1, d / 0.35); fy = lerp(fy0, SIDE - 8, ground) - h; }
      PAINT.blob(pen, fx2, fy, 6.6, L(fruit[c], 0.35), { r: s, thick: 0.9 });
    }
  }
  PAINT.rect(pen, X - 150, 852, 300, 34, L('#1b1b1f', 0.1), { r: r(9), len: 20, sw: 7, thick: 0.6 });
  PAINT.text(pen, 'FRESH FRUIT', X, 877, '700 22px Unbounded', alive ? '#ffd23f' : '#8a8f96', { thick: 0.4 });
  if (alive) { const k = sat(wk); for (let i = 0; i < 7; i++) { const s = RG(80, i), sc = k; if (sc < 0.05) continue; PAINT.dab(pen, X - 160 + i * 52, 786 - sc * 4, 10 * sc, ['#ff4f8b', '#ffd23f', '#c77dff', '#ff7b39'][i % 4], { r: s, thick: 0.9 }); } }
  // продавец подбрасывает яблоко (живая)
  if (alive) { const v = findP('vendor'), vw = wOf(v, t); if (vw > 0.6) { const hd = personSkel(v, t, vw).handW[1], k = ((t * 0.72 + v.p.ph) % 1), hgt = Math.sin(k * Math.PI) * 110; PAINT.dab(pen, hd[0], hd[1] - 8 - Math.max(0, hgt), 12, L('#e63946', 0.4), { r: r(30), thick: 0.9 }); } }
}
function drawPot(pen, x, y, t, wk, seed) {
  const r = (k) => RG(seed, k), alive = A(), rock = PHY.kick(x, y, t, 4.5, 4.5, 140) * 0.35;
  tf(pen, () => {
    PAINT.poly(pen, [[-12, -18], [12, -18], [9, 0], [-9, 0]], (u, v) => L(alive ? '#c0643c' : '#7a6a5a', 0.4 - u * 0.8), { r: r(1), ang: 90, len: 10, sw: 5, thick: 0.85 });
    const k = alive ? sat(wk) : 0;
    for (let i = 0; i < 7; i++) { const s = RG(seed, 10 + i), a = (-90 + (i - 3) * 22 + (1 - k) * 60) * D2R, l = 16 + s() * 8; const tip = [Math.cos(a) * l, -18 + Math.sin(a) * l * (1 - (1 - k) * 0.3)]; PAINT.path(pen, [[0, -18], tip], 2.4, alive ? L('#3f9e4a', 0.2) : C('#6f6a55'), { r: s, even: true, nb: 0 }); if (alive) PAINT.dab(pen, tip[0], tip[1], 7 * (0.4 + 0.6 * k), L(['#ff4f6d', '#ffd23f', '#ffffff'][i % 3], 0.3), { r: s, thick: 0.85 }); }
  }, x, y, rock);
}
function drawTaxi(pen, t, wk) {
  const alive = A(), d = t - 2.5, sus = d > 0 ? 9 * Math.exp(-d * 3.6) * Math.cos(d * 2 * Math.PI * 2.1) * Math.min(1, d / 0.04) : 0;
  const tilt = d > 0 ? 0.012 * Math.exp(-d * 3.6) * Math.sin(d * 2 * Math.PI * 2.1) : 0;
  // водитель за стеклом
  const k = alive ? sat(wk) : 0, r = (q) => RG(90, q), hx = TAXI_X - 20, hy = 872 + sus;
  PAINT.dab(pen, hx, hy, 20, L('#8d5a3b', 0.2), { r: r(1), thick: 0.7 });
  PAINT.path(pen, [[hx - 10, hy - 6], [hx, hy - 12], [hx + 10, hy - 6]], 7, L('#1b1b1b', 0), { r: r(2), even: true });
  PAINT.path(pen, [[hx, hy + 10], [hx, hy + 30]], 18, L('#e9c46a', 0.1), { r: r(3), even: true });
  PAINT.put(pen, spr('taxi'), TAXI_X, 975 + sus, tilt);
  if (k > 0.1) { const wave = Math.sin(t * 10) * 20 * k, sh = [hx - 34, hy + 12], el = J(sh[0], sh[1], -100 + wave, 20 * k), hd = J(el[0], el[1], -150 + wave, 18 * k); PAINT.path(pen, [sh, el, hd], 7, L('#e9c46a', 0.3), { r: r(4), even: true }); PAINT.dab(pen, hd[0], hd[1], 7, L('#8d5a3b', 0.3), { r: r(5) }); }
  if (!alive) for (let i = 0; i < 4; i++) { const per = 1.2, ph = ((t + i * 0.3) % per) / per, x = TAXI_X - 222 - ph * 60 + PHY.wind(TAXI_X, t) * 30 * ph, y = 960 - ph * 30; PAINT.dab(SP(pen), x, y, 12 + ph * 26, '#c9cdd2', { r: RG(91, i), alpha: 0.35 * (1 - ph) }); }
  if (!alive) for (let i = 0; i < 6; i++) { const q = RG(92, Math.floor(t * 14) * 6 + i); PAINT.dab(SP(pen), TAXI_X - 80 + q() * 190, 842 + sus - 3, 3, '#e2e6ea', { r: q, alpha: 0.7 }); }
}
function taxiSprite(mode) {
  MODE = mode;
  return PAINT.sprite(460, 160, 230, 140, 1.5, (pen) => {
    const r = PAINT.rng(93), y0 = -975;
    const body = [[-210, 975], [-210, 925], [-205, 906], [-170, 900], [-120, 898], [-80, 852], [-60, 844], [90, 844], [112, 852], [150, 898], [196, 902], [214, 930], [214, 975]].map(([x, y]) => [x, y + y0]);
    PAINT.poly(pen, body, (u, v) => L('#ffc61a', 0.55 - v * 0.9 + (u - 0.5) * 0.2), { r, ang: 0, angJ: 6, len: 34, sw: 11, thick: 0.85, var: 0.08 });
    for (const win of [[[-70, 896], [-44, 858], [18, 858], [18, 896]], [[30, 896], [30, 858], [96, 858], [126, 896]]]) PAINT.poly(pen, win.map(([x, y]) => [x, y + y0]), (u, v) => A() ? PAINT.mix('#bfe2ff', '#2c3a52', v) : PAINT.mix('#9aa0a6', '#40454c', v), { r, ang: 60, len: 14, sw: 6, thick: 0.3, alpha: 0.55 });
    PAINT.rect(pen, -212, 938 + y0, 426, 14, L('#1b1b1b', 0), { r, ang: 0, len: 30, sw: 6 });
    for (let k = 0; k < 10; k++) PAINT.rect(pen, -196 + k * 40, 940 + y0, 20, 10, L('#ffc61a', 0.2), { r, len: 10, sw: 5 });
    PAINT.rect(pen, 10, 826 + y0, 66, 20, L('#fff3c4', 0.3), { r, len: 14, sw: 6, thick: 0.85 });
    PAINT.text(pen, 'TAXI', 43, 842 + y0, '800 15px Inter', C('#1b1b1b'), { thick: 0.3 });
    for (const wx of [-120, 128]) { PAINT.ellipse(pen, wx, 0, 34, 34, L('#1b1b1b', 0.1), { r, len: 14, sw: 6, thick: 0.8 }); PAINT.ellipse(pen, wx, 0, 15, 15, L('#b8bec6', 0.4), { r, len: 8, sw: 4, thick: 0.9 }); }
    PAINT.path(pen, [[-200, 905], [200, 905]].map(([x, y]) => [x, y + y0]), 3, L('#fff4b0', 0.8), { r, even: true, thick: 0.6, alpha: 0.8 });
    PAINT.dab(pen, 204, 925 + y0, 12, A() ? '#fff6c2' : '#b9b9b0', { r, thick: 0.9 });
  });
}
function drawMailbox(pen, t) {
  const d = t - 6.5, rock = d > 0 ? 0.07 * Math.exp(-d * 3.2) * Math.sin(d * 2 * Math.PI * 2.4) : 0;
  PAINT.put(pen, spr('mail'), MAIL_X, SIDE, rock);
  // письма: вылетают из щели и планируют вниз, качаясь, как падающий лист
  for (let i = 0; i < 4; i++) {
    const s = RG(95, i), td = d - i * 0.05; if (td <= 0) continue;
    const vx = (s() - 0.4) * 260, vy = -(220 + s() * 160), tUp = -vy / 1500;
    let x, y, rot;
    if (td < tUp) { x = MAIL_X + vx * td; y = 812 + vy * td + 750 * td * td; rot = td * 8; }
    else { const e = td - tUp, x0 = MAIL_X + vx * tUp, y0 = 812 + vy * tUp + 750 * tUp * tUp; x = x0 + vx * 0.3 * e + Math.sin(e * 5 + i) * 26; y = Math.min(SIDE - 3, y0 + 70 * e); rot = Math.sin(e * 5 + i) * 0.8 * (y < SIDE - 3 ? 1 : 0.1); }
    tf(pen, () => { PAINT.rect(pen, -11, -7, 22, 14, A() ? '#fbf6ea' : '#c9ccce', { r: s, len: 10, sw: 5, thick: 0.6 }); PAINT.path(pen, [[-10, -6], [0, 1], [10, -6]], 1.2, '#9a8f80', { r: s, even: true, nb: 0 }); if (A()) PAINT.dab(pen, 7, -3, 4, '#e63946', { r: s }); }, x, y, rot);
  }
}
function mailSprite(mode) {
  MODE = mode;
  return PAINT.sprite(100, 120, 50, 110, 1.6, (pen) => {
    const r = PAINT.rng(96);
    PAINT.poly(pen, [[-34, -95], [-34, -18], [34, -18], [34, -95], [26, -104], [0, -108], [-26, -104]], (u, v) => L('#2b59c3', 0.45 - u * 0.9 - v * 0.2), { r, ang: 90, len: 18, sw: 7, thick: 0.85 });
    PAINT.rect(pen, -20, -84, 40, 5, L('#173a8a', -0.2), { r, len: 10, sw: 3 });
    PAINT.text(pen, 'MAIL', 0, -48, '800 12px Inter', C('#ffffff'), { thick: 0.3 });
    for (const lx of [-25, 25]) PAINT.rect(pen, lx - 5, -18, 10, 18, L('#173a8a', 0), { r, len: 8, sw: 4 });
  });
}
function drawBin(pen, x, t) {
  const alive = A(), d = t - 3.5 - Math.abs(x - 2060) / 2200, r = (k) => RG(97, k);
  PAINT.put(pen, spr('bin'), x, SIDE);
  // крышка: подлетает и кувыркается, падает обратно со звоном
  const h = PHY.hop(d, 520, 2600, 0.38), rot = d > 0 && h > 0.5 ? Math.sin(d * 18) * 0.35 * Math.exp(-d * 2) : 0;
  if (!alive) for (let i = 0; i < 6; i++) PAINT.dab(pen, x - 22 + i * 9, SIDE - 76 - (i % 3) * 5 - h * 0.15, 9, ['#e9e4d6', '#3b3e44', '#c9a26a', '#8a9096'][i % 4], { r: r(i), thick: 0.7 }); // мусор торчит
  tf(pen, () => { PAINT.ellipse(pen, 0, 0, 33, 7, (u, v) => L('#5f6f5f', 0.5 - v), { r: r(20), len: 12, sw: 4, thick: 0.85 }); PAINT.dab(pen, 0, -7, 8, L('#3f4f3f', 0.3), { r: r(21) }); }, x + (alive ? 0 : 6), SIDE - 74 - h - (alive ? 0 : 6), rot + (alive ? 0 : 0.25));
  // банка выкатывается (унылая)
  if (!alive && d > 0.2) { // банка выпадает, отскакивает и катится, замедляясь (трение)
    const e = d - 0.2, te = Math.min(e, 1.43), xx = x - 10 - 170 * (te - 0.35 * te * te), yy = Math.min(SIDE - 6, SIDE - 70 + 900 * e * e) - PHY.hop(e - 0.28, 160, 2600, 0.3);
    tf(pen, () => { PAINT.rect(pen, -9, -5, 18, 10, '#b8bec4', { r: r(30), len: 8, sw: 4, thick: 0.8 }); PAINT.path(pen, [[-3, -5], [-3, 5]], 2, '#c0392b', { r: r(31), even: true, nb: 0 }); }, xx, yy, -(xx - x + 10) / 9);
  }
}
function binSprite(mode) {
  MODE = mode;
  return PAINT.sprite(90, 90, 45, 82, 1.6, (pen) => {
    const r = PAINT.rng(98);
    PAINT.poly(pen, [[-30, -72], [30, -72], [25, 0], [-25, 0]], (u, v) => L('#4f5f4f', 0.45 - u * 0.9), { r, ang: 90, len: 16, sw: 6, thick: 0.8 });
    for (let k = -22; k <= 22; k += 9) PAINT.path(pen, [[k, -70], [k * 0.85, -2]], 1.5, L('#2a332a', 0), { r, even: true, nb: 0 });
    PAINT.path(pen, [[-30, -66], [30, -66]], 3, L('#7a8a7a', 0.5), { r, even: true });
  });
}
function drawPaper(pen, a, t, wk) {
  const alive = A(), r = RG(99, 1);
  const xs = (tt) => 2560 - 120 * tt - 30 * Math.sin(tt * 1.1), ys = (tt) => SIDE - 4 - Math.abs(Math.sin(tt * 2.6)) * 26 * (0.5 + 0.5 * Math.sin(tt * 0.7));
  if (!alive || t < a.tp) { // газету тащит ветер: подлетает, переворачивается
    const x = xs(t), y = ys(t), rot = Math.sin(t * 2.6) * 0.9;
    if (alive) return;
    tf(pen, () => { PAINT.rect(pen, -16, -11, 32, 22, '#d8d6cf', { r, ang: 0, len: 12, sw: 5, thick: 0.5 }); for (let i = 0; i < 4; i++) PAINT.path(pen, [[-12, -6 + i * 4], [12, -6 + i * 4]], 1.2, '#8a8d90', { r, even: true, nb: 0 }); }, x, y, rot, 1, 0.6 + 0.4 * Math.cos(t * 2.6));
    return;
  }
  const e = t - a.tp, x0 = xs(a.tp), y0 = ys(a.tp), fold = sat(e / 0.4);
  const x = x0 - 230 * e - 40 * e * e, y = y0 - 90 * e - 30 * Math.sin(e * 2.4) * e, ang = -0.35 + Math.sin(e * 2.4) * 0.2;
  tf(pen, () => {
    const wing = lerp(11, 4, fold), len = lerp(32, 40, fold);
    PAINT.poly(pen, [[-len / 2, 0], [len / 2, -wing], [len / 2, wing]], (u, v) => L('#ffffff', 0.4 - v * 0.6), { r, ang: 0, len: 10, sw: 4, thick: 0.6 });
    PAINT.path(pen, [[-len / 2, 0], [len / 2, 0]], 1.3, '#b8b2a5', { r, even: true, nb: 0 });
  }, x, y, ang, -1, 1);
}
function drawSteam(pen, x, y, t, seed) { // пар: клубы рождаются, поднимаются, расширяются и тают; ветер сносит
  const alive = A();
  for (let i = 0; i < 9; i++) {
    const s = RG(seed, i), per = 2.4, ph = ((t / per) + i / 9) % 1, d = ph * per;
    const px = x + (s() - 0.5) * 30 + PHY.wind(x, t) * 60 * d + Math.sin(d * 2 + i) * 10, py = y - d * 110;
    PAINT.dab(SP(pen), px, py, 18 + d * 34, alive ? '#fff8ec' : '#d5d9dd', { r: s, alpha: (alive ? 0.22 : 0.32) * sat(ph * 5) * (1 - ph), ang: 0, elong: 1.2 });
  }
}
function drawSmoke(pen, x, y, t, seed) {
  for (let i = 0; i < 8; i++) { const s = RG(seed, i), per = 3.2, ph = ((t / per) + i / 8) % 1, d = ph * per; PAINT.dab(SP(pen), x + PHY.wind(x, t) * 90 * d - 20 * d, y - 10 - d * 60, 14 + d * 26, '#8e9398', { r: s, alpha: 0.4 * (1 - ph) * sat(ph * 6), ang: 0, elong: 1.3 }); }
}
function drawHydrant(pen, x, t, wk, seed) {
  if (!A()) { drawDrip(pen, x + 14, SIDE - 30, t, seed, 30); return; }
  const k = sat(wk); if (k < 0.05) return;
  // струя: частицы по параболе из бокового патрубка, падают на дорогу и разлетаются брызгами
  const nx = x + 20, ny = SIDE - 30, vx = 300, vy = -260 * k, g = 900;
  for (let i = 0; i < 40; i++) {
    const s = RG(seed, i), per = 0.9, ph = ((t / per) + i / 40) % 1, d = ph * per * (0.9 + s() * 0.2);
    const px = nx + vx * d * (0.85 + s() * 0.3), py = ny + vy * d + 0.5 * g * d * d;
    if (py > 1000) continue;
    PAINT.dab(SP(pen), px, py, 4 + s() * 4, s() < 0.3 ? '#ffffff' : '#bfe3ff', { r: s, alpha: 0.75, ang: Math.atan2(vy + g * d, vx) / D2R, elong: 2 });
  }
  for (let i = 0; i < 10; i++) { const s = RG(seed, 60 + i), per = 0.5, ph = ((t / per) + i / 10) % 1; const tl = (-vy + Math.sqrt(vy * vy + 2 * g * (990 - ny))) / g, lx = nx + vx * tl; PAINT.dab(SP(pen), lx + (s() - 0.5) * 50 + ph * (s() - 0.5) * 80, 990 - ph * 30 * Math.sin(ph * Math.PI) * 2, 3 + s() * 3, '#e6f5ff', { r: s, alpha: 0.7 * (1 - ph) }); }
}
function drawPole(pen, x, y, t, wk) {
  const alive = A(), off = alive ? (t - 0) * 46 * sat(wk) : 0, r = RG(101, 1);
  pen.cx.save(); pen.cx.beginPath(); pen.cx.rect(x - 7, y, 14, 100); pen.cx.clip();
  for (let k = -3; k < 9; k++) { const yy = y + k * 16 - (off % 32) + 32; PAINT.path(pen, [[x - 9, yy + 10], [x + 9, yy - 4]], 6, alive ? (k % 2 ? '#d62828' : '#2b59c3') : C(k % 2 ? '#d62828' : '#2b59c3'), { r, even: true, nb: 0, thick: 0.6 }); }
  pen.cx.restore();
  PAINT.dab(pen, x, y - 4, 10, L('#e9e9e9', 0.4), { r }); PAINT.dab(pen, x, y + 104, 10, L('#e9e9e9', 0.2), { r });
}
function drawCase(pen, x, t, wk) {
  const alive = A(), k = alive ? sat(wk) : 0, r = (q) => RG(103, q);
  PAINT.poly(pen, [[x - 44, SIDE - 2], [x + 44, SIDE - 2], [x + 40, SIDE - 16], [x - 40, SIDE - 16]], L('#3a2a22', 0.2), { r: r(1), len: 16, sw: 6, thick: 0.8 });
  if (k > 0.05) {
    PAINT.poly(pen, [[x - 40, SIDE - 16], [x + 40, SIDE - 16], [x + 40, SIDE - 16 - 30 * k], [x - 40, SIDE - 16 - 30 * k]], L('#6b1f2a', 0.1), { r: r(2), len: 14, sw: 6, thick: 0.6 });
    for (let i = 0; i < 9; i++) { const s = RG(103, 10 + i), cx0 = x - 32 + i * 8, d = t - 8.5 - Math.abs(cx0 - 4660) / 2200; PAINT.dab(pen, cx0, SIDE - 18 - PHY.hop(d, 180 + s() * 120, 2600, 0.35), 6, L(i % 3 ? '#ffd23f' : '#d9d9d9', 0.5), { r: s, thick: 0.9 }); }
  }
}
function drawBalloon(pen, a, t, wk) {
  const kid = findP('kid'), k = sat(wk), [hx, hy] = personSkel(kid, t, wOf(kid, t)).handW[0], len = 120 * k;
  if (k < 0.05) return;
  const sw = (PHY.wind(hx, t) * 14 + Math.sin(t * 1.7) * 6 + PHY.kick(hx, hy, t, 1.5, 2, 400) * 25) * D2R;
  const bx = hx + Math.sin(sw) * len, by = hy - Math.cos(sw) * len;
  PAINT.path(pen, [[hx, hy], [(hx + bx) / 2 + Math.sin(t * 3) * 6, (hy + by) / 2], [bx, by]], 1.4, '#555', { r: RG(104, 1), even: true, nb: 0 });
  PAINT.ellipse(pen, bx, by - 26 * k, 24 * k, 29 * k, (u, v) => L('#ff3d5a', 0.5 - u * 0.6 - v * 0.4), { r: RG(104, 2), len: 14, sw: 7, thick: 0.9 });
  PAINT.dab(pen, bx - 8 * k, by - 38 * k, 7 * k, '#ffd0d8', { r: RG(104, 3), thick: 1 });
}
function drawHearts(pen, x, y, t, wk, seed) {
  if (wk < 0.3) return;
  for (let i = 0; i < 4; i++) { const ph = ((t * 0.45 + i / 4) % 1), hx = x + Math.sin(ph * 8 + i) * 22 + (i - 1.5) * 18, hy = y - ph * 150, s = (0.6 + ph * 0.6) * sat(wk), r = RG(seed, i);
    tf(pen, () => PAINT.poly(pen, [[0, 6], [-10, -3], [-8, -10], [-2, -9], [0, -5], [2, -9], [8, -10], [10, -3]], L('#ff4f8b', 0.3), { r, len: 8, sw: 4, thick: 0.9, alpha: 1 - ph }), hx, hy, 0, s * 1.4, s * 1.4); }
}
function drawNotes(pen, x, y, t, wk, seed) {
  if (wk < 0.3) return;
  for (let i = 0; i < 6; i++) { const ph = ((t * 0.55 + i / 6) % 1), nx = x + Math.sin(ph * 6 + i) * 30 + ph * 60, ny = y - ph * 200, r = RG(seed, i), c = ['#ff4f8b', '#3a86ff', '#ffd23f', '#06d6a0'][i % 4], a = 1 - ph;
    PAINT.dab(pen, nx, ny, 11, c, { r, ang: -20, alpha: a, thick: 0.9 }); PAINT.path(pen, [[nx + 5, ny - 2], [nx + 5, ny - 26]], 2.5, c, { r, even: true, nb: 0, alpha: a }); if (i % 2) PAINT.path(pen, [[nx + 5, ny - 26], [nx + 16, ny - 22]], 2.5, c, { r, even: true, nb: 0, alpha: a }); }
}
function drawButterfly(pen, x, y, t, wk, seed) {
  if (wk < 0.2) return;
  const r = RG(seed, 1), px = x + Math.sin(t * 0.9 + seed) * 70 + Math.sin(t * 2.3) * 20, py = y + Math.sin(t * 1.3 + seed) * 30 - Math.abs(Math.sin(t * 7)) * 8, f = Math.abs(Math.sin(t * 16 + seed)), c = ['#ffb703', '#ff4f8b', '#8ecae6', '#ffffff'][seed % 4];
  for (const s of [-1, 1]) PAINT.dab(pen, px + s * 6 * f, py - 2, 10 * sat(wk), L(c, 0.3), { r, ang: 90 + s * 30, elong: 1.2 + f * 0.3, thick: 0.8 });
  PAINT.path(pen, [[px, py - 5], [px, py + 5]], 2, '#222', { r, even: true, nb: 0 });
}
function drawRipples(pen, px, py, pw, t, seed) { // капли бьют по луже: круги расходятся
  const g = pen.cx; g.save(); g.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) { const s = RG(seed, i), per = 0.6 + s() * 0.4, ph = ((t / per) + s()) % 1, cell = Math.floor(t / per + s()), q = RG(seed, cell * 13 + i); const cx0 = px + (q() - 0.5) * pw * 1.5, rr = 3 + ph * 22; g.strokeStyle = `rgba(220,226,232,${(0.55 * (1 - ph)).toFixed(3)})`; g.beginPath(); g.ellipse(cx0, py + (q() - 0.5) * pw * 0.12, rr, rr * 0.22, 0, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
function drawRainSplashes(pen, x0, x1, t, seed) {
  const cell = Math.floor(t * 16), g = pen.cx; g.save(); g.strokeStyle = 'rgba(225,230,235,0.6)'; g.lineWidth = 1.3;
  for (let k = 0; k < 2; k++) { const q = RG(seed, (cell - k) * 7 + 1), age = (t * 16 - (cell - k)) / 2; for (let i = 0; i < 4; i++) { const x = x0 + q() * (x1 - x0), y = BASE + 10 + q() * (ROAD - BASE - 10) + (q() < 0.4 ? 60 + q() * 120 : 0); g.globalAlpha = 1 - age; g.beginPath(); g.moveTo(x - 4, y - 2 - age * 6); g.lineTo(x - 1, y); g.moveTo(x + 4, y - 2 - age * 6); g.lineTo(x + 1, y); g.moveTo(x, y - 4 - age * 8); g.lineTo(x, y); g.stroke(); } }
  g.restore();
}
const SPLAT_COLORS = ['#ff4f8b', '#ffd23f', '#3a86ff', '#06d6a0', '#ff7b39', '#c77dff'];
function drawSplat(pen, b, t, seed) { // клякса краски на поверхности после касания — шарик «красит» город
  const d = t - b[2]; if (d <= 0) return;
  const k = sat(d / 0.08), r = RG(seed, 1), x = b[0], y = b[1] + (b[1] === 640 ? awningDent(x, t) : 0) + 1;
  const c1 = SPLAT_COLORS[seed % 6], c2 = SPLAT_COLORS[(seed + 2) % 6];
  PAINT.blob(pen, x, y, 22 * k, c1, { r, sy: 0.2, thick: 0.9 });
  PAINT.blob(pen, x + 6, y - 1, 11 * k, c2, { r, sy: 0.25, thick: 0.95 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + r(), rr = (26 + r() * 22) * k; PAINT.blob(pen, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.18, (2 + r() * 3) * k, i % 2 ? c1 : c2, { r, sy: 0.5, thick: 0.9 }); }
}
function drawSplash(pen, b, t, seed) {
  const d = t - b[2]; if (d < 0 || d > 0.9) return;
  const alive = A(), r = RG(seed, 2), g = pen.cx;
  g.save(); g.strokeStyle = alive ? `rgba(255,243,196,${(1 - d / 0.9).toFixed(3)})` : `rgba(220,226,232,${(0.8 * (1 - d / 0.9)).toFixed(3)})`; g.lineWidth = 3.5 * (1 - d / 0.9); if (d < 0.45) { g.globalAlpha = 1 - d / 0.45; g.beginPath(); g.ellipse(b[0], b[1], 26 + d * 220, 6 + d * 40, 0, 0, Math.PI * 2); g.stroke(); } g.restore();
  for (let i = 0; i < 16; i++) { const a = Math.PI + r() * Math.PI, v = 260 + r() * 420, c = alive ? SPLAT_COLORS[i % 6] : '#d9dde2', rad = (4 + r() * 6) * (1 - d / 0.8); if (d > 0.75 || rad <= 0.5) continue;
    PAINT.blob(pen, b[0] + Math.cos(a) * v * d, b[1] + Math.sin(a) * v * d + 1600 * d * d, rad * 0.7, c, { r, thick: 0.9, alpha: alive ? 1 : 0.8 }); }
}

// ---------- небо ----------
function initSky() {}
// эффекты в экранных координатах (для каждой версии): дождь — в унылой, солнечный свет и птицы — в живой
function drawScreenFX(pen, t, cam) {
  const g = pen.cx;
  if (A()) {
    PAINT.glow(g, 1650 - (cam.cx - 622) * 0.025, 210, 700, '#ffe6a8', 0.22, 'screen');
    for (let k = 0; k < 6; k++) { // птицы
      const r = RG(2600, k), bx = ((k * 360 + t * (80 + k * 14) - cam.cx * 0.08) % (W + 400) + W + 400) % (W + 400) - 200, by = 90 + k * 38 + Math.sin(t * 2 + k) * 14, s = 0.8 + (k % 3) * 0.25, fl = Math.sin(t * 10 + k) * 6;
      PAINT.path(pen, [[bx - 14 * s, by - fl], [bx - 6 * s, by - 6 * s], [bx, by], [bx + 6 * s, by - 6 * s], [bx + 14 * s, by - fl]], 2.6, '#2b2b35', { r, even: true, nb: 0, thick: 0.4 });
    }
  } else {
    const r = RG(2700, 1); g.save(); g.lineCap = 'round';
    for (let k = 0; k < 230; k++) { const x0 = r() * (W + 400), y0 = r() * (H + 200), sp = 1300 + r() * 600, y = ((y0 + t * sp) % (H + 200)) - 100, x = x0 - y * 0.22 - 100, a = 0.18 + r() * 0.25; g.strokeStyle = `rgba(222,226,232,${a.toFixed(3)})`; g.lineWidth = 1.2 + r() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 36); g.stroke(); }
    g.restore();
    g.fillStyle = 'rgba(70,78,90,0.10)'; g.fillRect(0, 0, W, H); // сырая дымка
  }
}

// ---------- спрайты ----------
function initSprites() {
  for (const mode of ['alive', 'dull']) {
    SPR[mode].canopy0 = canopySprite(11, mode); SPR[mode].canopy1 = canopySprite(12, mode); SPR[mode].canopy2 = canopySprite(13, mode);
    SPR[mode].taxi = taxiSprite(mode); SPR[mode].mail = mailSprite(mode); SPR[mode].bin = binSprite(mode);
  }
  MODE = 'alive';
}

// ---------- нить, шарик, искры (поверх обеих версий) ----------
const sparks = (() => { const r = PAINT.rng(5), out = []; for (let ts = 0.05; ts < EXIT_T; ts += 0.05) out.push({ ts, a: r() * 6.283, sp: 60 + r() * 160, c: SPLAT_COLORS[Math.floor(r() * 6)], s: 3 + r() * 5, life: 0.5 + r() * 0.4 }); return out; })();
let TITLE = null;
function ballScreen(t, cam) {
  if (t < EXIT_T + 0.05) { const bw = ballWorld(t), s = toScreen(bw.x, bw.y, cam); return { x: s.x, y: s.y, k: cam.z, bw, vis: true }; }
  const sl = TITLE.slot, p = sat((t - DROP_T0) / (LAND_T - DROP_T0));
  let y = -120 + (sl.y + 120) * p * p, k = 0.9 + (sl.k - 0.9) * p;
  if (t > LAND_T) { const d = t - LAND_T; y = sl.y - Math.abs(Math.sin(d * 9)) * 60 * Math.exp(-d * 5); k = sl.k; }
  return { x: sl.x, y, k, bw: { vx: 0, vy: t < LAND_T ? 2000 : 0, x: 5400 }, vis: t >= DROP_T0 };
}
function drawFX(pen, t, cam, th) {
  const g = pen.cx, hgx = pen.hx;
  // искры-капли краски за шариком
  for (const p of sparks) {
    const d = t - p.ts; if (d < 0 || d > p.life) continue;
    const o = ballWorld(p.ts), c = toScreen(o.x + Math.cos(p.a) * (R * 0.6 + p.sp * d) - o.vx * 0.04 * d, o.y + Math.sin(p.a) * (R * 0.6 + p.sp * d) + 500 * d * d, cam);
    const a = 1 - d / p.life; PAINT.dab(pen, c.x, c.y, p.s * a * cam.z, p.c, { r: RG(p.ts * 1000, 1), thick: 0.9, alpha: Math.min(1, a * 1.5) });
  }
  // нить: тёплое свечение + натянутая блестящая струна (рельефная)
  if (th) {
    const pts = th.pts.map((p) => [p.x, p.y]);
    g.save(); g.globalCompositeOperation = 'screen'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [lw, a] of [[46, 0.06], [22, 0.12], [10, 0.3]]) { g.strokeStyle = `rgba(255,200,110,${a})`; g.lineWidth = lw; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
    g.restore();
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#fff6d8'; g.lineWidth = 3.4; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
    hgx.save(); hgx.lineCap = 'round'; hgx.strokeStyle = 'rgb(205,205,205)'; hgx.lineWidth = 3.4; hgx.beginPath(); pts.forEach((p, i) => (i ? hgx.lineTo(p[0], p[1]) : hgx.moveTo(p[0], p[1]))); hgx.stroke(); hgx.restore();
    for (const pin of [th.Atop, th.Abot]) PAINT.dab(pen, pin.x, Math.max(6, Math.min(H - 6, pin.y)), 16, '#fff6d8', { r: RG(7, 1), thick: 1 });
  }
  // шарик
  const b = ballScreen(t, cam); if (!b.vis) return;
  if (t < EXIT_T) { const gr = toScreen(b.bw.x, b.bw.surf, cam), hgt = Math.max(0, b.bw.surf - R - b.bw.y); g.save(); g.fillStyle = `rgba(20,16,30,${(0.3 * (1 - Math.min(0.8, hgt / 600))).toFixed(3)})`; g.beginPath(); g.ellipse(gr.x, gr.y, R * 1.1 * b.k * (1 - Math.min(0.6, hgt / 700)), 7 * b.k, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  const contacts = BOUNCES.map((q) => q[2]).concat([LAND_T]);
  const near = contacts.reduce((m, ct) => (Math.abs(t - ct) < Math.abs(m) ? t - ct : m), 99);
  let sqx = 1, sqy = 1, rot = 0;
  if (Math.abs(near) < 0.07) { const q = 1 - Math.abs(near) / 0.07; sqy = 1 - 0.34 * q; sqx = 1 + 0.3 * q; }
  else { const sp = Math.hypot(b.bw.vx, b.bw.vy), st = Math.min(0.22, sp / 9000); sqx = 1 + st; sqy = 1 - st * 0.6; rot = Math.atan2(b.bw.vy, b.bw.vx); }
  const spin = (t < EXIT_T ? ballWorld(t).x : 5400) / R;
  PAINT.glow(g, b.x, b.y, R * 2.8 * b.k, '#ffd27a', 0.55, 'screen');
  for (const ctx of [g, hgx]) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(rot); ctx.scale(sqx * b.k, sqy * b.k); ctx.rotate(-rot); }
  // рельеф: купол густой краски
  const hg = hgx.createRadialGradient(-8, -10, 2, 0, 0, R); hg.addColorStop(0, 'rgb(225,225,225)'); hg.addColorStop(1, 'rgb(150,150,150)'); hgx.fillStyle = hg; hgx.beginPath(); hgx.arc(0, 0, R, 0, Math.PI * 2); hgx.fill();
  g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
  g.rotate(spin);
  SPLAT_COLORS.forEach((c, i) => { const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2; g.fillStyle = c; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R + 2, a0, a1); g.closePath(); g.fill(); });
  const rr = RG(8, 1); for (let i = 0; i < 18; i++) { const a = rr() * Math.PI * 2; PAINT.stroke({ cx: g, hx: null }, Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2, (a * 180) / Math.PI + 20, R * 0.8, 6, PAINT.mix(SPLAT_COLORS[Math.floor((((a / (Math.PI * 2)) % 1) + 1) % 1 * 6)], '#ffffff', 0.15), { r: rr, alpha: 0.6, nb: 2 }); }
  g.fillStyle = '#fffbea'; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
  g.rotate(-spin);
  const sh = g.createRadialGradient(-10, -12, 4, 0, 0, R); sh.addColorStop(0, 'rgba(255,255,255,0.25)'); sh.addColorStop(0.6, 'rgba(0,0,0,0.0)'); sh.addColorStop(1, 'rgba(30,10,40,0.38)'); g.fillStyle = sh; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.restore();
  PAINT.dab({ cx: g, hx: hgx }, -11, -13, 10, '#ffffff', { r: RG(8, 2), ang: -30, alpha: 0.8, thick: 1 });
  for (const ctx of [g, hgx]) ctx.restore();
}

// ---------- заголовок: буквы густой краской ----------
function initTitle(P) {
  const fs = 172, font = `800 ${fs}px Unbounded`, g = FR.cx;
  g.save(); g.font = font; const letters = [...P.title];
  const sp = -0.02 * fs, slotW = 0.78 * fs;
  const widths = letters.map((ch, i) => (i === P.ballLetter ? slotW : g.measureText(ch).width));
  g.restore();
  const total = widths.reduce((s, w) => s + w, 0) + sp * (letters.length - 1);
  let x = W / 2 - total / 2; const base = 40 + fs * 0.86, cap = fs * 0.72;
  const items = [];
  letters.forEach((ch, i) => {
    const w = widths[i];
    if (i === P.ballLetter) { items.push({ slot: true, x: x + w / 2, y: base - cap / 2 }); x += w + sp; return; }
    const pad = 40, sprite = PAINT.sprite(w + pad * 2, fs * 1.2 + pad, w / 2 + pad, fs * 0.95 + pad / 2, 1, (pen) => {
      const r = PAINT.rng(400 + i);
      for (const [off, col] of [[18, '#5b3cc4'], [9, '#ff4f8b']]) PAINT.text(pen, ch, off, off, font, col, { thick: 0.25 });
      PAINT.text(pen, ch, 0, 0, font, '#fffaf0', { thick: 0.5 });
      // мазки внутри буквы (обрезка по уже нарисованной букве)
      const tmp = PAINT.surface(w + pad * 2, fs * 1.2 + pad); tmp.cx.setTransform(1, 0, 0, 1, w / 2 + pad, fs * 0.95 + pad / 2); tmp.cx.font = font; tmp.cx.textAlign = 'center'; tmp.cx.fillStyle = '#fff'; tmp.cx.fillText(ch, 0, 0);
      tmp.cx.globalCompositeOperation = 'source-atop';
      for (let k = 0; k < 110; k++) PAINT.stroke({ cx: tmp.cx, hx: null }, (r() - 0.5) * w, -r() * cap * 1.05, -10 + (r() - 0.5) * 30, 34, 12, PAINT.mix('#fffaf0', r() < 0.5 ? '#ffe2b8' : '#ece4ff', 0.08 + r() * 0.16), { r, nb: 3, var: 0.02 });
      pen.cx.save(); pen.cx.setTransform(1, 0, 0, 1, 0, 0); pen.cx.drawImage(tmp.c, 0, 0); pen.cx.restore();
    });
    items.push({ ch, x: x + w / 2, y: base, sprite, i });
    x += w + sp;
  });
  const slotItem = items.find((it) => it.slot);
  TITLE = { items, slot: { x: slotItem.x, y: slotItem.y, k: slotW / 2 / R }, fs };
  // подзаголовок: тёмная полоса-мазок и кремовый текст
  const sfont = '600 40px Manrope'; g.save(); g.font = sfont; const tw = g.measureText(P.sub).width; g.restore();
  TITLE.sub = PAINT.sprite(tw + 220, 150, tw / 2 + 110, 75, 1, (pen) => {
    const r = PAINT.rng(450);
    PAINT.rect(pen, -tw / 2 - 34, -30, tw + 68, 58, (u, v) => PAINT.mix('#2a1f4a', '#45285a', u * 0.6 + v * 0.3), { r, ang: 0, angJ: 3, len: 90, sw: 16, var: 0.06, thick: 0.5, clip: false, under: false, dens: 1.5 });
    PAINT.text(pen, P.sub, 0, 15, sfont, '#fffaf0', { thick: 0.35 });
  });
  TITLE.subY = base + 66;
}
function drawTitle(pen, t) {
  if (!TITLE || t < 9.4) return;
  const mid = (TITLE.items.length - 1) / 2;
  const order = TITLE.items.map((it, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  order.forEach((idx, k) => {
    const it = TITLE.items[idx]; if (it.slot) return;
    const p = MG.ease.land(sat((t - 9.55 - k * 0.05) / 0.6)); if (p <= 0) return;
    const sc = lerp(1.8, 1, p), y = it.y + lerp(-0.6 * TITLE.fs, 0, p);
    const wob = t > 10 ? Math.sin((t - 10) * 3 + idx) * 0.012 : 0;
    PAINT.put(pen, it.sprite, it.x, y, wob, sc, sc, sat(p * 1.4));
  });
  const ps = MG.ease.land(sat((t - 10.35) / 0.7));
  if (ps > 0) PAINT.put(pen, TITLE.sub, W / 2, TITLE.subY + lerp(30, 0, ps), 0, 1, 1, ps);
}
