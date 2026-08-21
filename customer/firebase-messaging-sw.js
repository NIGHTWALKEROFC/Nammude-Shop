// customer/firebase-messaging-sw.js
//
// NO LONGER USED — kept only so nothing 404s if something old still
// references it. Its job (Firebase Cloud Messaging background push) was
// merged into customer/sw.js to fix a service-worker scope conflict that
// was silently breaking background push notifications (see the long
// comment at the top of customer/sw.js for the full explanation).
//
// customer/js/app.js no longer registers this file. You can safely delete
// it from the repo once you've confirmed push notifications are working.

// Intentionally empty.
