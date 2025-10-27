// public/service-worker.js

// Define cache names for better management and versioning
const CACHE_VERSION = 'v4';
const APP_SHELL_CACHE_NAME = `kjmart-app-shell-${CACHE_VERSION}`; // For core app files
const STATIC_ASSETS_CACHE_NAME = `kjmart-static-assets-${CACHE_VERSION}`; // For fonts, styles from CDNs

// Core app files to be cached on install
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/metadata.json',
  '/icons/icon192.png',
  '/icons/icon512.png',
  
];

const ALL_CACHE_NAMES = [
  APP_SHELL_CACHE_NAME,
  STATIC_ASSETS_CACHE_NAME
];

// Install: Cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        // Cache URLs individually to make it more robust against single failures.
        const promises = APP_SHELL_URLS.map(url => {
            return cache.add(url).catch(err => {
                console.warn(`[SW] Failed to cache ${url}:`, err);
            });
        });
        return Promise.all(promises);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error("App shell caching failed:", err))
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // If the cache name is not in our current list of caches, delete it.
          if (!ALL_CACHE_NAMES.includes(cacheName)) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// A helper function to implement the Stale-While-Revalidate strategy
const staleWhileRevalidate = (request, cacheName) => {
  return caches.open(cacheName).then(cache => {
    return cache.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        // Check for a valid response to cache (e.g., status 200)
        // Opaque responses (type: 'opaque') from cross-origin requests have status 0, cache them too.
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(err => {
          console.warn(`Service Worker: Fetch failed for ${request.url}.`, err);
          // Re-throw the error to ensure the promise rejects if there's no cached response.
          throw err;
      });

      // Return cached response immediately if available, otherwise wait for the network.
      return cachedResponse || fetchPromise;
    });
  });
};

// Fetch: Apply caching strategies based on request type
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests and browser extension requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Ignore Firebase/Google Auth requests to let the SDKs handle them.
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com')) {
    return;
  }
  
  // Strategy for Google Fonts, Tailwind, and other CDNs: Stale-While-Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'aistudiocdn.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC_ASSETS_CACHE_NAME));
    return;
  }

  // Strategy for navigation requests: Network first, falling back to cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => {
            console.log('Service Worker: Serving navigation request from cache for offline access.');
            return caches.match('/index.html'); // Serve the main HTML shell from cache
        })
    );
    return;
  }

  // Default Strategy for app's own assets (JS, CSS, etc.): Stale-While-Revalidate
  // This ensures even pre-cached assets get updated in the background.
  event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE_NAME));
});