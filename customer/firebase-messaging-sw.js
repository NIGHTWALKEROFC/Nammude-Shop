// customer/firebase-messaging-sw.js
//
// Firebase Cloud Messaging requires this exact file name and requires it to
// be a classic script (service workers can't reliably use ES module imports
// across all browsers yet), so it cannot simply `import` shared/js/firebase-config.js.
//
// IMPORTANT: keep the values below identical to shared/js/firebase-config.js.
// This only handles notifications that arrive while the site is closed or
// in the background — foreground notifications are handled in app.js.

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

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Shop update";
  const options = {
    body: payload.notification?.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("./"));
});
