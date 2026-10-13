// Тяжёлая обработка — в отдельном потоке, чтобы интерфейс не зависал.
import { processVoice, encodeWav } from './dsp.js';

self.onmessage = (e) => {
  const { id, channels, sampleRate, settings, wav: wantWav = true } = e.data;
  try {
    let last = 0;
    const res = processVoice(channels, sampleRate, settings, (stage, p) => {
      const now = Date.now();
      if (now - last > 80 || p >= 1) {
        last = now;
        self.postMessage({ type: 'progress', id, stage, p });
      }
    });
    const wav = wantWav ? encodeWav(res.output, sampleRate) : null;
    self.postMessage(
      { type: 'done', id, output: res.output, wav, removed: res.removed, stats: res.stats },
      wav ? [res.output.buffer, wav] : [res.output.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
  }
};
