import { STYLES, CASES, buildCues, cleanWords, toSRT, toVTT, toText, applyCase, splitWindows } from './cues.js';
import { getHandoff } from '../shared/handoff.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'instrument.subs.pick.v1';

const OPTIONS = {
  model: {
    title: 'Распознавание',
    hint: '«Точно» заметно лучше понимает русский, но считает примерно 2–4 минуты на минуту речи (на iPhone 11), «Быстро» — около минуты, зато больше ошибок. Модель скачивается один раз.',
    items: { fast: 'Быстро · 80 МБ', accurate: 'Точно · 250 МБ' },
  },
  style: {
    title: 'Стиль',
    hint: '',
    items: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.label])),
  },
  textCase: {
    title: 'Текст',
    hint: '«Без точек» — как обычно делают в Shorts и Reels.',
    items: CASES,
  },
};

let pick = loadPick();
let file = null;          // File или Blob
let fileName = '';
let audio16 = null;       // Float32Array 16 кГц моно
let words = null;         // распознанные слова
let cues = [];            // текущие субтитры (с правками)
let edited = false;
let mediaUrl = null;
let lastModel = null;

function loadPick() {
  const def = { model: 'accurate', style: 'shorts', textCase: 'nodots' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return def; }
}
function savePick() { try { localStorage.setItem(STORE_KEY, JSON.stringify(pick)); } catch {} }

// ---------- переключатели ----------

function renderOptions() {
  const box = $('options');
  box.innerHTML = '';
  for (const [group, def] of Object.entries(OPTIONS)) {
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
      b.onclick = () => choose(group, val);
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    const hint = group === 'style' ? STYLES[pick.style].hint : def.hint;
    if (hint) {
      const h = document.createElement('div');
      h.className = 'opt-hint';
      h.textContent = hint;
      wrap.appendChild(h);
    }
    box.appendChild(wrap);
  }
}

function choose(group, val) {
  if (pick[group] === val) return;
  if (group === 'style' && edited && !confirm('Исправления текста сбросятся — субтитры пересоберутся в новом стиле. Продолжить?')) return;
  pick = { ...pick, [group]: val };
  savePick();
  renderOptions();
  if (words && group === 'style') { rebuild(); }
  else if (words && group === 'textCase') { renderCues(); }
  if (group === 'model' && words) setRun(true, lastModel === val ? 'Распознать заново' : 'Распознать моделью «' + OPTIONS.model.items[val].split(' ·')[0] + '»');
}

// ---------- источник ----------

$('file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) openMedia(f, f.name);
});
$('change').onclick = () => $('file').click();

(async () => {
  const h = await getHandoff('lastAudio');
  if (h && h.blob) {
    const btn = $('fromAudio');
    const ago = Math.round((Date.now() - h.date) / 60000);
    btn.textContent = `Взять звук из «Звука»: ${h.name}` + (ago < 120 ? ` · ${ago} мин назад` : '');
    btn.classList.remove('hidden');
    btn.onclick = () => openMedia(h.blob, h.name);
    if (new URLSearchParams(location.search).get('from') === 'audio') openMedia(h.blob, h.name);
  }
})();

async function openMedia(f, name) {
  file = f;
  fileName = name || 'subtitles';
  words = null;
  cues = [];
  edited = false;
  audio16 = null;
  $('result').classList.add('hidden');
  $('pickBox').classList.add('hidden');
  $('source').classList.remove('hidden');
  $('fileName').textContent = fileName;
  $('fileInfo').textContent = 'Читаю файл…';
  setRun(false, 'Загрузка…');

  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(f);
  const isVideo = (f.type || '').startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(fileName);
  $('video').classList.toggle('hidden', !isVideo);
  $('audio').classList.toggle('hidden', isVideo);
  media().src = mediaUrl;
  $('capNow').textContent = '';
  $('capNow').classList.toggle('below', !isVideo);

  try {
    audio16 = await decodeTo16k(await f.arrayBuffer());
    $('fileInfo').textContent = `${time(audio16.length / 16000)} · ${mb(f.size)}`;
    setRun(true, 'Сделать субтитры');
  } catch (err) {
    console.error(err);
    $('fileInfo').textContent = 'Не получилось прочитать звук из файла. Попробуйте видео .mov/.mp4 или звук m4a/mp3/wav.';
    setRun(false, 'Выберите другой файл');
  }
}

function media() { return $('video').classList.contains('hidden') ? $('audio') : $('video'); }

