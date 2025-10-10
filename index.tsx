import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    // Construct the full URL to the service worker to avoid any potential
    // ambiguity or misinterpretation by the browser in specific environments.
    // This explicitly tells the browser to load the worker from the current origin.
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

// To prevent "invalid state" errors, service worker registration must
// happen after the page has finished loading. This code checks if the
// document is already loaded ('complete'). If so, it registers the worker
// immediately. Otherwise, it waits for the 'load' event. This is a more
// robust approach than just listening for the 'load' event, as it handles
// cases where the event might have already fired before the script runs.
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