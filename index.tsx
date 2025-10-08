import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    // Use an absolute URL based on the current origin to prevent cross-origin errors.
    const swUrl = `${window.location.origin}/service-worker.js`;
    navigator.serviceWorker.register(swUrl)
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  }
};

// --- PWA Service Worker Registration ---
// This enables the app to be installable and provides offline capabilities.
// To robustly handle "invalid state" errors, registration is deferred
// until the document is fully loaded.
if (document.readyState === 'complete') {
  registerServiceWorker();
} else {
  window.addEventListener('load', registerServiceWorker);
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