// The PWA service worker has been retired (see docs/desktop-plan.md, Phase 2).
// Browsers that registered the old worker keep running it until an update replaces it,
// so this replacement clears its caches and unregisters itself.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  )
})
