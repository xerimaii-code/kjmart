import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  // Use the window load event to keep the page load performant and ensure the document is in a valid state.
  window.addEventListener('load', () => {
    const swUrl = `${window.location.origin}/service-worker.js`;
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