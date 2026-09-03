// Cacht nur die Programmoberflaeche, damit die Booth auch bei kurzem
// WLAN-Aussetzer startet. Fotos und API-Antworten werden nie gecacht.
const CACHE = 'fotobox-v2';
const SHELL = [
  '/',
  '/css/booth.css',
  '/css/admin.css',
  '/js/booth.js',
  '/js/admin.js',
  '/js/camera.js',
  '/js/filters.js',
  '/js/strip.js',
  '/js/sound.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const bypass =
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.startsWith('/p/');
  if (bypass) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  );
});
