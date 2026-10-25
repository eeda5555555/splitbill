// Cache-first so the app (OCR engine and language data included) works with no connection.
// Bump VERSION whenever any file changes, otherwise phones keep serving the old copy.
const VERSION = 'split-v2';
const ASSETS = [
  './', 'index.html', 'app.js', 'core.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/tesseract.min.js', 'vendor/worker.min.js',
  'vendor/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract-core-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz', 'vendor/lang/ind.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
