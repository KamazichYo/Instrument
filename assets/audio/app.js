import { PRESETS } from './dsp.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'instrument.audio.settings.v1';

// ---------- состояние ----------

let settings = loadSettings();
let presetId = settings.__preset || 'voice';
let decoded = null;   // { channels: Float32Array[], sampleRate, duration }
let file = null;
let resultBlob = null;
let urls = [];

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...PRESETS.voice, ...JSON.parse(raw) };
  } catch {}
  return { ...PRESETS.voice, __preset: 'voice' };
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...settings, __preset: presetId })); } catch {}
}

// ---------- настройки в интерфейсе ----------

const fmt = {
  minPause: (v) => v.toFixed(2) + ' с',
  keepPause: (v) => (v * 1000).toFixed(0) + ' мс',
  sensitivity: pct,
  denoise: pct,
  eq: pct,
  compress: pct,
  deess: pct,
  hpf: (v) => (v > 0 ? v + ' Гц' : 'выкл'),
  warmth: (v) => (v > 0 ? '+' : '') + v + ' дБ',
};
function pct(v) { return v > 0 ? Math.round(v * 100) + '%' : 'выкл'; }

function renderPresets() {
  const box = $('presets');
  box.innerHTML = '';
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip' + (id === presetId ? ' on' : '');
    b.textContent = p.label;
    b.onclick = () => {
      presetId = id;
      const { label, ...vals } = PRESETS[id];
      settings = { ...settings, ...vals };
      syncControls();
      renderPresets();
      saveSettings();
    };
    box.appendChild(b);
  }
  if (presetId === 'custom') {
    const b = document.createElement('button');
    b.className = 'chip on';
    b.textContent = 'Свой';
    box.appendChild(b);
  }
}

function syncControls() {
  document.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    const v = settings[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') el.value = v == null ? 'off' : String(v);
    else el.value = v ?? 0;
  });
  document.querySelectorAll('[data-o]').forEach((o) => {
    const k = o.dataset.o;
    o.textContent = fmt[k] ? fmt[k](Number(settings[k] ?? 0)) : settings[k];
  });
  document.querySelectorAll('[data-dep]').forEach((el) => {
    el.classList.toggle('hidden', !settings[el.dataset.dep]);
  });
}

document.querySelectorAll('[data-k]').forEach((el) => {
  const ev = el.type === 'range' ? 'input' : 'change';
  el.addEventListener(ev, () => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') settings[k] = el.checked;
    else if (el.tagName === 'SELECT') settings[k] = el.value === 'off' ? null : Number(el.value);
    else settings[k] = Number(el.value);
    if (presetId !== 'custom') { presetId = 'custom'; renderPresets(); }
    syncControls();
    saveSettings();
  });
});

// ---------- загрузка файла ----------

$('file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await openFile(f);
});
$('change').onclick = () => $('file').click();

async function openFile(f) {
  file = f;
  decoded = null;
  $('result').classList.add('hidden');
  $('pick').classList.add('hidden');
  $('source').classList.remove('hidden');
  $('fileName').textContent = f.name;
  $('fileInfo').textContent = 'Читаю файл… ' + mb(f.size);
  setRun(false, 'Загрузка…');
  clearCanvas($('waveIn'));

  if (f.size > 700 * 1024 * 1024) {
    $('fileInfo').textContent = 'Файл больше 700 МБ — телефону может не хватить памяти. Лучше отправьте сюда только аудио (Диктофон) или более короткое видео.';
  }

  revokeUrls();
  const inUrl = URL.createObjectURL(f);
  urls.push(inUrl);
  $('playIn').src = inUrl;

  try {
    const buf = await f.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // 48 кГц — родная частота iPhone: без лишнего пересэмплирования
    let ctx;
    try { ctx = new Ctx({ sampleRate: 48000 }); } catch { ctx = new Ctx(); }
    const ab = await decodeAudio(ctx, buf);
    ctx.close && ctx.close();
    const channels = [];
    for (let c = 0; c < ab.numberOfChannels; c++) channels.push(ab.getChannelData(c));
    decoded = { channels, sampleRate: ab.sampleRate, duration: ab.duration };
    $('fileInfo').textContent =
      `${time(ab.duration)} · ${ab.numberOfChannels === 1 ? 'моно' : 'стерео'} · ${(ab.sampleRate / 1000).toFixed(1)} кГц · ${mb(f.size)}`;
    drawWave($('waveIn'), mixPeaks(channels), [], ab.length, 'var(--wave)');
    setRun(true, 'Улучшить звук');
  } catch (err) {
    console.error(err);
    $('fileInfo').textContent =
      'Не получилось прочитать звук из этого файла. Попробуйте m4a из Диктофона, mp3, wav или видео .mov/.mp4.';
    setRun(false, 'Выберите другой файл');
  }
}

