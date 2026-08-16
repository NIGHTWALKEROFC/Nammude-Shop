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
