// Minimal service worker for PWA install eligibility.
// No caching strategy — the portal is online-only by design.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-only. No offline support intended.
  // The fetch listener is required for PWA install eligibility.
});
