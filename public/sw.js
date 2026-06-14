// Minimal service worker for BatchPort.
//
// This exists so the browser treats the app as installable and shows the PWA
// install prompt. It is intentionally a pass-through: every request goes
// straight to the network. Offline caching is planned for a later version.

self.addEventListener("install", () => {
  // Activate this worker as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of open clients without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through: do not call event.respondWith, so the browser performs its
  // normal network fetch. A registered fetch handler is what makes the app
  // installable.
});
