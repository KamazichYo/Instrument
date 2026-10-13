import { OPTIONS, PRESETS, DEFAULT_PICK, AI_REPLACES, resolveSettings } from './dsp.js';
import { putHandoff } from '../shared/handoff.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'instrument.audio.pick.v2';
const PREVIEW_SEC = 12;

// ---------- состояние ----------

let pick = loadPick();
let decoded = null;   // { channels: Float32Array[], sampleRate, duration }
let file = null;
let resultBlob = null;
let urls = [];
let excerptStart = 0; // секунды

function loadPick() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_PICK, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_PICK };
}
function savePick() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(pick)); } catch {}
}

// ---------- переключатели ----------

function renderPresets() {
  const box = $('presets');
  box.innerHTML = '';
  for (const p of Object.values(PRESETS)) {
    const b = document.createElement('button');
    const on = Object.entries(p.pick).every(([k, v]) => pick[k] === v);
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = p.label;
    b.onclick = () => { pick = { ...p.pick }; onPickChanged(); };
    box.appendChild(b);
  }
}

function renderOptions() {
  const box = $('options');
  box.innerHTML = '';
  const aiOn = pick.ai && pick.ai !== 'off';
  for (const [group, def] of Object.entries(OPTIONS)) {
    if (aiOn && AI_REPLACES.includes(group)) continue;
    const wrap = document.createElement('div');
    wrap.className = 'opt';
    wrap.innerHTML = `<div class="opt-title">${def.title}</div>`;
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.gridTemplateColumns = `repeat(${Object.keys(def.items).length}, 1fr)`;
    for (const [val, label] of Object.entries(def.items)) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = pick[group] === val ? 'on' : '';
      b.onclick = () => {
        if (pick[group] === val) return;
        pick = { ...pick, [group]: val };
        onPickChanged();
      };
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    const hint = document.createElement('div');
    hint.className = 'opt-hint';
    hint.textContent = def.hint + (group === 'ai' && aiOn ? ' Шум и эхо убирает ИИ — отдельные настройки для них скрыты.' : '');
    wrap.appendChild(hint);
    box.appendChild(wrap);
  }
}

function onPickChanged() {
  savePick();
  renderPresets();
  renderOptions();
  // если сейчас играет обработанный вариант — сразу переключаемся на новый
  if (playing === 'proc') playProcessed();
  else updateListenInfo();
}

// ---------- загрузка файла ----------

$('file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await openFile(f);
});
$('change').onclick = () => $('file').click();

async function openFile(f) {
  stopPlayback();
  previewCache.clear();
  file = f;
  decoded = null;
  $('result').classList.add('hidden');
  $('listen').classList.add('hidden');
  $('pick').classList.add('hidden');
  $('source').classList.remove('hidden');
  $('fileName').textContent = f.name;
  $('fileInfo').textContent = 'Читаю файл… ' + mb(f.size);
  setRun(false, 'Загрузка…');
  clearCanvas($('waveIn'));
  revokeUrls();

  if (f.size > 700 * 1024 * 1024) {
    $('fileInfo').textContent = 'Файл больше 700 МБ — телефону может не хватить памяти. Лучше отправьте сюда только аудио (Диктофон) или более короткое видео.';
  }

  try {
    const buf = await f.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // 48 кГц — родная частота iPhone: без лишнего пересэмплирования
    let ctx;
    try { ctx = new Ctx({ sampleRate: 48000 }); } catch { ctx = new Ctx(); }
    let ab = await decodeAudio(ctx, buf);
    ctx.close && ctx.close();
    if (ab.sampleRate !== 48000) ab = await resampleTo48k(ab);
    const channels = [];
    for (let c = 0; c < ab.numberOfChannels; c++) channels.push(ab.getChannelData(c));
    decoded = { channels, sampleRate: ab.sampleRate, duration: ab.duration, peaks: mixPeaks(channels) };
    $('fileInfo').textContent =
      `${time(ab.duration)} · ${ab.numberOfChannels === 1 ? 'моно' : 'стерео'} · ${(ab.sampleRate / 1000).toFixed(1)} кГц · ${mb(f.size)}`;
    excerptStart = busiestWindow(channels[0], ab.sampleRate);
    drawSource();
    $('listen').classList.remove('hidden');
    updateListenInfo();
    setRun(true, 'Обработать весь файл');
  } catch (err) {
    console.error(err);
    $('fileInfo').textContent =
      'Не получилось прочитать звук из этого файла. Попробуйте m4a из Диктофона, mp3, wav или видео .mov/.mp4.';
    setRun(false, 'Выберите другой файл');
  }
}

