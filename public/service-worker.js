const CACHE_NAME = 'kjmart-app-cache-v3'; // Bump version to force update.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/metadata.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
  // External assets are not pre-cached to prevent installation failure if offline.
  // They will be cached on the first fetch.
];

/**
 * Install event: Caches the application shell and static assets.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

/**
 * Activate event: Cleans up old caches and takes control of the page.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Fetch event: Implements caching strategies for offline functionality and performance.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // For SPA navigation, use a Network-first strategy.
  // This ensures the user gets the latest HTML, but the app still loads offline from cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // If the network request is successful, clone it, cache it, and return it.
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If the network fails, serve the main app page from the cache.
          return caches.match('/index.html');
        })
    );
    return;
  }

  // For all other requests (JS, CSS, images, fonts), use a Stale-While-Revalidate strategy.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      
      // Fetch from the network in the background to update the cache.
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          // Check for a valid response to cache.
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(err => {
          // Network failed. This is expected when offline.
          // If there was no cached response, this error will propagate.
          console.warn(`Service Worker: Network request for ${request.url} failed.`, err);
          // We must re-throw if there's no cached version,
          // so the browser knows the request failed.
          if (!cachedResponse) {
            throw err;
          }
        });

      // Return the cached response immediately if available, otherwise wait for the network.
      return cachedResponse || fetchPromise;
    })
  );
});
