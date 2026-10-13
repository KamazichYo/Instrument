// Тяжёлая обработка — в отдельном потоке, чтобы интерфейс не зависал.
import { processVoice, encodeWav } from './dsp.js';

self.onmessage = (e) => {
  const { channels, sampleRate, settings } = e.data;
  try {
    let last = 0;
    const res = processVoice(channels, sampleRate, settings, (stage, p) => {
      const now = Date.now();
      if (now - last > 80 || p >= 1) {
        last = now;
        self.postMessage({ type: 'progress', stage, p });
      }
    });
    const wav = encodeWav(res.output, sampleRate);
    self.postMessage(
      { type: 'done', output: res.output, wav, removed: res.removed, stats: res.stats },
      [res.output.buffer, wav],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
