importScripts('version.js');
const CACHE_NAME = `ultimate-paycheck-v${APP_VERSION}`;
const FILES_TO_CACHE = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'paycheck.js',
  'accounts.js',
  'debt.js',
  'savings.js',
  'manifest.json',
  'icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
   if (url.pathname.endsWith('app.js') || url.pathname.endsWith('styles.css') || url.pathname.endsWith('paycheck.js') || url.pathname.endsWith('accounts.js') || url.pathname.endsWith('debt.js') || url.pathname.endsWith('savings.js') || url.pathname.endsWith('index.html') || url.pathname === '/') {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});