// ИИ-модель работает в 48 кГц — приводим всё к ней (mp3 часто бывают 44.1 кГц).
async function resampleTo48k(ab) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OC(ab.numberOfChannels, Math.ceil(ab.duration * 48000), 48000);
  const src = oc.createBufferSource();
  src.buffer = ab;
  src.connect(oc.destination);
  src.start();
  return oc.startRendering();
}

function decodeAudio(ctx, buf) {
  // старый Safari знает только callback-версию
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

// Кусок с самой плотной речью — его и слушаем по умолчанию.
function busiestWindow(x, sr) {
  const dur = x.length / sr;
  if (dur <= PREVIEW_SEC) return 0;
  const block = Math.round(sr * 0.5);
  const n = Math.floor(x.length / block);
  const e = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = b * block; i < (b + 1) * block; i += 8) s += x[i] * x[i];
    e[b] = s;
  }
  const w = Math.round(PREVIEW_SEC / 0.5);
  let best = 0, bestSum = -1, sum = 0;
  for (let b = 0; b < n; b++) {
    sum += e[b];
    if (b >= w) sum -= e[b - w];
    if (b >= w - 1 && sum > bestSum) { bestSum = sum; best = b - w + 1; }
  }
  return best * 0.5;
}

$('waveIn').addEventListener('click', (e) => {
  if (!decoded) return;
  const r = e.currentTarget.getBoundingClientRect();
  const t = ((e.clientX - r.left) / r.width) * decoded.duration;
  excerptStart = Math.max(0, Math.min(decoded.duration - PREVIEW_SEC, t - 1));
  if (excerptStart < 0) excerptStart = 0;
  drawSource();
  const was = playing;
  stopPlayback();
  if (was === 'orig') playOriginal();
  else if (was === 'proc') playProcessed();
  else updateListenInfo();
});

function drawSource() {
  const total = decoded.channels[0].length;
  const a = Math.round(excerptStart * decoded.sampleRate);
  const b = Math.min(total, a + PREVIEW_SEC * decoded.sampleRate);
  drawWave($('waveIn'), decoded.peaks, [], total, 'var(--wave)', [a, b]);
}

// ---------- прослушка фрагмента ----------

let audioCtx = null;
let source = null;
let playing = null; // null | 'orig' | 'proc'
let previewWorker = null;
let previewSeq = 0;
let previewBusy = false;
let currentJob = null;
let pendingJob = null;
const previewCache = new Map(); // ключ (выбор + кусок) → AudioBuffer: повторные переключения мгновенные

