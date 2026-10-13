// Слова с метками времени → субтитры (SRT / VTT / текст).
// Чистые функции без зависимостей: работают и в браузере, и в Node (тесты).

export const STYLES = {
  classic: { label: 'Классика', hint: 'До 2 строк внизу кадра — для обычных роликов.', maxChars: 84, lineChars: 42, maxWords: 99, maxDur: 5.5 },
  shorts: { label: 'Shorts', hint: '3–4 слова крупно — для вертикальных роликов.', maxChars: 26, lineChars: 26, maxWords: 4, maxDur: 2.5 },
  word: { label: 'По слову', hint: 'Каждое слово отдельно — динамичный стиль.', maxChars: 40, lineChars: 40, maxWords: 1, maxDur: 1.5 },
};

export const CASES = {
  asis: 'Как есть',
  nodots: 'Без точек',
  upper: 'ЗАГЛАВНЫЕ',
};

// Известные «галлюцинации» Whisper на тишине в русском (из субтитров, на которых он учился)
const HALLUCINATIONS = [
  /субтитр\S* (сделал|создавал|делал|подготовил)/i,
  /dimatorzok/i,
  /редактор субтитров/i,
  /корректор [а-яё]\.[а-яё]/i,
  /продолжение следует/i,
];

export function cleanWords(words) {
  const text = words.map((w) => w.text).join('');
  let out = words;
  for (const re of HALLUCINATIONS) {
    if (re.test(text)) {
      // убираем предложение с галлюцинацией целиком
      const sentences = splitSentences(out);
      out = sentences.filter((s) => !re.test(s.map((w) => w.text).join(''))).flat();
    }
  }
  return out
    .map((w) => ({ text: w.text.replace(/\s+/g, ' '), start: w.start, end: Math.max(w.end, w.start + 0.05) }))
    .filter((w) => w.text.trim().length > 0);
}

function splitSentences(words) {
  const res = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (/[.!?…]["»”)]*\s*$/.test(w.text)) { res.push(cur); cur = []; }
  }
  if (cur.length) res.push(cur);
  return res;
}

const endsSentence = (t) => /[.!?…]["»”)]*\s*$/.test(t);
const endsClause = (t) => /[,;:—–-]\s*$/.test(t);

export function buildCues(words, styleId = 'classic') {
  const st = STYLES[styleId] || STYLES.classic;
  const cues = [];
  let cur = [];
  const len = (ws) => ws.map((w) => w.text).join('').trim().length;
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = w.start - prev.end;
      const tooLong = len([...cur, w]) > st.maxChars || cur.length >= st.maxWords || w.end - cur[0].start > st.maxDur;
      const softBreak = endsClause(prev.text) && len(cur) > st.maxChars * 0.5;
      if (endsSentence(prev.text) || gap > 0.7 || tooLong || softBreak) flush();
    }
    cur.push(w);
  }
  flush();

  // Одинокое слово в конце фразы («…до линии роста | волос») приклеиваем к предыдущему субтитру
  if (st.maxWords > 1) {
    for (let i = cues.length - 1; i > 0; i--) {
      const c = cues[i], p = cues[i - 1];
      const merged = [...p.words, ...c.words];
      if (c.words.length === 1 && !endsSentence(p.words[p.words.length - 1].text) && c.start - p.end < 0.5 &&
          len(merged) <= st.maxChars + 12 && merged.length <= st.maxWords + 1) {
        p.words = merged;
        p.end = c.end;
        cues.splice(i, 1);
      }
    }
  }

  // Тайминг: субтитр висит минимум 0.8 с (если не мешает следующему), стык — без наложений
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    const limit = next ? next.start - 0.04 : c.end + 1;
    const want = Math.max(c.end + 0.15, c.start + 0.8);
    c.end = Math.max(c.end, Math.min(want, limit));
    c.text = layoutText(c.words.map((w) => w.text).join('').trim(), st.lineChars);
  }
  // слова оставляем — по ним подсвечивается текущее слово при вшивании в видео
  return cues.map(({ start, end, text, words }) => ({ start, end, text, words }));
}

// Делим на 2 строки по ближайшему к середине пробелу
function layoutText(text, lineChars) {
  if (text.length <= lineChars) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}

export function applyCase(text, mode) {
  if (mode === 'upper') return text.toLocaleUpperCase('ru');
  if (mode === 'nodots') return text.replace(/[.,;:]+(?=\s*$)/g, '').replace(/[.,;:]+(?=\n)/g, '').trim();
  return text;
}

function ts(sec, sep) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toSRT(cues, caseMode = 'asis') {
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${applyCase(c.text, caseMode)}\n`)
    .join('\n');
}

export function toVTT(cues, caseMode = 'asis') {
  return 'WEBVTT\n\n' + cues
    .map((c) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${applyCase(c.text, caseMode)}\n`)
    .join('\n');
}

export function toText(cues, caseMode = 'asis') {
  return cues.map((c) => applyCase(c.text, caseMode).replace(/\n/g, ' ')).join(' ').replace(/\s+/g, ' ').trim();
}

// Где резать длинную запись на куски для Whisper (≤ 28 с): в самом тихом месте между 18 и 28 с.
export function splitWindows(x, sr, maxSec = 28, minSec = 18) {
  const frame = Math.round(sr * 0.02);
  const n = Math.floor(x.length / frame);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) s += x[i] * x[i];
    db[f] = 10 * Math.log10(s / frame + 1e-12);
  }
  const wins = [];
  let start = 0;
  const maxF = Math.round(maxSec / 0.02), minF = Math.round(minSec / 0.02);
  while (start < n) {
    if (n - start <= maxF) { wins.push([start, n]); break; }
    let best = start + maxF, bestDb = Infinity;
    for (let f = start + minF; f < start + maxF; f++) {
      // сглаженный уровень в окне 0.2 с — ищем паузу, а не случайный тихий кадр
      let s = 0;
      for (let k = -5; k <= 5; k++) s += db[Math.min(n - 1, Math.max(0, f + k))];
      if (s < bestDb) { bestDb = s; best = f; }
    }
    wins.push([start, best]);
    start = best;
  }
  // уровень речи в каждом куске — пустые (тишина) пропускаем, там Whisper выдумывает текст
  let peak = -120;
  for (let f = 0; f < n; f++) peak = Math.max(peak, db[f]);
  return wins.map(([a, b], i) => {
    let loud = 0;
    for (let f = a; f < b; f++) if (db[f] > peak - 30) loud++;
    const bs = i === wins.length - 1 ? x.length : b * frame; // хвост короче кадра не теряем
    return { start: (a * frame) / sr, end: bs / sr, a: a * frame, b: bs, silent: loud * 0.02 < 0.3 };
  });
}
