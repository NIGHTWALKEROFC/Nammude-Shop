// admin/firebase-messaging-sw.js
// Same idea as customer/firebase-messaging-sw.js, duplicated here because a
// service worker only receives push events for pages under its own folder.
// Keep the config values identical to shared/js/firebase-config.js.

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
  const title = payload.notification?.title || "New order";
  self.registration.showNotification(title, {
    body: payload.notification?.body || "",
    icon: "../customer/icons/icon-192.png",
    data: payload.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("./"));
});
