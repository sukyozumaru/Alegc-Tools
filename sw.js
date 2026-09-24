// Alegc Tools · Service Worker
// Cachea los archivos estáticos y permite funcionar offline.

const CACHE_VERSION = 'alegc-v2.2.0';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// INSTALL: precachear archivos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('Precache parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ACTIVATE: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('alegc-') && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH: estrategia según el tipo de recurso
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo GET
  if (event.request.method !== 'GET') return;

  // No interceptar la API de IA (siempre red)
  if (url.pathname.startsWith('/api/')) return;

  // No interceptar extensiones de Chrome ni recursos externos raros
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin && !url.hostname.includes('fonts.g')) return;

  // HTML: network first (fallback a caché si offline)
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => {
          return caches.match(event.request).then((r) => r || caches.match('/index.html'));
        })
    );
    return;
  }

  // Fuentes y estáticos: cache first
  if (url.hostname.includes('fonts.g') || url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|webp|woff2?|ttf)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }
});