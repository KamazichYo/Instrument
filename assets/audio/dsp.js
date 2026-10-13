// Обработка голоса: чистый JS без зависимостей.
// Работает и в Web Worker (браузер), и в Node (тесты).
//
// Цепочка: моно → срез низов (HPF) → шумодав (спектральный, Wiener + decision-directed)
//          → поиск пауз → EQ голоса → де-эссер → компрессор → вырезание пауз
//          → нормализация громкости (LUFS, BS.1770) → лимитер.

// ---------- утилиты ----------

const LOG10 = Math.log(10);
const dbToGain = (db) => Math.pow(10, db / 20);
const powToDb = (p) => (10 * Math.log(p + 1e-20)) / LOG10;

function percentile(values, q) {
  if (values.length === 0) return -120;
  const a = Float64Array.from(values).sort();
  const i = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))));
  return a[i];
}

export function toMono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = channels[0].length;
  const out = new Float32Array(n);
  const k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}

// ---------- biquad (RBJ cookbook) ----------

export function biquad(type, f0, sr, q = Math.SQRT1_2, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, sr * 0.49)) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
    default:
      throw new Error('unknown filter ' + type);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Фильтрует на месте (Transposed Direct Form II), если out не задан.
export function applyBiquad(x, c, out = x) {
  let z1 = 0, z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    out[i] = y;
  }
  return out;
}

// HPF 4-го порядка Баттерворта (24 дБ/окт) — убирает гул, удары по корпусу, ветер.
export function highpass24(x, f, sr) {
  applyBiquad(x, biquad('highpass', f, sr, 0.5412));
  applyBiquad(x, biquad('highpass', f, sr, 1.3066));
  return x;
}

// ---------- FFT (radix-2, на месте) ----------

function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sign * sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  return transform;
}

// ---------- шумодав ----------
// strength 0..1. Профиль шума берётся из самых тихих кусков записи
// (паузы между фразами), поэтому отдельно «снимать шум» не нужно.

export function denoise(x, sr, strength, onProgress) {
  const len = x.length;
  const N = sr > 32000 ? 2048 : 1024;
  const hop = N / 4;
  const bins = N / 2 + 1;
  const fft = makeFFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

  const firstStart = -N + hop;
  const frames = Math.ceil((len - firstStart) / hop);
  const startOf = (f) => firstStart + f * hop;

  // 1) энергия кадров → выбираем самые тихие (не «цифровой ноль»)
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const s = startOf(f);
    let e = 0;
    for (let i = 0; i < N; i++) {
      const j = s + i;
      if (j >= 0 && j < len) { const v = x[j] * win[i]; e += v * v; }
    }
    energy[f] = e;
  }
  const live = [];
  for (let f = 0; f < frames; f++) if (energy[f] > 1e-12) live.push(energy[f]);
  if (live.length < 4) return { out: Float32Array.from(x), noiseDb: -120 };
  const quietLimit = percentile(live, 0.12);

  // 2) средний спектр шума по тихим кадрам
  const noise = new Float64Array(bins);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let count = 0;
  for (let f = 0; f < frames; f++) {
    if (energy[f] > quietLimit || energy[f] <= 1e-12) continue;
    const s = startOf(f);
    for (let i = 0; i < N; i++) {
      const j = s + i;
      re[i] = j >= 0 && j < len ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < bins; k++) noise[k] += re[k] * re[k] + im[k] * im[k];
    count++;
  }
  for (let k = 0; k < bins; k++) noise[k] = noise[k] / Math.max(1, count) + 1e-14;
  // лёгкое сглаживание профиля по частоте
  const ns = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const a = noise[Math.max(0, k - 1)], b = noise[k], c = noise[Math.min(bins - 1, k + 1)];
    ns[k] = (a + 2 * b + c) / 4;
  }
  let noiseSum = 0;
  for (let k = 0; k < bins; k++) noiseSum += ns[k];
  // уровень шума в дБFS (приблизительно; сумма окна sqrt-hann^2 = N/2)
  const noiseDb = powToDb((2 * noiseSum) / (N * (N / 2)));

  if (strength <= 0) return { out: Float32Array.from(x), noiseDb };

  // 3) подавление: Wiener-фильтр с decision-directed оценкой SNR (меньше «музыкального шума»)
  const over = 1 + 1.5 * strength; // пересубтракция
  const minGain = dbToGain(-(6 + 18 * strength)); // макс. подавление 6..24 дБ
  const alphaDD = 0.98;
  const prevA2 = new Float64Array(bins);
  const gain = new Float64Array(bins);
  const gSm = new Float64Array(bins);
  const out = new Float32Array(len);
  const norm = 1 / 2; // sqrt-hann² с перекрытием 75% даёт сумму 2

  for (let f = 0; f < frames; f++) {
    const s = startOf(f);
    for (let i = 0; i < N; i++) {
      const j = s + i;
      re[i] = j >= 0 && j < len ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      const P = re[k] * re[k] + im[k] * im[k];
      const Nk = ns[k] * over;
      const gamma = P / Nk;
      const xi = alphaDD * (prevA2[k] / Nk) + (1 - alphaDD) * Math.max(gamma - 1, 0);
      let g = xi / (1 + xi);
      if (g < minGain) g = minGain;
      gain[k] = g;
    }
    // сглаживание усиления по частоте (3 бина)
    for (let k = 0; k < bins; k++) {
      const a = gain[Math.max(0, k - 1)], b = gain[k], c = gain[Math.min(bins - 1, k + 1)];
      gSm[k] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    for (let k = 0; k < bins; k++) {
      const g = gSm[k];
      const P = re[k] * re[k] + im[k] * im[k];
      prevA2[k] = g * g * P;
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      const j = s + i;
      if (j >= 0 && j < len) out[j] += re[i] * win[i] * norm;
    }
    if (onProgress && (f & 255) === 0) onProgress(f / frames);
  }
  return { out, noiseDb };
}

