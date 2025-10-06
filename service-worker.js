
const CACHE_NAME = 'kjmart-app-cache-v1';
// This list includes the essential files for the app shell to work offline.
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/metadata.json',
  '/index.tsx',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
  'https://cdn.tailwindcss.com',
  'https://ga.jspm.io/npm:es-module-shims@1.10.0/dist/es-module-shims.js'
];

/**
 * Install event: Caches the application shell.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        // Add all URLs to cache. This is atomic; if one file fails, the whole cache operation fails.
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

/**
 * Activate event: Cleans up old caches.
 */
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

/**
 * Fetch event: Serves content from cache, falling back to the network.
 * This is a "Cache First" strategy.
 */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache - fetch from network
        return fetch(event.request).then(
          (response) => {
            // Check if we received a valid response
            // We don't cache non-GET requests, or opaque responses (e.g., from third-party CDNs without CORS)
            if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET') {
              return response;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});
