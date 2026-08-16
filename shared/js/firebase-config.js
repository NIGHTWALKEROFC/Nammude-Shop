// shared/js/firebase-config.js
//
// PASTE YOUR OWN FIREBASE PROJECT CONFIG HERE.
// You get these values from: Firebase Console → Project Settings → General
// → "Your apps" → Web app → SDK setup and configuration.
//
// These values are NOT secret in the way a password is - they only tell
// the browser which Firebase project to talk to. Real protection comes
// from firebase/firestore.rules and firebase/storage.rules, not from
// hiding this file. It is safe to commit this file to GitHub.
// Never commit a service-account JSON file - that one IS secret.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Used only for Web Push (Firebase Cloud Messaging).
// Firebase Console → Project Settings → Cloud Messaging → Web configuration
// → "Web Push certificates" → Generate key pair.
export const VAPID_KEY = "YOUR_VAPID_PUBLIC_KEY";

// The shop this deployment belongs to. If you ever host more than one shop
// from the same Firebase project, give each shop a different ID here and
// in Firestore under shops/{shopId}. For a single shop, "main" is fine.
export const SHOP_ID = "main";
