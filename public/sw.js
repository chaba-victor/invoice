const CACHE_NAME = 'invoice-pwa-v2';
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/favicons/site.webmanifest',
  '/favicons/favicon.ico',
  '/favicons/favicon-32x32.png',
  '/favicons/favicon-16x16.png',
  '/favicons/apple-touch-icon.png',
  '/favicons/android-chrome-192x192.png',
  '/favicons/android-chrome-512x512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA: Service Worker static caching warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Skip non-GET requests and API calls from intercepting
  if (event.request.method !== 'GET' || requestUrl.pathname.startsWith('/api') || requestUrl.pathname.startsWith('/sanctum')) {
    return;
  }

  // Strategy for build assets (js, css, images): Cache-first falling back to Network
  if (requestUrl.pathname.startsWith('/build/') || requestUrl.pathname.startsWith('/favicons/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Strategy for HTML pages: Network-first falling back to Cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/').then((homeResponse) => {
            return homeResponse || caches.match('/offline.html');
          });
        });
      })
  );
});
