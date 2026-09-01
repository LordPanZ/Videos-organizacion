/*
 * Offline support for Videoteca.
 *
 * Two caches with different jobs: the app shell, which must survive going
 * offline and update when a new build ships, and thumbnails, which come from
 * other origins as opaque responses and simply need to stick around.
 */
const SHELL_CACHE = 'videoteca-shell-v2';
const IMAGE_CACHE = 'videoteca-img-v1';
const IMAGE_LIMIT = 600;

self.addEventListener('install', (event) => {
  // Take over as soon as the new worker is ready rather than waiting for every
  // tab to close: a phone rarely closes its tabs.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== IMAGE_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Keeps the image cache from growing without bound on a phone. */
async function trimImages() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= IMAGE_LIMIT) return;
  // Oldest first: the cache preserves insertion order.
  await Promise.all(keys.slice(0, keys.length - IMAGE_LIMIT).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Thumbnails: serve from cache when present, otherwise fetch and keep a copy.
  // These are opaque cross-origin responses, which is fine for an <img>.
  if (request.destination === 'image') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const response = await fetch(request, { mode: 'no-cors' });
          void cache.put(request, response.clone()).then(trimImages);
          return response;
        } catch {
          // Offline and never seen: let the interface show its placeholder.
          return Response.error();
        }
      })(),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigation: try the network so a new build is picked up, fall back to the
  // cached shell when there is no connection.
  //
  // `cache: 'reload'` skips the browser's own HTTP cache. Without it the page
  // that names which script to load can be served stale for as long as its
  // max-age says, which pins the app to an old build even though the worker
  // asked the network for it.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request, { cache: 'reload' });
          const cache = await caches.open(SHELL_CACHE);
          void cache.put('./index.html', response.clone());
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Scripts, styles and fonts: serve fast from cache, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    })(),
  );
});
