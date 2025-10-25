import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
// Only register the service worker in production builds to avoid conflicts with the dev server.
// FIX: Cast 'import.meta' to 'any' to resolve the TypeScript error 'Property 'env' does not exist on type 'ImportMeta''.
if ((import.meta as any).env && (import.meta as any).env.PROD && 'serviceWorker' in navigator) {
  // Defer registration until after the page has loaded to avoid race conditions.
  window.addEventListener('load', () => {
    // Use a standard relative path for the service worker. This is more robust
    // than constructing an absolute URL, which can fail in sandboxed environments.
    navigator.serviceWorker.register('/service-worker.js')
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