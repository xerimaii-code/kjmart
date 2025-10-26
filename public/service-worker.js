// A minimal, no-op service worker that exists only to satisfy PWA criteria.
// It allows the app to be installed ("Add to Home Screen") and run in standalone mode.
// It performs no caching and will not interfere with network requests.

self.addEventListener('install', (event) => {
  // Using skipWaiting() ensures the new service worker activates immediately.
  self.skipWaiting(); 
  console.log('Service Worker: Installed (No-Op)');
});

self.addEventListener('activate', (event) => {
  // Take control of the page immediately.
  event.waitUntil(self.clients.claim());
  console.log('Service Worker: Activated (No-Op)');
});

self.addEventListener('fetch', (event) => {
  // Do nothing. The browser will handle the request as if there were no service worker.
  // This is the default behavior when event.respondWith() is not called.
});
