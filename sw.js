// Офлайн-режим: сначала сеть (всегда свежая версия), без сети — из кэша.
const CACHE = 'instrument-v2';
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
