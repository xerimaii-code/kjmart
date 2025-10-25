import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  // Defer registration until after the page has loaded to avoid race conditions.
  window.addEventListener('load', () => {
    // FIX: Construct an absolute URL for the service worker to prevent same-origin policy errors in sandboxed environments
    // where the document's base URI might be different from its actual origin.
    const swUrl = new URL('/service-worker.js', window.location.origin).href;
    navigator.serviceWorker.register(swUrl)
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  });
}
// --- End of Service Worker Registration ---

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);