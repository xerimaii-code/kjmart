// public/service-worker.js

// 빌드 시 vite.config.ts의 autoServiceWorkerVersionPlugin이 아래 CACHE_VERSION을 자동으로 최신 타임스탬프로 치환합니다.
const CACHE_VERSION = 'v1.41';
const APP_SHELL_CACHE_NAME = `kjmart-app-shell-${CACHE_VERSION}`;
const STATIC_ASSETS_CACHE_NAME = `kjmart-static-assets-${CACHE_VERSION}`;

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

// Install: Cache the app shell (Do NOT skipWaiting automatically; wait for user confirmation or next foreground)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE_NAME)
      .then(cache => {
        const promises = APP_SHELL_URLS.map(url => {
            return cache.add(new Request(url, { cache: 'reload' })).catch(err => {
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

const staleWhileRevalidate = (request, cacheName) => {
  return caches.open(cacheName).then(cache => {
    return cache.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(err => {
          throw err;
      });

      return cachedResponse || fetchPromise;
    });
  });
};

// HTML Navigation 전용 Network-First 전략 (온라인 시 항상 최신 index.html 확보, 오프라인 시 캐시 폴백)
const networkFirstNavigation = (request, cacheName) => {
  return caches.open(cacheName).then(cache => {
    return fetch(request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })
      .catch(() => {
        return cache.match(request).then(cached => cached || cache.match('/index.html') || cache.match('/'));
      });
  });
};

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com') || url.pathname.startsWith('/api/') || url.pathname.endsWith('/version.json')) {
    return;
  }
  
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'aistudiocdn.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC_ASSETS_CACHE_NAME));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request, APP_SHELL_CACHE_NAME));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE_NAME));
});