function ensureAudio() {
  // iOS: без этого Web Audio молчит при включённом беззвучном режиме
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function excerptChannels(start = excerptStart) {
  const sr = decoded.sampleRate;
  const a = Math.round(start * sr);
  const b = Math.min(decoded.channels[0].length, a + PREVIEW_SEC * sr);
  return decoded.channels.map((c) => c.slice(a, b));
}

function playBuffer(buf, which) {
  stopSource();
  const ctx = ensureAudio();
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(ctx.destination);
  source.onended = () => { if (source && source.buffer === buf) { playing = null; source = null; updateListenButtons(); } };
  source.start();
  playing = which;
  updateListenButtons();
}

function stopSource() {
  if (source) { try { source.onended = null; source.stop(); } catch {} source = null; }
}
function stopPlayback() {
  stopSource();
  playing = null;
  previewSeq++;
  pendingJob = null;
  clearBusy();
  updateListenButtons();
}
function clearBusy() {
  $('playOrig').classList.remove('busy');
  $('playProc').classList.remove('busy');
}

$('playOrig').onclick = () => {
  ensureAudio();
  if (playing === 'orig') return stopPlayback();
  playOriginal();
};
$('playProc').onclick = () => {
  ensureAudio();
  if (playing === 'proc') return stopPlayback();
  playProcessed();
};

// Оригинал тоже прогоняем через выравнивание громкости — чтобы сравнение было честным
// (громче всегда кажется «лучше»).
const ORIG_PICK = { ai: 'off', pauses: 'off', reverb: 'off', noise: 'off', tone: 'none', level: 'off', loudness: 'social' };

function playOriginal() { renderAndPlay(ORIG_PICK, 'orig'); }
function playProcessed() { renderAndPlay(pick, 'proc'); }

function renderAndPlay(p, which) {
  if (!decoded) return;
  const key = JSON.stringify(p) + '@' + excerptStart.toFixed(2);
  const cached = previewCache.get(key);
  if (cached) { playBuffer(cached.buf, which); showPreviewStats(cached.stats, which); return; }

  stopSource();
  clearBusy();
  playing = which;
  const seq = ++previewSeq;
  setBusy(which, true);
  const job = { p, which, key, seq, start: excerptStart };
  // Пока считается предыдущий вариант — запоминаем только самый последний запрос.
  // Воркер не перезапускаем: так нейросеть не грузится заново при каждом нажатии.
  if (previewBusy) { pendingJob = job; return; }
  startJob(job);
}

function startJob(job) {
  if (!previewWorker) {
    previewWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    previewWorker.onmessage = onPreviewMessage;
  }
  previewBusy = true;
  currentJob = job;
  const channels = excerptChannels(job.start);
  previewWorker.postMessage(
    { id: job.seq, channels, sampleRate: decoded.sampleRate, settings: resolveSettings(job.p), wav: false },
    channels.map((c) => c.buffer),
  );
}

function onPreviewMessage(e) {
  const m = e.data;
  const job = currentJob;
  if (!job || m.id !== job.seq) return;
  if (m.type === 'progress') {
    if (job.seq === previewSeq && m.stage !== 'Готово') updateListenInfo(`${m.stage}… ${Math.round(m.p * 100)}%`);
    return;
  }
  previewBusy = false;
  currentJob = null;
  let buf = null;
  if (m.type === 'done') {
    const ctx = ensureAudio();
    buf = ctx.createBuffer(1, Math.max(1, m.output.length), decoded.sampleRate);
    buf.getChannelData(0).set(m.output);
    previewCache.set(job.key, { buf, stats: m.stats });
    if (previewCache.size > 16) previewCache.delete(previewCache.keys().next().value);
  }
  if (pendingJob) { const j = pendingJob; pendingJob = null; startJob(j); return; }
  if (job.seq !== previewSeq) return; // пользователь уже нажал «стоп»
  setBusy(job.which, false);
  if (m.type === 'error') { playing = null; updateListenButtons(); updateListenInfo(); alert('Ошибка: ' + m.message); return; }
  playBuffer(buf, job.which);
  showPreviewStats(m.stats, job.which);
}

function setBusy(which, on) {
  const btn = which === 'orig' ? $('playOrig') : $('playProc');
  btn.classList.toggle('busy', on);
  updateListenButtons();
}

function updateListenButtons() {
  for (const [id, w] of [['playOrig', 'orig'], ['playProc', 'proc']]) {
    const b = $(id);
    const busy = b.classList.contains('busy');
    b.classList.toggle('playing', playing === w && !busy);
    b.querySelector('.i').textContent = busy ? '…' : playing === w ? '■' : '▶';
  }
}

function updateListenInfo(extra) {
  if (!decoded) return;
  const a = excerptStart, b = Math.min(decoded.duration, a + PREVIEW_SEC);
  $('listenInfo').textContent = `Фрагмент ${time(a, 0)}–${time(b, 0)}` + (extra ? ' · ' + extra : ' · громкость выровнена для честного сравнения');
}

function showPreviewStats(st, which) {
  if (which !== 'proc' || !st) return updateListenInfo();
  updateListenInfo(st.pausesCut ? `вырезано ${st.removedSec.toFixed(1)} с пауз` : 'пауз не вырезано');
}

// ---------- обработка всего файла ----------

let worker = null;
$('run').onclick = run;

async function run() {
  if (!decoded) return;
  stopPlayback();
  setRun(false, 'Обработка…');
  $('busy').classList.remove('hidden');
  $('result').classList.add('hidden');
  progress('Подготовка', 0);
  const lock = await wakeLock();

  // копии каналов: оригинал остаётся для повторной обработки с другими вариантами
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
  worker.postMessage(
    { channels, sampleRate: decoded.sampleRate, settings: resolveSettings(pick), wav: true },
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
  // для «Субтитров»: тайминг совпадёт с порезанным звуком
  putHandoff('lastAudio', { blob: resultBlob, name: outName(), date: Date.now() });

  const st = stats;
  $('stats').innerHTML = [
    ['Длительность', `${time(st.inDuration)} → ${time(st.outDuration)}`],
    ['Вырезано', st.pausesCut ? `${st.pausesCut} пауз · ${st.removedSec.toFixed(1)} с` : 'ничего'],
    ['Громкость, LUFS', `${lufs(st.inLufs)} → ${lufs(st.outLufs)}`],
    ['Фоновый шум', `${Math.round(st.noiseDb)} дБ`],
  ].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');

  const notes = [];
  if (st.clippedMs > 5) notes.push(['warn', `В исходнике есть перегруз (~${Math.round(st.clippedMs)} мс) — хрипы не убрать. В следующий раз держите телефон чуть дальше ото рта.`]);
  if (st.noiseDb > -45) notes.push(['warn', (pick.ai !== 'off' ? 'Фон громкий. Если голос звучит «жёвано» — поставьте «ИИ-очистка: Мягко».' : 'Фон громкий. Попробуйте «ИИ-очистку» или «Шум: Сильно». Если голос звучит «жёвано» — ослабьте.')]);
  if (st.speechDb - st.floorDb < 15 && pick.pauses !== 'off') notes.push(['', 'Речь почти не отличается от фона по громкости — паузы могли найтись неточно. Если съедаются слова — «Паузы: Мягко».']);
  notes.push(['', `Обработано за ${(st.ms / 1000).toFixed(1)} с.`]);
  $('notes').innerHTML = notes.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join('');

  $('result').classList.remove('hidden');
  const total = decoded.channels[0].length;
  drawWave($('waveCut'), decoded.peaks, removed, total, 'var(--wave)');
  drawWave($('waveOut'), peaks(output, 600), [], output.length, 'var(--wave-2)');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('playOut').addEventListener('play', () => stopPlayback());

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

function drawWave(cv, pk, removed, total, color, sel) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (sel) {
    g.fillStyle = cssColor('var(--sel)');
    g.fillRect((sel[0] / total) * w, 0, ((sel[1] - sel[0]) / total) * w, h);
  }
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
function time(s, digits = 1) {
  const m = Math.floor(s / 60);
  const r = digits === 0 ? Math.floor(s - m * 60) : s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(digits)}`;
}
function lufs(v) { return v > -70 ? v.toFixed(0) : '—'; }
function mb(b) { return (b / 1048576).toFixed(1) + ' МБ'; }
function revokeUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }
async function wakeLock() {
  try { return await navigator.wakeLock.request('screen'); } catch { return null; }
}

window.addEventListener('resize', () => { if (decoded) drawSource(); });

renderPresets();
renderOptions();
