import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
// This function will be called once the page is fully loaded.
const registerServiceWorker = () => {
  // Check if the browser supports service workers.
  if ('serviceWorker' in navigator) {
    // Construct the full URL to the service worker to ensure it's resolved correctly.
    const swUrl = `${window.location.origin}/service-worker.js`;
    navigator.serviceWorker.register(swUrl)
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
      })
      .catch(error => {
        // Log any errors that occur during registration.
        console.error('Service Worker registration failed:', error);
      });
  }
};

// We wrap the registration in a 'load' event listener. This is the most reliable
// way to ensure that the registration attempt doesn't happen prematurely,
// which is the cause of the "invalid state" error.
window.addEventListener('load', registerServiceWorker);
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