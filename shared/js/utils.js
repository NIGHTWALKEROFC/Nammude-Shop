// shared/js/utils.js

// Generates a short, non-sequential, human-readable order code, e.g. SHOP-7K42P
// This code IS the Firestore document ID for the order (see checkout code
// in customer/js/app.js) - that's what lets a customer look up their order
// later using just this code, with no login needed.
export function generateOrderCode(prefix = "SHOP") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export function formatCurrency(amount, currency = "\u20B9") {
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
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (err) {
    // localStorage can throw in private-browsing modes or when full.
    console.warn("Could not save cart:", err.message);
  }
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ---------------------------------------------------------------
// FRIENDLY FIRESTORE / NETWORK ERROR MESSAGES
// ---------------------------------------------------------------
// Firestore errors carry a machine-readable `code` (e.g. "permission-denied",
// "unavailable"). Showing one generic "Something went wrong" message for
// every possible failure makes real problems (rules misconfigured, device
// offline, etc.) very hard to diagnose. This maps the common codes to a
// short, honest, user-facing sentence, and always logs the full error to
// the console for whoever is debugging.
export function describeError(err, t) {
  console.error(err);
  const code = err && err.code;
  switch (code) {
    case "permission-denied":
      return t("errorPermission");
    case "unavailable":
    case "network-request-failed":
      return t("errorOffline");
    case "deadline-exceeded":
      return t("errorTimeout");
    default:
      return t("errorGeneric");
  }
}
