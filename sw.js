// Офлайн-режим: сначала сеть (всегда свежая версия), без сети — из кэша.
const CACHE = 'instrument-v5';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app.css',
  'audio/',
  'audio/index.html',
  'assets/audio/app.js',
  'assets/audio/dsp.js',
  'assets/audio/worker.js',
  'assets/audio/ai.js',
  'assets/vendor/deepfilternet/df.js',
  'assets/shared/handoff.js',
  'subtitles/',
  'subtitles/index.html',
  'assets/subs/app.js',
  'assets/subs/cues.js',
  'assets/subs/asr-worker.js',
  'assets/subs/render.js',
  'assets/subs/burn.js',
  'assets/vendor/mediabunny/mediabunny.min.mjs',
  'icons/icon-180.png',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// «Субтитры» работают в режиме cross-origin isolation: тогда распознавание речи
// считает в несколько потоков (~1.5× быстрее). GitHub Pages не умеет ставить заголовки —
// добавляем их здесь. Если не сработает, распознавание просто идёт в один поток.
const isolate = (url) => url.pathname.includes('/subtitles/') || url.pathname.endsWith('/assets/subs/asr-worker.js');
function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Большие ИИ-модели кэширует сама страница (Cache Storage) — здесь не трогаем
  if (url.pathname.endsWith('.wasm') || url.pathname.endsWith('.onnx')) return;
  const iso = isolate(url);
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return iso ? withIsolation(res) : res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => (iso ? withIsolation(r) : r))),
  );
});
