// Рисует субтитр на кадре (canvas). Один и тот же код — для предпросмотра и для вшивания в видео,
// поэтому на экране ровно то, что получится в файле.
import { applyCase } from './cues.js';

export const LOOKS = {
  outline: 'Обводка',
  accent: 'Акцент слова',
  box: 'Плашка',
};
export const PLACES = { bottom: 'Низ', middle: 'Центр', top: 'Верх' };
export const SIZES = { s: 'Меньше', m: 'Обычно', l: 'Крупно' };

const ACCENT = '#FFD60A';
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", system-ui, Arial, sans-serif';

export function findCue(cues, t) {
  // субтитров немного — линейного поиска хватает
  for (const c of cues) if (t >= c.start && t < c.end) return c;
  return null;
}

export function drawCaption(ctx, w, h, cue, t, o) {
  if (!cue) return;
  const vertical = h >= w;
  const base = Math.min(w, h);
  const fs = Math.round(base * { s: 0.052, m: 0.066, l: 0.084 }[o.size || 'm'] * (vertical ? 1 : 0.8));
  const lh = Math.round(fs * 1.22);
  const maxW = w * 0.86;
  ctx.save();
  ctx.font = `800 ${fs}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // слова с таймингом (для «акцента»), если текст не правили руками
  const text = (cue.manual ? cue.text : applyCase(cue.text, o.caseMode)).replace(/\n/g, ' ');
  let tokens;
  if (!cue.manual && cue.words && cue.words.length) {
    tokens = cue.words.map((wd) => ({ text: applyCase(wd.text.trim(), o.caseMode === 'upper' ? 'upper' : 'asis'), start: wd.start, end: wd.end }));
    if (o.caseMode === 'nodots' && tokens.length) {
      const last = tokens[tokens.length - 1];
      last.text = last.text.replace(/[.,;:]+$/, '');
    }
    tokens = tokens.filter((tk) => tk.text);
  } else {
    tokens = text.split(/\s+/).filter(Boolean).map((s) => ({ text: s }));
  }

  // перенос по ширине кадра
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [], lw = 0;
  for (const tk of tokens) {
    tk.w = ctx.measureText(tk.text).width;
    const add = (line.length ? space : 0) + tk.w;
    if (line.length && lw + add > maxW) { lines.push({ items: line, w: lw }); line = []; lw = 0; }
    lw += (line.length ? space : 0) + tk.w;
    line.push(tk);
  }
  if (line.length) lines.push({ items: line, w: lw });

  const cy = h * { bottom: vertical ? 0.7 : 0.84, middle: 0.5, top: vertical ? 0.22 : 0.14 }[o.place || 'bottom'];
  const totalH = lines.length * lh;
  let y = cy - totalH / 2 + lh / 2;

  if (o.look === 'box') {
    const padX = fs * 0.45, padY = fs * 0.22;
    const bw = Math.max(...lines.map((l) => l.w)) + padX * 2;
    const bh = totalH + padY * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    roundRect(ctx, w / 2 - bw / 2, cy - bh / 2, bw, bh, fs * 0.3);
    ctx.fill();
  }

  for (const l of lines) {
    let x = w / 2 - l.w / 2;
    for (const tk of l.items) {
      const active = o.look === 'accent' && tk.start != null && t >= tk.start && t < Math.max(tk.end, tk.start + 0.12);
      if (o.look !== 'box') {
        ctx.lineWidth = fs * 0.18;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(tk.text, x, y);
      }
      ctx.fillStyle = active ? ACCENT : '#fff';
      ctx.fillText(tk.text, x, y);
      x += tk.w + space;
    }
    y += lh;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
