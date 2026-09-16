// customer/sw.js
//
// Offline app-shell caching ONLY. Push notifications (Firebase Cloud
// Messaging) have been removed from this build entirely, so this service
// worker no longer imports firebase-messaging, registers a background
// message handler, or handles notification clicks.
//
// Cache-first for same-origin GET requests, with runtime caching so pages
// visited after the first load also work offline. Cross-origin requests
// (Firestore, Cloudinary, Google Fonts) are always left to the network -
// this is purely an app-shell cache, not a generic proxy.
//
// Bump CACHE_NAME whenever a cached file's content changes, so returning
// visitors pick up the update instead of being stuck on an old cached copy.
const CACHE_NAME = "shop-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "../shared/js/firebase-config.js",
  "../shared/js/i18n.js",
  "../shared/js/utils.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline and never cached - nothing more we can do for this request
    })
  );
});
