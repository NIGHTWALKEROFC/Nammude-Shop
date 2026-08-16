// customer/js/app.js
// Vanilla JS, no build step, no framework — kept deliberately small so the
// site stays fast on older/cheaper phones and uses as little Firestore
// bandwidth as possible.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, onSnapshot,
  query, orderBy, limit, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage, isSupported as messagingIsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

import { firebaseConfig, VAPID_KEY, SHOP_ID } from "../../shared/js/firebase-config.js";
import { t, getLang, setLang, applyTranslations } from "../../shared/js/i18n.js";
import { generateOrderCode, formatCurrency, debounce, getCart, saveCart, clearCart } from "../../shared/js/utils.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let categories = [];
let products = [];
let activeCategory = "all";
let searchTerm = "";
let shopData = {};

// ---------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  show(el);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => hide(el), 2600);
}

// =================================================================
// STEP 1 — LANGUAGE
// =================================================================
function initLanguageStep() {
  const saved = localStorage.getItem("shop_lang");
  $$(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".lang-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      setLang(btn.dataset.lang);
      applyTranslations();
    });
  });

  if (saved) {
    // Returning visitor: skip straight past onboarding into the app.
    applyTranslations();
    goToApp();
    return;
  }

  // Default to English selected.
  $(`.lang-btn[data-lang="en"]`).classList.add("selected");
  applyTranslations();

  $("#btn-lang-continue").addEventListener("click", () => {
    hide($("#screen-language"));
    show($("#screen-addhome"));
  });
}

// =================================================================
// STEP 2 — ADD TO HOME SCREEN
// =================================================================
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function initAddHomeStep() {
  $("#btn-add-home").addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else {
      // iOS Safari / unsupported browsers have no automatic prompt.
      toast(
        getLang() === "ml"
          ? "Share ബട്ടൺ → 'Add to Home Screen' തിരഞ്ഞെടുക്കുക"
          : "Tap Share → 'Add to Home Screen'"
      );
    }
    goToNotifyStep();
  });
  $("#btn-add-home-skip").addEventListener("click", goToNotifyStep);
}

function goToNotifyStep() {
  hide($("#screen-addhome"));
  show($("#screen-notify"));
}

// =================================================================
// STEP 3 — NOTIFICATIONS
// =================================================================
function initNotifyStep() {
  $("#btn-enable-notify").addEventListener("click", async () => {
    await enablePushNotifications();
    goToApp();
  });
  $("#btn-notify-skip").addEventListener("click", goToApp);
}

async function enablePushNotifications() {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") return; // respect the browser setting, never bypass it
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const supported = await messagingIsSupported().catch(() => false);
    if (!supported) return;

    const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!fcmToken) return;

    // Store the subscription so the shop can notify this device later.
    // Document ID = the token itself, so re-subscribing just overwrites (no duplicates, no extra reads).
    await setDoc(doc(db, "notificationSubscriptions", fcmToken), {
      shopId: SHOP_ID,
      lang: getLang(),
      platform: navigator.platform || "web",
      updatedAt: serverTimestamp(),
    });

    onMessage(messaging, (payload) => {
      toast(payload.notification?.title || t("notifications"));
    });
  } catch (err) {
    console.warn("Push setup skipped:", err.message);
  }
}

// =================================================================
// GO TO MAIN APP
// =================================================================
function goToApp() {
  $$(".screen").forEach(hide);
  show($("#app"));
  $("#btn-lang-switch").textContent = getLang().toUpperCase();
  loadShop();
  loadCategories();
  loadProducts();
  loadNotifications();
  renderCart();
}

// =================================================================
// SHOP INFO
// =================================================================
async function loadShop() {
  onSnapshot(doc(db, "shops", SHOP_ID), (snap) => {
    if (!snap.exists()) return;
    shopData = snap.data();
    $("#shop-name").textContent = shopData.name || "Shop";
    if (shopData.logoUrl) $("#shop-logo").src = shopData.logoUrl;
    const pill = $("#shop-status");
    const open = shopData.isOpen !== false;
    pill.textContent = open ? t("open") : t("closed");
    pill.classList.toggle("closed", !open);
  });
}

// =================================================================
// CATEGORIES
// =================================================================
function loadCategories() {
  const q = query(collection(db, "shops", SHOP_ID, "categories"), orderBy("order", "asc"));
  onSnapshot(q, (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategoryNav();
  });
}

