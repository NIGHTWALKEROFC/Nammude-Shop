// customer/sw.js
//
// IMPORTANT — this file does TWO jobs on purpose:
//   1. Offline app-shell caching
//   2. Firebase Cloud Messaging background push (moved here from the old
//      separate customer/firebase-messaging-sw.js)
//
// WHY THEY'RE MERGED:
// A service worker's "scope" is derived from the folder it lives in unless
// you pass an explicit {scope} option. Both sw.js and firebase-messaging-sw.js
// used to live in /customer/ with no explicit scope, so they were BOTH
// registered at the same scope. In the Service Worker spec a scope maps to
// ONE registration — registering a second script at that same scope updates
// the existing registration to point at the new script. Whichever one was
// registered/updated LAST silently became the only active worker, and the
// other one's job stopped happening intermittently. One service worker for
// the whole site removes the conflict entirely.
//
// FIX IN THIS VERSION (real bug): the old fetch handler only ever served
// what was in APP_SHELL — anything fetched later (shared/js modules, the
// shop logo, product images) was fetched from the network every time and
// NEVER cached, so returning users offline only ever got the 5 original
// files, not a working app. The fetch handler below now also stores
// same-origin responses into the cache the first time they're fetched
// ("runtime caching"), so offline mode keeps working as you browse more
// of the site.
//
// Keep the Firebase config values identical to shared/js/firebase-config.js.

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBgf9mNKgk1wXrd9VDPxWWul8Mr7dA9dQ0",
  authDomain: "localshop-website.firebaseapp.com",
  projectId: "localshop-website",
  storageBucket: "localshop-website.firebasestorage.app",
  messagingSenderId: "42171379357",
  appId: "1:42171379357:web:86bc42a7ebb263fe70ae74",
});

// Guard: getting the messaging instance can throw in browsers without push
// support (e.g. some in-app webviews). Never let that break the offline
// caching below.
let messaging = null;
try {
  messaging = firebase.messaging();
} catch (err) {
  // Push just won't be available in this browser — caching still works.
}

if (messaging) {
  // Fires only when the site is closed or in the background. Foreground
  // messages (site open + tab focused) are handled by onMessage() in app.js.
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Shop update";
    const options = {
      body: payload.notification?.body || "",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: payload.data || {},
      tag: payload.data?.tag || "shop-update", // collapses rapid duplicate pushes into one
    };
    self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("./"));
});

// ---------------------------------------------------------------
// Offline app-shell caching
// ---------------------------------------------------------------
// Bumped v3 -> v4: customer/index.html and customer/css/style.css both
// changed in this update (new cart summary rows, reorder button, overflow
// fix). Without bumping this, anyone who already visited/installed the
// app would keep being served the OLD cached versions of these files.
const CACHE_NAME = "shop-shell-v4";
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
  // Never try to cache cross-origin calls (Firestore, Cloudinary, Google
  // Fonts) — this is purely an app-shell cache, not a generic proxy.
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
        .catch(() => cached); // offline and never cached — nothing more we can do for this request
    })
  );
});
