// Тяжёлая обработка — в отдельном потоке, чтобы интерфейс не зависал.
import { processVoice, encodeWav } from './dsp.js';
import { loadDeepFilter, enhance } from './ai.js';

self.onmessage = async (e) => {
  const { id, channels, sampleRate, settings, wav: wantWav = true } = e.data;
  let last = 0;
  const progress = (stage, p) => {
    const now = Date.now();
    if (now - last > 80 || p >= 1) {
      last = now;
      self.postMessage({ type: 'progress', id, stage, p });
    }
  };
  try {
    const opts = {};
    if (settings.ai > 0) {
      if (sampleRate !== 48000) throw new Error('ИИ работает только с 48 кГц');
      const df = await loadDeepFilter((p) => progress('Скачиваю ИИ-модель (34 МБ, один раз)', p));
      opts.enhance = (x, onP) => enhance(df, x, settings.ai, settings.aiBeta || 0, onP);
    }
    const res = processVoice(channels, sampleRate, settings, progress, opts);
    const wav = wantWav ? encodeWav(res.output, sampleRate) : null;
    self.postMessage(
      { type: 'done', id, output: res.output, wav, removed: res.removed, stats: res.stats },
      wav ? [res.output.buffer, wav] : [res.output.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};
