/*
  The service worker, kept deliberately small.

  Its job is to make the app installable and to survive a dropped connection — not to be a cache layer.
  So the strategy is network-first everywhere, falling back to whatever was stored last. That costs a
  round trip that a cache-first worker would save, and buys the thing that actually matters during
  development: you never stare at a stale build wondering why your change did not appear.

  Two things are never touched. The API, because a cached feed is a wrong feed and this app already has
  a real-time channel telling it when to refetch. And the socket, which cannot be cached in any case.
*/
const VERSION = 'instagraph-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  // The new worker takes over on the next load rather than waiting for every tab to close.
  self.skipWaiting();

  event.waitUntil(caches.open(VERSION).then((cache) => cache.add(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that is not this origin, the API, or the hub is left entirely alone.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/hubs')) return;

  // A navigation always tries the network first and falls back to the stored shell, so a refresh
  // offline still opens the app rather than the browser's dinosaur.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(SHELL, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached ?? Response.error())),
    );

    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only complete, same-origin responses are worth keeping; a 206 or an opaque one is not.
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }

        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