function renderCategoryNav() {
  const nav = $("#category-nav");
  const lang = getLang();
  nav.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "category-chip" + (activeCategory === "all" ? " active" : "");
  allChip.textContent = t("allProducts");
  allChip.addEventListener("click", () => { activeCategory = "all"; renderCategoryNav(); renderProducts(); });
  nav.appendChild(allChip);

  categories.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "category-chip" + (activeCategory === c.id ? " active" : "");
    chip.textContent = lang === "ml" && c.name_ml ? c.name_ml : c.name_en || c.name;
    chip.addEventListener("click", () => { activeCategory = c.id; renderCategoryNav(); renderProducts(); });
    nav.appendChild(chip);
  });
}

// =================================================================
// PRODUCTS
// =================================================================
function loadProducts() {
  // Only products the owner marked available are fetched — keeps reads low
  // and never shows retired items to customers.
  const q = query(collection(db, "shops", SHOP_ID, "products"), orderBy("name_en", "asc"));
  onSnapshot(q, (snap) => {
    products = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active !== false);
    renderProducts();
  });
}

function renderProducts() {
  const grid = $("#product-grid");
  const lang = getLang();
  let list = products;
  if (activeCategory !== "all") list = list.filter((p) => p.categoryId === activeCategory);
  if (searchTerm) {
    const s = searchTerm.toLowerCase();
    list = list.filter((p) =>
      (p.name_en || "").toLowerCase().includes(s) || (p.name_ml || "").includes(searchTerm)
    );
  }
  grid.innerHTML = "";
  $("#product-empty").classList.toggle("hidden", list.length > 0);

  list.forEach((p) => {
    const name = lang === "ml" && p.name_ml ? p.name_ml : p.name_en;
    const outOfStock = (p.stock ?? 0) <= 0;
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <img src="${p.imageUrl || ""}" alt="" loading="lazy" />
      <div class="product-card-body">
        <div class="product-card-name">${escapeHtml(name)}</div>
        <div class="product-card-price">${formatCurrency(p.price)}</div>
        ${outOfStock ? `<div class="product-card-stock">${t("outOfStock")}</div>` : ""}
        <button class="product-add-btn" ${outOfStock ? "disabled" : ""}>${outOfStock ? t("outOfStock") : t("addToCart")}</button>
      </div>
    `;
    card.querySelector("img").addEventListener("click", () => openProductDetail(p));
    card.querySelector(".product-card-name").addEventListener("click", () => openProductDetail(p));
    const btn = card.querySelector(".product-add-btn");
    if (!outOfStock) btn.addEventListener("click", () => { addToCart(p.id, 1); toast(t("addToCart")); });
    grid.appendChild(card);
  });
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#search-input").addEventListener("input", debounce((e) => {
  searchTerm = e.target.value.trim();
  renderProducts();
}, 200));

// =================================================================
// PRODUCT DETAIL MODAL
// =================================================================
function openProductDetail(p) {
  const lang = getLang();
  const name = lang === "ml" && p.name_ml ? p.name_ml : p.name_en;
  const desc = lang === "ml" && p.description_ml ? p.description_ml : p.description_en;
  const outOfStock = (p.stock ?? 0) <= 0;
  let qty = 1;

  $("#product-detail").innerHTML = `
    <img class="product-detail-img" src="${p.imageUrl || ""}" alt="" />
    <h2>${escapeHtml(name || "")}</h2>
    <p>${escapeHtml(desc || "")}</p>
    <div class="product-detail-price">${formatCurrency(p.price)}</div>
    ${outOfStock
      ? `<p style="color:var(--color-danger);font-weight:700">${t("outOfStock")}</p>`
      : `<div class="qty-stepper">
           <button id="qty-minus">−</button>
           <span id="qty-value">1</span>
           <button id="qty-plus">+</button>
         </div>
         <button id="detail-add-btn" class="btn btn-primary">${t("addToCart")}</button>`
    }
  `;

  if (!outOfStock) {
    $("#qty-minus").addEventListener("click", () => { qty = Math.max(1, qty - 1); $("#qty-value").textContent = qty; });
    $("#qty-plus").addEventListener("click", () => { qty = Math.min(p.stock, qty + 1); $("#qty-value").textContent = qty; });
    $("#detail-add-btn").addEventListener("click", () => {
      addToCart(p.id, qty);
      toast(t("addToCart"));
      closeModal("modal-product");
    });
  }
  openModal("modal-product");
}

// =================================================================
// CART
// =================================================================
function addToCart(productId, qty) {
  const cart = getCart();
  cart[productId] = (cart[productId] || 0) + qty;
  saveCart(cart);
  renderCart();
}

function updateCartQty(productId, qty) {
  const cart = getCart();
  if (qty <= 0) delete cart[productId];
  else cart[productId] = qty;
  saveCart(cart);
  renderCart();
}

function renderCart() {
  const cart = getCart();
  const ids = Object.keys(cart);
  const countEl = $("#cart-count");
  const totalCount = Object.values(cart).reduce((a, b) => a + b, 0);
  countEl.textContent = totalCount;
  countEl.classList.toggle("hidden", totalCount === 0);

  const container = $("#cart-items");
  const lang = getLang();
  container.innerHTML = "";
  let subtotal = 0;

  ids.forEach((id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const qty = cart[id];
    subtotal += (p.price || 0) * qty;
    const name = lang === "ml" && p.name_ml ? p.name_ml : p.name_en;
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <img src="${p.imageUrl || ""}" alt="" />
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(name)}</div>
        <div class="cart-item-price">${formatCurrency(p.price)}</div>
      </div>
      <div class="cart-item-controls">
        <button data-action="minus">−</button>
        <span>${qty}</span>
        <button data-action="plus">+</button>
      </div>
    `;
    row.querySelector('[data-action="minus"]').addEventListener("click", () => updateCartQty(id, qty - 1));
    row.querySelector('[data-action="plus"]').addEventListener("click", () => updateCartQty(id, Math.min(p.stock, qty + 1)));
    container.appendChild(row);
  });

  $("#cart-empty").classList.toggle("hidden", ids.length > 0);
  $("#cart-summary").classList.toggle("hidden", ids.length === 0);
  $("#checkout-form").classList.toggle("hidden", ids.length === 0);
  $("#cart-subtotal").textContent = formatCurrency(subtotal);

  // Hide the delivery-address field entirely if the shop doesn't need it.
  const needsAddress = shopData.requireAddress !== false;
  const addrLabel = $("#label-address");
  const addrInput = document.querySelector('[name="address"]');
  addrLabel.classList.toggle("hidden", !needsAddress);
  addrInput.classList.toggle("hidden", !needsAddress);
}

