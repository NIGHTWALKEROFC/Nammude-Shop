// customer/sw.js
//
// IMPORTANT — this file now does TWO jobs on purpose:
//   1. Offline app-shell caching (what it always did)
//   2. Firebase Cloud Messaging background push (moved here from the old
//      separate customer/firebase-messaging-sw.js)
//
// WHY THEY WERE MERGED:
// A service worker's "scope" is derived from the folder it lives in unless
// you pass an explicit {scope} option. Both sw.js and firebase-messaging-sw.js
// used to live in /customer/ with no explicit scope, so they were BOTH
// registered at the same scope. In the Service Worker spec a scope maps to
// ONE registration — registering a second script at that same scope updates
// the existing registration to point at the new script. In practice this
// meant whichever one was registered/updated LAST silently became the only
// active worker, and the other one's job (offline caching, or push) stopped
// happening — intermittently, depending on registration timing. This is why
// push notifications worked sometimes but not reliably as a phone popup.
// Having exactly one service worker file for the whole site removes the
// conflict entirely.
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
// Offline app-shell caching (unchanged behaviour from before)
// ---------------------------------------------------------------
const CACHE_NAME = "shop-shell-v2";
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
