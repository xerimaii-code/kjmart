// public/service-worker.js

// Define cache names for better management and versioning
const CACHE_VERSION = 'v1.40'; // Version bumped for unified PWA & product master update
const APP_SHELL_CACHE_NAME = `kjmart-app-shell-${CACHE_VERSION}`; // For core app files
const STATIC_ASSETS_CACHE_NAME = `kjmart-static-assets-${CACHE_VERSION}`; // For fonts, styles from CDNs

// Core app files to be cached on install
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/metadata.json',
  '/icons/icon192.png',
  '/icons/icon512.png'
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
        const promises = APP_SHELL_URLS.map(url => {
            return cache.add(url).catch(err => {
                console.warn(`[SW] Failed to cache ${url}:`, err);
            });
        });
        return Promise.all(promises);
      })
      .catch(err => console.error("App shell caching failed:", err))
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!ALL_CACHE_NAMES.includes(cacheName)) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Listen for the SKIP_WAITING message from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// A helper function to implement the Stale-While-Revalidate strategy
const staleWhileRevalidate = (request, cacheName) => {
  return caches.open(cacheName).then(cache => {
    return cache.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(err => {
          console.warn(`Service Worker: Fetch failed for ${request.url}.`, err);
          throw err;
      });

      return cachedResponse || fetchPromise;
    });
  });
};

// Fetch: Apply caching strategies based on request type
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Ignore Firebase/Google Auth/API requests to let the SDKs handle them.
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com') || url.pathname.startsWith('/api/')) {
    return;
  }
  
  // Strategy for Google Fonts, Tailwind, ZXing (jsdelivr), and other CDNs: Stale-While-Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'aistudiocdn.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC_ASSETS_CACHE_NAME));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE_NAME));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE_NAME));
});
