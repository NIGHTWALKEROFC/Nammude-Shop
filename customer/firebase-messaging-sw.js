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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
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
