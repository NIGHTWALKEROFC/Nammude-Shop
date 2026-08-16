// customer/sw.js
// Deliberately minimal: caches only the static app shell so the site opens
// instantly and works offline for browsing the last-seen catalog. Firestore
// data itself is NOT cached here — Firestore's own SDK already caches reads
// and stays in sync when the connection returns, so duplicating that logic
// here would only add bugs and stale-data risk.

const CACHE_NAME = "shop-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
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
  // Network-first for navigation requests (so updates show up quickly),
  // cache-first for static shell assets (so it's fast and works offline).
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
