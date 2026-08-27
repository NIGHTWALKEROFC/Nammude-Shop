// shared/js/utils.js

// Generates a short, non-sequential, human-readable order code, e.g. SHOP-7K42P
// This code IS the Firestore document ID for the order (see checkout code
// in customer/js/app.js) — that's what lets a customer look up their order
// later using just this code, with no login needed.
export function generateOrderCode(prefix = "SHOP") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export function formatCurrency(amount, currency = "₹") {
  const n = Number(amount) || 0;
  return `${currency}${n.toFixed(2).replace(/\.00$/, "")}`;
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Very small localStorage-backed cart store shared by app.js
const CART_KEY = "shop_cart";

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ---------------------------------------------------------------
// PUSH RELAY (new) — fires the Cloudflare Worker so a just-created order
// or announcement is delivered as a real phone notification immediately.
// Used by both customer/js/app.js (after placing an order) and
// admin/js/app.js (after sending an announcement, and once on login to
// "catch up" on anything that failed to send earlier).
//
// This NEVER throws and never blocks the caller — push delivery is a
// nice-to-have. The in-app Notifications/Orders tabs and the order itself
// are already saved in Firestore regardless of whether this succeeds.
// ---------------------------------------------------------------
export async function triggerPushRelay(relayUrl, relayKey, type, shopId, id) {
  if (!relayUrl || relayUrl.includes("YOUR-SUBDOMAIN")) return; // relay not deployed yet — silently skip
  try {
    await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relay-Key": relayKey },
      body: JSON.stringify({ type, shopId, id }),
    });
  } catch (err) {
    console.warn("Push relay call failed (still saved in Firestore, just not pushed to phones):", err.message);
  }
}
