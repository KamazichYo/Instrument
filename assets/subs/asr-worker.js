// Распознавание речи (Whisper) прямо в телефоне. Модель скачивается один раз и кэшируется.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;
// несколько потоков — только если страница изолирована (см. sw.js), иначе один
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(2, Math.min(4, navigator.hardwareConcurrency || 4))
  : 1;

export const MODELS = {
  fast: 'onnx-community/whisper-base_timestamped',
  accurate: 'onnx-community/whisper-small_timestamped',
};

let asr = null;
let loadedId = null;

async function getASR(id, onProgress) {
  if (asr && loadedId === id) return asr;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; loadedId = null; }
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', MODELS[id], {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let a = 0, b = 0;
        for (const [l, t] of files.values()) { a += l; b += t; }
        onProgress(a / b, b);
      }
    },
  });
  loadedId = id;
  return asr;
}

self.onmessage = async (e) => {
  const { id, model, audio, windows } = e.data;
  const post = (m) => self.postMessage({ id, ...m });
  try {
    const run = await getASR(model, (p, total) =>
      post({ type: 'progress', stage: `Скачиваю модель распознавания (${Math.round(total / 1048576)} МБ, один раз)`, p }));
    const words = [];
    const todo = windows.filter((w) => !w.silent);
    for (let i = 0; i < todo.length; i++) {
      const w = todo[i];
      post({ type: 'progress', stage: 'Распознаю речь', p: i / todo.length });
      const out = await run(audio.subarray(w.a, w.b), {
        language: 'russian',
        task: 'transcribe',
        return_timestamps: 'word',
      });
      for (const c of out.chunks || []) {
        const [s, en] = c.timestamp;
        words.push({ text: c.text, start: w.start + (s ?? 0), end: w.start + (en ?? (s ?? 0) + 0.3) });
      }
      post({ type: 'partial', words });
    }
    post({ type: 'done', words });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