// ---------- уровни по кадрам ----------

export function frameLevels(x, sr, frameSec = 0.01) {
  const frame = Math.max(1, Math.round(sr * frameSec));
  const n = Math.ceil(x.length / frame);
  const db = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const s = f * frame;
    const e = Math.min(x.length, s + frame);
    let sum = 0;
    for (let i = s; i < e; i++) sum += x[i] * x[i];
    db[f] = powToDb(sum / Math.max(1, e - s));
  }
  return { db, frame };
}

// ---------- поиск пауз ----------
// Возвращает куски, которые оставляем, и куски, которые вырезаем (в сэмплах).

export function findPauses(x, sr, opts) {
  const {
    minPause = 0.3,     // паузы короче — не трогаем
    keepPause = 0.12,   // сколько тишины оставить на месте вырезанной паузы
    sensitivity = 0.5,  // 0 — режет только глухую тишину, 1 — режет и тихие вдохи
    preRoll = 0.05,     // запас до начала слова
    postRoll = 0.12,    // запас после слова (затухания, «с», «ш»)
    edge = 0.1,         // тишина в начале/конце
  } = opts || {};
  const { db, frame } = frameLevels(x, sr, 0.01);
  const fs = frame / sr;
  const nonSilent = Array.from(db).filter((v) => v > -100);
  const floor = percentile(nonSilent, 0.1);
  const speech = percentile(nonSilent, 0.95);
  const range = speech - floor;
  const all = [[0, x.length]];
  if (nonSilent.length < 10 || range < 10) {
    return { keep: all, removed: [], floorDb: floor, speechDb: speech, thresholdDb: null };
  }
  const t = 0.18 + 0.27 * sensitivity;
  const thr = floor + Math.max(6, range * t);
  const n = db.length;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = db[i] > thr ? 1 : 0;

  // убираем щелчки (очень короткие «звуки» < 40 мс)
  const minSpeech = Math.round(0.04 / fs);
  for (let i = 0; i < n; ) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j < n && mask[j]) j++;
    if (j - i < minSpeech) for (let k = i; k < j; k++) mask[k] = 0;
    i = j;
  }
  // расширяем речь запасами до/после
  const pre = Math.round(preRoll / fs);
  const post = Math.round(postRoll / fs);
  const dil = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    for (let k = Math.max(0, i - pre); k <= Math.min(n - 1, i + post); k++) dil[k] = 1;
  }
  mask = dil;

  const minPauseF = Math.round(minPause / fs);
  const keepHalf = Math.round(keepPause / 2 / fs);
  const edgeF = Math.round(edge / fs);
  const removedF = [];
  for (let i = 0; i < n; ) {
    if (mask[i]) { i++; continue; }
    let j = i;
    while (j < n && !mask[j]) j++;
    const L = j - i;
    if (i === 0 && j === n) break; // всё тихое — ничего не режем
    if (i === 0) {
      if (L > edgeF) removedF.push([0, L - edgeF]);
    } else if (j === n) {
      if (L > edgeF) removedF.push([i + edgeF, n]);
    } else if (L >= minPauseF && L > 2 * keepHalf) {
      removedF.push([i + keepHalf, j - keepHalf]);
    }
    i = j;
  }
  const removed = removedF
    .map(([a, b]) => [a * frame, Math.min(x.length, b * frame)])
    .filter(([a, b]) => b > a);
  const keep = [];
  let pos = 0;
  for (const [a, b] of removed) {
    if (a > pos) keep.push([pos, a]);
    pos = b;
  }
  if (pos < x.length) keep.push([pos, x.length]);
  return { keep, removed, floorDb: floor, speechDb: speech, thresholdDb: thr };
}