async function decodeTo16k(buf) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new Ctx({ sampleRate: 48000 }); } catch { ctx = new Ctx(); }
  const ab = await new Promise((res, rej) => {
    const p = ctx.decodeAudioData(buf, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  ctx.close && ctx.close();
  // в 16 кГц моно — так любит Whisper
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OC(1, Math.max(1, Math.ceil(ab.duration * 16000)), 16000);
  const src = oc.createBufferSource();
  src.buffer = ab;
  src.connect(oc.destination);
  src.start();
  const out = await oc.startRendering();
  return out.getChannelData(0);
}

// ---------- распознавание ----------

let worker = null;
let jobId = 0;
$('run').onclick = run;

async function run() {
  if (!audio16) return;
  const id = ++jobId;
  setRun(false, 'Распознаю…');
  $('busy').classList.remove('hidden');
  progress('Подготовка', 0);
  const lock = await wakeLock();
  const windows = splitWindows(audio16, 16000);
  if (!worker) worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
  const model = pick.model;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.type === 'progress') progress(m.stage, m.p);
    else if (m.type === 'partial') { words = cleanWords(m.words); rebuild(true); }
    else if (m.type === 'done') {
      lastModel = model;
      words = cleanWords(m.words);
      edited = false;
      rebuild();
      $('busy').classList.add('hidden');
      setRun(true, 'Распознать заново');
      lock && lock.release && lock.release().catch(() => {});
      if (!words.length) alert('Речь не найдена. Проверьте, что в файле есть звук.');
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (m.type === 'error') {
      $('busy').classList.add('hidden');
      setRun(true, 'Попробовать ещё раз');
      lock && lock.release && lock.release().catch(() => {});
      alert('Ошибка: ' + m.message + '\n\nЕсли не хватает памяти — выберите «Быстро».');
      worker.terminate();
      worker = null;
    }
  };
  // копия: исходник остаётся для повторного распознавания
  const copy = audio16.slice();
  worker.postMessage({ id, model, audio: copy, windows }, [copy.buffer]);
}

function progress(stage, p) {
  $('stage').textContent = stage + '…';
  $('pct').textContent = Math.round(p * 100) + '%';
  $('bar').style.width = (p * 100).toFixed(1) + '%';
}

// ---------- субтитры ----------

function rebuild(partial = false) {
  cues = buildCues(words || [], pick.style);
  renderCues();
  if (!partial || cues.length) $('result').classList.remove('hidden');
}

function renderCues() {
  const box = $('cues');
  box.innerHTML = '';
  $('cueCount').textContent = cues.length ? `· ${cues.length}` : '';
  cues.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cue';
    const t = document.createElement('button');
    t.className = 'cue-time';
    t.textContent = time(c.start);
    t.onclick = () => { const m = media(); m.currentTime = c.start; m.play().catch(() => {}); };
    const ta = document.createElement('textarea');
    ta.value = caseOf(c);
    ta.rows = 1;
    ta.oninput = () => {
      fit(ta);
      // правка сохраняется «как написано»: регистр/точки больше не трогаем
      c.text = ta.value;
      c.manual = true;
      edited = true;
    };
    const del = document.createElement('button');
    del.className = 'cue-del';
    del.textContent = '✕';
    del.title = 'Удалить';
    del.onclick = () => { cues.splice(i, 1); edited = true; renderCues(); };
    row.append(t, ta, del);
    box.appendChild(row);
    fit(ta);
  });
}

// высота поля — по тексту (переносы строк + длинные строки)
function fit(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

// текущий субтитр поверх видео (или под плеером для звука)
for (const el of [$('video'), $('audio')]) {
  el.addEventListener('timeupdate', () => {
    const t = el.currentTime;
    const c = cues.find((q) => t >= q.start && t < q.end);
    $('capNow').textContent = c ? caseOf(c) : '';
  });
}

function caseOf(c) { return c.manual ? c.text : applyCase(c.text, pick.textCase); }
function exportCues() { return cues.map((c) => ({ ...c, text: caseOf(c) })); }

$('saveSrt').onclick = () => saveFile(toSRT(exportCues(), 'asis'), 'srt');
$('saveVtt').onclick = () => saveFile(toVTT(exportCues(), 'asis'), 'vtt');
$('copyText').onclick = async () => {
  const text = toText(exportCues(), 'asis');
  try { await navigator.clipboard.writeText(text); $('copyText').textContent = 'Скопировано ✓'; }
  catch { prompt('Скопируйте текст:', text); }
  setTimeout(() => { $('copyText').textContent = 'Копировать текст'; }, 1800);
};

async function saveFile(text, ext) {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/_clean$/, '') + '.' + ext;
  const f = new File([text], name, { type: 'text/plain' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- мелочи ----------

function setRun(enabled, text) { $('run').disabled = !enabled; $('run').textContent = text; }
function time(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
function mb(b) { return (b / 1048576).toFixed(1) + ' МБ'; }
async function wakeLock() { try { return await navigator.wakeLock.request('screen'); } catch { return null; } }

renderOptions();
