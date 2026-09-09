const CACHE = 'kingdom-nexus-v3';
const SHELL = ['/', '/styles.css', '/auth-ui.js', '/app.js', '/manifest.webmanifest', '/icon.svg', '/tv', '/tv.css', '/tv.js'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/health') return;
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => null);
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
});