// Склейка кусков с короткими фейдами на стыках (без щелчков).
export function spliceSegments(x, sr, keep) {
  if (keep.length === 1 && keep[0][0] === 0 && keep[0][1] === x.length) return x;
  let total = 0;
  for (const [a, b] of keep) total += b - a;
  const out = new Float32Array(total);
  const fade = Math.max(1, Math.round(sr * 0.006));
  let o = 0;
  keep.forEach(([a, b], idx) => {
    const L = b - a;
    out.set(x.subarray(a, b), o);
    const f = Math.min(fade, L >> 1);
    if (idx > 0 || a > 0) for (let i = 0; i < f; i++) out[o + i] *= i / f;
    if (idx < keep.length - 1 || b < x.length) for (let i = 0; i < f; i++) out[o + L - 1 - i] *= i / f;
    o += L;
  });
  return out;
}

// ---------- EQ голоса ----------
// Под iPhone: убрать «коробку» 250–400 Гц, добавить разборчивости 3–5 кГц и «воздуха».

export function voiceEQ(x, sr, amount, warmth = 0) {
  if (amount <= 0 && warmth === 0) return x;
  const a = amount;
  if (warmth !== 0) applyBiquad(x, biquad('lowshelf', 140, sr, 0.7, warmth));
  if (a > 0) {
    applyBiquad(x, biquad('peak', 320, sr, 1.0, -3.5 * a));   // «бубнёж», коробка
    applyBiquad(x, biquad('peak', 3800, sr, 0.9, 3.5 * a));   // разборчивость
    if (sr >= 32000) applyBiquad(x, biquad('highshelf', 10000, sr, 0.7, 2.5 * a)); // воздух
  }
  return x;
}

// ---------- де-эссер ----------

export function deEss(x, sr, amount) {
  if (amount <= 0 || sr < 16000) return x;
  const hf = Float32Array.from(x);
  const fc = Math.min(5500, sr * 0.3);
  applyBiquad(hf, biquad('highpass', fc, sr, 0.5412));
  applyBiquad(hf, biquad('highpass', fc, sr, 1.3066));
  const envC = Math.exp(-1 / (0.005 * sr));
  const att = Math.exp(-1 / (0.001 * sr));
  const rel = Math.exp(-1 / (0.04 * sr));
  const thrRatio = -7 - 6 * amount;           // насколько ВЧ «громче нормы»
  const maxRed = 4 + 8 * amount;              // максимум ослабления, дБ
  let eF = 0, eH = 0, red = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], h = hf[i];
    eF = envC * eF + (1 - envC) * v * v;
    eH = envC * eH + (1 - envC) * h * h;
    const ratio = powToDb(eH) - powToDb(eF);
    let target = 0;
    if (eF > 1e-7 && ratio > thrRatio) target = Math.min(maxRed, (ratio - thrRatio) * 1.5);
    red = target > red ? att * red + (1 - att) * target : rel * red + (1 - rel) * target;
    const g = dbToGain(-red);
    x[i] = v - h + h * g;
  }
  return x;
}