function decodeAudio(ctx, buf) {
  // старый Safari знает только callback-версию
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

// ---------- обработка ----------

let worker = null;
$('run').onclick = run;

async function run() {
  if (!decoded) return;
  setRun(false, 'Обработка…');
  $('busy').classList.remove('hidden');
  $('result').classList.add('hidden');
  progress('Подготовка', 0);
  const lock = await wakeLock();

  // копии каналов: оригинал остаётся для повторной обработки с другими настройками
  const channels = decoded.channels.map((c) => c.slice());
  if (worker) worker.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') progress(m.stage, m.p);
    else if (m.type === 'done') { done(m); finish(); }
    else if (m.type === 'error') { fail(m.message); finish(); }
  };
  worker.onerror = (e) => { fail(e.message || 'ошибка обработки'); finish(); };
  function finish() {
    lock && lock.release && lock.release().catch(() => {});
    worker && worker.terminate();
    worker = null;
  }
  const { __preset, ...s } = settings;
  worker.postMessage(
    { channels, sampleRate: decoded.sampleRate, settings: s },
    channels.map((c) => c.buffer),
  );
}

function progress(stage, p) {
  $('stage').textContent = stage + '…';
  $('pct').textContent = Math.round(p * 100) + '%';
  $('bar').style.width = (p * 100).toFixed(1) + '%';
}

function fail(msg) {
  $('busy').classList.add('hidden');
  setRun(true, 'Попробовать ещё раз');
  alert('Ошибка: ' + msg);
}

function done({ output, wav, removed, stats }) {
  $('busy').classList.add('hidden');
  setRun(true, 'Обработать заново');
  resultBlob = new Blob([wav], { type: 'audio/wav' });
  const outUrl = URL.createObjectURL(resultBlob);
  urls.push(outUrl);
  $('playOut').src = outUrl;
  $('download').href = outUrl;
  $('download').download = outName();

  const st = stats;
  $('stats').innerHTML = [
    ['Длительность', `${time(st.inDuration)} → ${time(st.outDuration)}`],
    ['Вырезано', st.pausesCut ? `${st.pausesCut} пауз · ${st.removedSec.toFixed(1)} с` : 'ничего'],
    ['Громкость, LUFS', `${lufs(st.inLufs)} → ${lufs(st.outLufs)}`],
    ['Фоновый шум', `${Math.round(st.noiseDb)} дБ`],
  ].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');

  const notes = [];
  if (st.clippedMs > 5) notes.push(['warn', `В исходнике есть перегруз (~${Math.round(st.clippedMs)} мс) — хрипы не убрать. В следующий раз держите телефон чуть дальше ото рта.`]);
  if (st.noiseDb > -45) notes.push(['warn', 'Фон громкий. Если голос звучит «в банке» — уменьшите шумодав и попробуйте записать в более тихом месте.']);
  if (st.speechDb - st.floorDb < 15 && settings.cut) notes.push(['', 'Речь почти не отличается от фона по громкости — паузы могли найтись неточно. Попробуйте изменить «Порог тишины».']);
  notes.push(['', `Обработано за ${(st.ms / 1000).toFixed(1)} с.`]);
  $('notes').innerHTML = notes.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join('');

  $('result').classList.remove('hidden');
  const total = decoded.channels[0].length;
  drawWave($('waveCut'), mixPeaks(decoded.channels), removed, total, 'var(--wave)');
  drawWave($('waveOut'), peaks(output, 600), [], output.length, 'var(--wave-2)');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('share').onclick = async () => {
  if (!resultBlob) return;
  const f = new File([resultBlob], outName(), { type: 'audio/wav' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: f.name }); } catch {}
  } else {
    $('download').click();
  }
};

function outName() {
  const base = (file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'voice') || 'voice';
  return base + '_clean.wav';
}

// ---------- волна ----------

function peaks(x, cols) {
  const out = new Float32Array(cols);
  const step = x.length / cols;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * step), b = Math.min(x.length, Math.floor((c + 1) * step));
    let m = 0;
    for (let i = a; i < b; i += 4) { const v = Math.abs(x[i]); if (v > m) m = v; }
    out[c] = m;
  }
  return out;
}
function mixPeaks(channels) {
  const ps = channels.map((c) => peaks(c, 600));
  const out = new Float32Array(600);
  for (const p of ps) for (let i = 0; i < 600; i++) out[i] = Math.max(out[i], p[i]);
  return out;
}

function cssColor(v) {
  if (!v.startsWith('var(')) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
}

function clearCanvas(cv) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
}

function drawWave(cv, pk, removed, total, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = cssColor('var(--cut)');
  for (const [a, b] of removed) g.fillRect((a / total) * w, 0, Math.max(1, ((b - a) / total) * w), h);
  // мягкое масштабирование, чтобы тихие записи тоже было видно
  let max = 0;
  for (const v of pk) max = Math.max(max, v);
  const k = max > 0 ? 0.92 / max : 1;
  g.fillStyle = cssColor(color);
  const n = pk.length;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const ah = Math.max(dpr, pk[i] * k * h);
    g.fillRect(i * bw, (h - ah) / 2, Math.max(1, bw - 0.5), ah);
  }
}

// ---------- мелочи ----------

function setRun(enabled, text) { $('run').disabled = !enabled; $('run').textContent = text; }
function time(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
function lufs(v) { return v > -70 ? v.toFixed(0) : '—'; }
function mb(b) { return (b / 1048576).toFixed(1) + ' МБ'; }
function revokeUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }
async function wakeLock() {
  try { return await navigator.wakeLock.request('screen'); } catch { return null; }
}

window.addEventListener('resize', () => {
  if (decoded) drawWave($('waveIn'), mixPeaks(decoded.channels), [], decoded.channels[0].length, 'var(--wave)');
});

syncControls();
renderPresets();
