const CACHE_NAME = 'storage-bridge-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './css/tokens.css',
  './css/layout.css',
  './css/sidebar.css',
  './css/file-browser.css',
  './css/upload.css',
  './css/components.css',
  './js/app.js',
  './js/state.js',
  './js/serial.js',
  './js/router.js',
  './js/utils/constants.js',
  './js/utils/base64.js',
  './js/utils/format.js',
  './js/utils/dom.js',
  './js/components/sidebar.js',
  './js/components/file-browser.js',
  './js/components/toolbar.js',
  './js/components/upload.js',
  './js/components/transfer-progress.js',
  './js/components/toast.js',
  './js/components/dialog.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