// ---------- компрессор ----------

export function compress(x, sr, amount, speechDb) {
  if (amount <= 0) return x;
  const thr = speechDb - (4 + 10 * amount);
  const ratio = 1.5 + 2.5 * amount;
  const knee = 6;
  const det = Math.exp(-1 / (0.01 * sr));
  const att = Math.exp(-1 / (0.005 * sr));
  const rel = Math.exp(-1 / (0.12 * sr));
  let e = 0, gr = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    e = det * e + (1 - det) * v * v;
    const lv = powToDb(e);
    const over = lv - thr;
    let target;
    if (2 * over < -knee) target = 0;
    else if (2 * Math.abs(over) <= knee) target = ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
    else target = (1 / ratio - 1) * over;
    target = -target; // ослабление в дБ (≥0)
    gr = target > gr ? att * gr + (1 - att) * target : rel * gr + (1 - rel) * target;
    x[i] = v * dbToGain(-gr);
  }
  return x;
}

// ---------- громкость (ITU-R BS.1770, моно) ----------

export function loudnessLUFS(x, sr) {
  const k = Float32Array.from(x);
  applyBiquad(k, biquad('highshelf', 1500, sr, Math.SQRT1_2, 4));
  applyBiquad(k, biquad('highpass', 38, sr, 0.5));
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  if (k.length < block) {
    let s = 0;
    for (let i = 0; i < k.length; i++) s += k[i] * k[i];
    return -0.691 + powToDb(s / Math.max(1, k.length));
  }
  // префиксные суммы квадратов
  const cs = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) cs[i + 1] = cs[i] + k[i] * k[i];
  const z = [];
  for (let s = 0; s + block <= k.length; s += step) z.push((cs[s + block] - cs[s]) / block);
  const L = (p) => -0.691 + powToDb(p);
  const abs = z.filter((p) => L(p) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = L(meanAbs) - 10;
  const rel = abs.filter((p) => L(p) > relGate);
  const mean = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  return L(mean);
}

export function peakDb(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  return 20 * Math.log10(m + 1e-12);
}

// ---------- лимитер с просмотром вперёд ----------

export function limiter(x, sr, ceilingDb = -1.5) {
  const ceil = dbToGain(ceilingDb);
  const n = x.length;
  const L = Math.max(1, Math.round(0.005 * sr));
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); req[i] = a > ceil ? ceil / a : 1; }
  // скользящий минимум вперёд: gmin[i] = min(req[i..i+L-1]) (монотонная очередь)
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && req[dq[tail - 1]] >= req[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L - 1) head++;
    gmin[i] = req[dq[head]];
  }
  // плавное отпускание
  const rel = 1 - Math.exp(-1 / (0.08 * sr));
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = g + (1 - g) * rel;
    if (gmin[i] < g) g = gmin[i];
    gmin[i] = g;
  }
  // сглаживание атаки: среднее за предыдущие L — гарантирует, что пик не превысит потолок
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += gmin[i];
    if (i >= L) acc -= gmin[i - L];
    const gg = acc / Math.min(i + 1, L);
    let v = x[i] * gg;
    if (v > ceil) v = ceil; else if (v < -ceil) v = -ceil;
    x[i] = v;
  }
  return x;
}

// ---------- WAV ----------

export function encodeWav(x, sr) {
  const n = x.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const d = (Math.random() - Math.random()) / 32768; // TPDF-дизер
    let v = Math.round((x[i] + d) * 32767);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    dv.setInt16(o, v, true);
    o += 2;
  }
  return buf;
}

// ---------- пресеты ----------

