// shared/js/firebase-config.js
//
// You get these values from: Firebase Console -> Project Settings -> General
// -> "Your apps" -> Web app -> SDK setup and configuration.
//
// These values are NOT secret in the way a password is - they only tell
// the browser which Firebase project to talk to. Real protection comes
// from firebase/firestore.rules, not from hiding this file. It is safe
// to commit this file to GitHub.
// Never commit a service-account JSON file - that one IS secret.

export const firebaseConfig = {
  apiKey: "AIzaSyBgf9mNKgk1wXrd9VDPxWWul8Mr7dA9dQ0",
  authDomain: "localshop-website.firebaseapp.com",
  projectId: "localshop-website",
  storageBucket: "localshop-website.firebasestorage.app",
  messagingSenderId: "42171379357",
  appId: "1:42171379357:web:86bc42a7ebb263fe70ae74",
};

// The shop this deployment belongs to. If you ever host more than one shop
// from the same Firebase project, give each shop a different ID here and
// in Firestore under shops/{shopId}. For a single shop, "main" is fine.
export const SHOP_ID = "main";

// Product photo hosting (Cloudinary free tier - no billing card needed).
// Firebase Storage now requires the paid Blaze plan for every project
// (as of Feb 2026), so product images are uploaded to Cloudinary instead
// and only the resulting URL string is saved on the Firestore product doc.
export const CLOUDINARY_CLOUD_NAME = "retmgtrx";
export const CLOUDINARY_UPLOAD_PRESET = "n5rl1by4";

// ---------------------------------------------------------------
// NOTE ON PUSH NOTIFICATIONS
// ---------------------------------------------------------------
// This build has push notifications removed completely (Firebase Cloud
// Messaging, the Cloudflare push-relay Worker, VAPID keys, service-worker
// push handlers, and the /server folder). The site still has a full
// in-app "Notifications" tab backed by Firestore (shop announcements),
// it just no longer sends a phone popup when the app is closed. This
// removes a large amount of moving parts (a second server to deploy and
// pay attention to, background service-worker code, token bookkeeping)
// that was a common source of confusing failures.
