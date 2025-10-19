import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  // Register the service worker as soon as the main script loads.
  // The script is deferred, so the DOM is ready. We use a relative path to ensure it loads from the correct origin.
  navigator.serviceWorker.register('/service-worker.js')
    .then(registration => {
      console.log('Service Worker registered successfully with scope:', registration.scope);
    })
    .catch(error => {
      console.error('Service Worker registration failed:', error);
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