export const PRESETS = {
  voice: {
    label: 'Голос для ролика',
    hpf: 80, denoise: 0.5, eq: 0.7, warmth: 0, deess: 0.5, compress: 0.6,
    cut: true, minPause: 0.3, keepPause: 0.12, sensitivity: 0.5, target: -14,
  },
  tight: {
    label: 'Плотно (Shorts/Reels)',
    hpf: 90, denoise: 0.55, eq: 0.8, warmth: 0, deess: 0.55, compress: 0.75,
    cut: true, minPause: 0.2, keepPause: 0.05, sensitivity: 0.6, target: -14,
  },
  noisy: {
    label: 'Шумная комната',
    hpf: 100, denoise: 0.85, eq: 0.6, warmth: 1, deess: 0.4, compress: 0.6,
    cut: true, minPause: 0.3, keepPause: 0.12, sensitivity: 0.45, target: -14,
  },
  soft: {
    label: 'Мягко, естественно',
    hpf: 70, denoise: 0.3, eq: 0.4, warmth: 0, deess: 0.3, compress: 0.35,
    cut: true, minPause: 0.5, keepPause: 0.25, sensitivity: 0.4, target: -16,
  },
  cutOnly: {
    label: 'Только вырезать паузы',
    hpf: 0, denoise: 0, eq: 0, warmth: 0, deess: 0, compress: 0,
    cut: true, minPause: 0.3, keepPause: 0.12, sensitivity: 0.5, target: null,
  },
};

// ---------- полная цепочка ----------

export function processVoice(channels, sr, s, onProgress = () => {}) {
  const t0 = Date.now();
  const report = (stage, p) => onProgress(stage, p);
  report('Подготовка', 0);
  let x = toMono(channels);
  const inDuration = x.length / sr;
  const inLufs = loudnessLUFS(x, sr);
  const inPeak = peakDb(x);
  let clipped = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.999) clipped++;

  if (s.hpf > 0) highpass24(x, s.hpf, sr);

  report('Шумодав', 0.05);
  const dn = denoise(x, sr, s.denoise, (p) => report('Шумодав', 0.05 + p * 0.65));
  x = dn.out;

  report('Поиск пауз', 0.72);
  const pauses = s.cut
    ? findPauses(x, sr, { minPause: s.minPause, keepPause: s.keepPause, sensitivity: s.sensitivity })
    : { keep: [[0, x.length]], removed: [], ...(() => {
        const { db } = frameLevels(x, sr);
        const v = Array.from(db).filter((d) => d > -100);
        return { floorDb: percentile(v, 0.1), speechDb: percentile(v, 0.95) };
      })() };

  report('Эквалайзер', 0.78);
  voiceEQ(x, sr, s.eq, s.warmth || 0);
  report('Де-эссер', 0.82);
  deEss(x, sr, s.deess);
  report('Компрессор', 0.86);
  compress(x, sr, s.compress, pauses.speechDb);

  report('Склейка', 0.9);
  x = spliceSegments(x, sr, pauses.keep);

  report('Громкость', 0.94);
  let outLufs = loudnessLUFS(x, sr);
  if (s.target != null && isFinite(outLufs) && outLufs > -70) {
    // Лимитер срезает пики и чуть снижает громкость — догоняем цель за пару итераций,
    // но не давим лимитером больше чем на 6 дБ сверх расчёта.
    const pre = x;
    const base = Math.min(30, s.target - outLufs);
    let gDb = base;
    for (let it = 0; it < 3; it++) {
      const g = dbToGain(gDb);
      x = new Float32Array(pre.length);
      for (let i = 0; i < pre.length; i++) x[i] = pre[i] * g;
      limiter(x, sr, -1.5);
      outLufs = loudnessLUFS(x, sr);
      const miss = s.target - outLufs;
      if (Math.abs(miss) < 0.3 || gDb >= base + 6) break;
      gDb = Math.min(base + 6, gDb + miss);
    }
  } else {
    limiter(x, sr, -1.5);
    outLufs = loudnessLUFS(x, sr);
  }
  report('Готово', 1);

  let removedSec = 0;
  for (const [a, b] of pauses.removed) removedSec += (b - a) / sr;
  return {
    output: x,
    removed: pauses.removed,
    stats: {
      inDuration,
      outDuration: x.length / sr,
      removedSec,
      pausesCut: pauses.removed.length,
      noiseDb: dn.noiseDb,
      floorDb: pauses.floorDb,
      speechDb: pauses.speechDb,
      inLufs,
      outLufs,
      inPeak,
      outPeak: peakDb(x),
      clippedMs: (clipped / sr) * 1000,
      ms: Date.now() - t0,
    },
  };
}