$("#btn-cart-nav").addEventListener("click", () => openModal("modal-cart"));

// =================================================================
// CHECKOUT — stock is re-verified inside a Firestore transaction, so a
// customer can never order more than what is actually in stock, even if
// their screen is showing stale data.
// =================================================================
$("#checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = t("loading");

  const cart = getCart();
  const items = Object.entries(cart);
  if (items.length === 0) { submitBtn.disabled = false; submitBtn.textContent = t("placeOrder"); return; }

  const orderCode = generateOrderCode(shopData.orderPrefix || "SHOP");
  const customerName = form.customerName.value.trim();
  const phone = form.phone.value.trim();
  const address = form.address.value.trim();
  const note = form.note.value.trim();

  try {
    await runTransaction(db, async (tx) => {
      const productRefs = items.map(([id]) => doc(db, "shops", SHOP_ID, "products", id));
      const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

      let total = 0;
      const orderItems = [];

      productSnaps.forEach((snap, idx) => {
        const [productId, qty] = items[idx];
        if (!snap.exists()) throw new Error("PRODUCT_MISSING");
        const p = snap.data();
        const currentStock = p.stock ?? 0;
        if (currentStock < qty) throw new Error("OUT_OF_STOCK");

        total += (p.price || 0) * qty;
        orderItems.push({
          productId,
          name_en: p.name_en || "",
          name_ml: p.name_ml || "",
          price: p.price || 0, // price snapshot at purchase time — never changes later
          qty,
        });

        tx.update(productRefs[idx], { stock: currentStock - qty });
      });

      const orderRef = doc(db, "shops", SHOP_ID, "orders", orderCode);
      tx.set(orderRef, {
        shopId: SHOP_ID,
        customerName,
        phone,
        address,
        note,
        items: orderItems,
        total,
        status: "New",
        lang: getLang(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    // Remember this order locally so "My Orders" can show it without a login.
    const mine = JSON.parse(localStorage.getItem("shop_my_orders") || "[]");
    mine.unshift(orderCode);
    localStorage.setItem("shop_my_orders", JSON.stringify(mine.slice(0, 20)));

    clearCart();
    renderCart();
    form.reset();
    closeModal("modal-cart");
    $("#confirm-order-id").textContent = orderCode;
    openModal("modal-confirm");
  } catch (err) {
    if (err.message === "OUT_OF_STOCK" || err.message === "PRODUCT_MISSING") {
      toast(t("stockChanged"));
    } else {
      console.error(err);
      toast(t("errorGeneric"));
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = t("placeOrder");
  }
});

// =================================================================
// MY ORDERS / ORDER STATUS LOOKUP
// =================================================================
async function checkOrder(orderCode) {
  if (!orderCode) return null;
  const snap = await getDoc(doc(db, "shops", SHOP_ID, "orders", orderCode.trim().toUpperCase()));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

function renderOrderCard(order) {
  const statusKey = "status" + order.status;
  const div = document.createElement("div");
  div.className = "order-card";
  div.innerHTML = `
    <div class="order-card-top">
      <strong>${order.id}</strong>
      <span class="order-status-badge ${order.status.toLowerCase()}">${t(statusKey)}</span>
    </div>
    <div style="font-size:13px;color:var(--color-text-muted)">${formatCurrency(order.total)} · ${(order.items || []).length} items</div>
  `;
  return div;
}

async function loadMyOrders() {
  const mine = JSON.parse(localStorage.getItem("shop_my_orders") || "[]");
  const list = $("#my-orders-list");
  list.innerHTML = "";
  for (const code of mine) {
    const order = await checkOrder(code);
    if (order) list.appendChild(renderOrderCard(order));
  }
}

$("#order-lookup-btn").addEventListener("click", async () => {
  const code = $("#order-lookup-input").value.trim();
  const order = await checkOrder(code);
  if (!order) { toast(t("errorGeneric")); return; }
  const mine = JSON.parse(localStorage.getItem("shop_my_orders") || "[]");
  if (!mine.includes(order.id)) {
    mine.unshift(order.id);
    localStorage.setItem("shop_my_orders", JSON.stringify(mine.slice(0, 20)));
  }
  loadMyOrders();
});

// =================================================================
// NOTIFICATIONS
// =================================================================
function loadNotifications() {
  const q = query(collection(db, "shops", SHOP_ID, "notifications"), orderBy("createdAt", "desc"), limit(30));
  onSnapshot(q, (snap) => {
    const list = $("#notifications-list");
    const lang = getLang();
    list.innerHTML = "";
    $("#notifications-empty").classList.toggle("hidden", !snap.empty);
    snap.forEach((d) => {
      const n = d.data();
      const title = lang === "ml" && n.title_ml ? n.title_ml : n.title_en;
      const body = lang === "ml" && n.body_ml ? n.body_ml : n.body_en;
      const card = document.createElement("div");
      card.className = "notification-card";
      card.innerHTML = `
        <div class="notification-card-title">${escapeHtml(title || "")}</div>
        <div>${escapeHtml(body || "")}</div>
        <span class="notification-card-time">${formatTime(n.createdAt)}</span>
      `;
      list.appendChild(card);
    });
  });
}

function formatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(getLang() === "ml" ? "ml-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// =================================================================
// CONTACT SHOP
// =================================================================
$("#btn-contact-nav").addEventListener("click", () => {
  const box = $("#contact-options");
  box.innerHTML = "";
  if (shopData.phone) {
    const a = document.createElement("a");
    a.className = "btn btn-primary";
    a.href = `tel:${shopData.phone}`;
    a.textContent = t("callShop");
    box.appendChild(a);
  }
  if (shopData.whatsapp) {
    const a = document.createElement("a");
    a.className = "btn btn-primary";
    a.href = `https://wa.me/${shopData.whatsapp}`;
    a.target = "_blank";
    a.textContent = t("whatsappShop");
    box.appendChild(a);
  }
  openModal("modal-contact");
});

// =================================================================
// BOTTOM NAV / VIEW SWITCHING
// =================================================================
$$(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    if (view === "cart") return; // handled by openModal above
    $$(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["home", "orders", "notifications"].forEach((v) => {
      const el = $(`#view-${v}`);
      if (!el) return;
      el.classList.toggle("hidden", v !== view);
    });
    if (view === "orders") loadMyOrders();
  });
});

// =================================================================
// MODAL HELPERS
// =================================================================
function openModal(id) { show($(`#${id}`)); }
function closeModal(id) { hide($(`#${id}`)); }
$$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) hide(m); }));

$("#btn-lang-switch").addEventListener("click", () => {
  setLang(getLang() === "en" ? "ml" : "en");
  applyTranslations();
  $("#btn-lang-switch").textContent = getLang().toUpperCase();
  renderCategoryNav();
  renderProducts();
  renderCart();
});

// =================================================================
// SERVICE WORKER (PWA offline shell + install support)
// =================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// =================================================================
// BOOT
// =================================================================
initLanguageStep();
initAddHomeStep();
initNotifyStep();
