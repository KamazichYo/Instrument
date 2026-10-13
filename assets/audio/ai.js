// ИИ-очистка голоса: DeepFilterNet3 (WASM). Работает только в 48 кГц.
// Модель (34 МБ) скачивается один раз и хранится в Cache Storage телефона.
import { DeepFilter } from '../vendor/deepfilternet/df.js';

const WASM_URL = new URL('../vendor/deepfilternet/df_bg.wasm', import.meta.url).href;
const CACHE = 'instrument-models-v1';

let dfPromise = null;

async function fetchWithProgress(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch {}
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось скачать ИИ-модель (' + res.status + ')');
  const total = Number(res.headers.get('Content-Length')) || 34135648;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress && onProgress(Math.min(1, got / total));
  }
  const buf = await new Blob(parts).arrayBuffer();
  if (cache) {
    try {
      await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/wasm' } }));
    } catch {}
  }
  return buf;
}

export function loadDeepFilter(onProgress) {
  if (!dfPromise) {
    dfPromise = (async () => {
      const buf = await fetchWithProgress(WASM_URL, onProgress);
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/wasm' }));
      try {
        return await DeepFilter.create({ wasmUrl: blobUrl });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();
    dfPromise.catch(() => { dfPromise = null; });
  }
  return dfPromise;
}

// Возвращает очищенный сигнал той же длины, выровненный по времени с исходником
// (у нейросети задержка 3 кадра = 30 мс — компенсируем, чтобы звук не разъехался с видео).
export function enhance(df, x, atten, beta, onProgress) {
  df.setAttenuationLimit(atten);
  df.setPostFilterBeta(beta);
  const L = df.frameLength;
  const delay = 3 * L;
  const fr = new Float32Array(L);
  // сброс состояния после предыдущего файла: прогоняем немного тишины
  for (let i = 0; i < 30; i++) df.process(fr);
  const out = new Float32Array(x.length);
  const total = x.length + delay;
  const step = Math.max(L, Math.floor(total / 100 / L) * L);
  for (let i = 0; i < total; i += L) {
    fr.fill(0);
    if (i < x.length) fr.set(x.subarray(i, Math.min(i + L, x.length)));
    const y = df.process(fr);
    const base = i - delay;
    for (let j = 0; j < L; j++) {
      const k = base + j;
      if (k >= 0 && k < x.length) out[k] = y[j];
    }
    if (onProgress && i % step < L) onProgress(i / total);
  }
  return out;
}
