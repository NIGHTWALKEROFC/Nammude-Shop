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

import { firebaseConfig, VAPID_KEY, SHOP_ID, PUSH_RELAY_URL, PUSH_RELAY_KEY } from "../../shared/js/firebase-config.js";
import { t, getLang, setLang, applyTranslations } from "../../shared/js/i18n.js";
import { generateOrderCode, formatCurrency, debounce, getCart, saveCart, clearCart, triggerPushRelay } from "../../shared/js/utils.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let categories = [];
let products = [];
let activeCategory = "all";
let searchTerm = "";
let sortMode = "default";
let inStockOnly = false;
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
// SERVICE WORKER — registered ONCE, reused for both offline caching and
// push. Registering more than one SW at the same scope is what used to
// break background push (see the comment block at the top of sw.js).
// =================================================================
let swRegistrationPromise = null;
function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err.message);
      return null;
    });
  }
  return swRegistrationPromise;
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
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "denied") return "denied"; // respect the browser setting, never bypass it
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const supported = await messagingIsSupported().catch(() => false);
    if (!supported) return "unsupported";

    const reg = await ensureServiceWorker();
    if (!reg) return "error";

    const messaging = getMessaging(app);
    const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!fcmToken) return "error";

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
    return "granted";
  } catch (err) {
    console.warn("Push setup skipped:", err.message);
    return "error";
  }
}

// Lets a returning visitor turn phone-popup notifications on/off from
// inside the app itself. The onboarding "Enable notifications" step (Step
// 3) only ever runs on someone's very first visit — after that, language
// preference is remembered and onboarding is skipped entirely, which used
// to mean there was NO way to grant this later if it was skipped or
// dismissed the first time. This banner in the Notifications tab fixes
// that: it's checked every time that tab is opened.
function updateNotifPermissionBanner() {
  const banner = $("#notif-permission-banner");
  const text = $("#notif-permission-text");
  const btn = $("#btn-enable-notify-inline");
  if (!banner) return;

  if (!("Notification" in window)) { hide(banner); return; }

  if (Notification.permission === "granted") {
    hide(banner);
  } else if (Notification.permission === "denied") {
    show(banner);
    text.textContent = getLang() === "ml"
      ? "അറിയിപ്പുകൾ Chrome-ൽ ബ്ലോക്ക് ചെയ്തിരിക്കുന്നു. സൈറ്റ് സെറ്റിംഗ്സിൽ അനുവദിക്കുക."
      : "Notifications are blocked in Chrome. Enable them in the site's settings to get alerts on your phone.";
    btn.classList.add("hidden");
  } else {
    show(banner);
    text.textContent = getLang() === "ml"
      ? "പുതിയ ഓർഡർ അപ്ഡേറ്റുകൾ ഫോണിൽ നേരിട്ട് ലഭിക്കാൻ അറിയിപ്പുകൾ ഓണാക്കുക"
      : "Turn on notifications to get alerts directly on your phone";
    btn.classList.remove("hidden");
  }
}

$("#btn-enable-notify-inline")?.addEventListener("click", async () => {
  const result = await enablePushNotifications();
  updateNotifPermissionBanner();
  if (result === "granted") toast(t("notifications"));
});

// =================================================================
// GO TO MAIN APP
// =================================================================
function goToApp() {
  $$(".screen").forEach(hide);
  show($("#app"));
  $("#btn-lang-switch").textContent = getLang().toUpperCase();
  ensureServiceWorker();
  loadShop();
  loadCategories();
  loadProducts();
  loadNotifications();
  renderCart();
  // "Catch up" on anything that failed to push-notify earlier (e.g. the
  // relay Worker was briefly unreachable when an announcement was made).
  // This is a one-off check on app open, NOT a scheduled/polling job.
  triggerPushRelay(PUSH_RELAY_URL, PUSH_RELAY_KEY, "catchup", SHOP_ID, null);
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
    renderCart(); // keep the cart's "shop closed" banner / address field in sync live
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
    renderCart(); // product prices/stock may have changed under an open cart
  });
}

const LOW_STOCK_THRESHOLD = 5; // client-side urgency cue only, separate from the admin's configurable restock threshold

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
  if (inStockOnly) list = list.filter((p) => (p.stock ?? 0) > 0);

  list = list.slice().sort((a, b) => {
    if (sortMode === "name") return (a.name_en || "").localeCompare(b.name_en || "");
    if (sortMode === "price-asc") return (a.price || 0) - (b.price || 0);
    if (sortMode === "price-desc") return (b.price || 0) - (a.price || 0);
    return 0; // "default" keeps the existing (name-ordered-from-Firestore) sequence
  });

  grid.innerHTML = "";
  $("#product-empty").classList.toggle("hidden", list.length > 0);

  list.forEach((p) => {
    const name = lang === "ml" && p.name_ml ? p.name_ml : p.name_en;
    const stock = p.stock ?? 0;
    const outOfStock = stock <= 0;
    const lowStock = !outOfStock && stock <= LOW_STOCK_THRESHOLD;
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-card-media">
        <img src="${p.imageUrl || ""}" alt="" loading="lazy" />
        ${outOfStock ? `<span class="product-card-stock-badge">${t("outOfStock")}</span>` : ""}
        <button class="product-add-btn${outOfStock ? " is-disabled" : ""}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "—" : t("addShort")}</button>
      </div>
      <div class="product-card-body">
        <div class="product-card-name">${escapeHtml(name)}</div>
        <div class="product-card-price">${formatCurrency(p.price)}</div>
        ${lowStock ? `<div class="product-card-lowstock">${t("onlyLeft").replace("{n}", stock)}</div>` : ""}
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
  $("#btn-search-clear").classList.toggle("hidden", searchTerm.length === 0);
  renderProducts();
}, 200));

$("#btn-search-clear").addEventListener("click", () => {
  $("#search-input").value = "";
  searchTerm = "";
  hide($("#btn-search-clear"));
  renderProducts();
  $("#search-input").focus();
});

// =================================================================
// SORT — bottom sheet (replaces the old plain <select>, which looked out
// of place next to the rest of the app's styling).
// =================================================================
const SORT_LABEL_KEYS = {
  default: "sortFeatured",
  name: "sortNameAZ",
  "price-asc": "sortPriceLow",
  "price-desc": "sortPriceHigh",
};

function updateSortUI() {
  $("#sort-current-label").textContent = t(SORT_LABEL_KEYS[sortMode]);
  $$(".sort-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.value === sortMode));
}

$("#btn-sort-open").addEventListener("click", () => openModal("modal-sort"));

$$(".sort-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    sortMode = btn.dataset.value;
    updateSortUI();
    renderProducts();
    closeModal("modal-sort");
  });
});

$("#instock-only").addEventListener("change", (e) => {
  inStockOnly = e.target.checked;
  renderProducts();
});

// =================================================================
// PRODUCT DETAIL MODAL
// =================================================================
function openProductDetail(p) {
  const lang = getLang();
  const name = lang === "ml" && p.name_ml ? p.name_ml : p.name_en;
  const desc = lang === "ml" && p.description_ml ? p.description_ml : p.description_en;
  const stock = p.stock ?? 0;
  const outOfStock = stock <= 0;
  const lowStock = !outOfStock && stock <= LOW_STOCK_THRESHOLD;
  const cat = categories.find((c) => c.id === p.categoryId);
  const catName = cat ? (lang === "ml" && cat.name_ml ? cat.name_ml : cat.name_en || cat.name) : "";
  let qty = 1;

  $("#product-detail").innerHTML = `
    <img class="product-detail-img" src="${p.imageUrl || ""}" alt="" />
    ${catName ? `<span class="category-chip" style="display:inline-block;margin-bottom:8px">${escapeHtml(catName)}</span>` : ""}
    <h2>${escapeHtml(name || "")}</h2>
    <p>${escapeHtml(desc || "")}</p>
    <div class="product-detail-price">${formatCurrency(p.price)}</div>
    ${lowStock ? `<p class="product-card-lowstock" style="margin-bottom:8px">${t("onlyLeft").replace("{n}", stock)}</p>` : ""}
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
    // Guard against p.stock being undefined/non-numeric — Math.min(undefined, n)
    // is NaN, which used to silently break the quantity stepper.
    const maxQty = typeof p.stock === "number" ? p.stock : 999;
    $("#qty-minus").addEventListener("click", () => { qty = Math.max(1, qty - 1); $("#qty-value").textContent = qty; });
    $("#qty-plus").addEventListener("click", () => { qty = Math.min(maxQty, qty + 1); $("#qty-value").textContent = qty; });
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
    // Guard against p.stock being undefined/non-numeric (see openProductDetail).
    const maxQty = typeof p.stock === "number" ? p.stock : 999;
    const atMax = qty >= maxQty;
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
        <button data-action="plus" ${atMax ? "disabled" : ""}>+</button>
      </div>
    `;
    row.querySelector('[data-action="minus"]').addEventListener("click", () => updateCartQty(id, qty - 1));
    row.querySelector('[data-action="plus"]').addEventListener("click", () => {
      if (qty >= maxQty) return;
      updateCartQty(id, qty + 1);
    });
    container.appendChild(row);
  });

  $("#cart-empty").classList.toggle("hidden", ids.length > 0);
  $("#cart-summary").classList.toggle("hidden", ids.length === 0);
  $("#checkout-form").classList.toggle("hidden", ids.length === 0);
  $("#cart-subtotal").textContent = formatCurrency(subtotal);

  const shopClosed = shopData.isOpen === false;
  $("#cart-closed-banner").classList.toggle("hidden", !shopClosed || ids.length === 0);
  const submitBtn = $("#checkout-form button[type='submit']");
  if (submitBtn) submitBtn.disabled = shopClosed;

  // Hide the delivery-address field entirely if the shop doesn't need it.
  const needsAddress = shopData.requireAddress !== false;
  const addrLabel = $("#label-address");
  const addrInput = document.querySelector('[name="address"]');
  addrLabel.classList.toggle("hidden", !needsAddress);
  addrInput.classList.toggle("hidden", !needsAddress);

  // Floating "View Cart" bar — hidden while the cart modal itself is open
  // (see openModal/closeModal below).
  const floatingBar = $("#cart-floating-bar");
  const cartModalOpen = !$("#modal-cart").classList.contains("hidden");
  if (ids.length > 0 && !cartModalOpen) {
    show(floatingBar);
    $("#cart-floating-count").textContent = `${totalCount} ${t("items")}`;
    $("#cart-floating-total").textContent = formatCurrency(subtotal);
  } else {
    hide(floatingBar);
  }
}

$("#btn-cart-nav").addEventListener("click", () => openModal("modal-cart"));
$("#btn-cart-floating").addEventListener("click", () => openModal("modal-cart"));

// =================================================================
// CHECKOUT — stock is re-verified inside a Firestore transaction, so a
// customer can never order more than what is actually in stock, even if
// their screen is showing stale data. The order code is also re-checked
// for collisions inside the same transaction and retried on the rare
// chance two customers land on the same random code at the same moment
// (previously this could silently overwrite an existing order).
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

  if (shopData.isOpen === false) {
    toast(t("shopClosedError"));
    submitBtn.disabled = false;
    submitBtn.textContent = t("placeOrder");
    return;
  }

  const customerName = form.customerName.value.trim();
  const phone = form.phone.value.trim();
  const address = form.address.value.trim();
  const note = form.note.value.trim();

  const MAX_ATTEMPTS = 5;
  let placedOrderCode = null;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !placedOrderCode; attempt++) {
      const orderCode = generateOrderCode(shopData.orderPrefix || "SHOP");
      try {
        await runTransaction(db, async (tx) => {
          // All reads must happen before any writes in a Firestore transaction.
          const orderRef = doc(db, "shops", SHOP_ID, "orders", orderCode);
          const orderSnap = await tx.get(orderRef);
          if (orderSnap.exists()) throw new Error("ORDER_CODE_TAKEN");

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
            ownerAlertSent: false, // flipped to true by the push relay once it delivers — see /server/push-relay
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        placedOrderCode = orderCode;
      } catch (err) {
        if (err.message === "ORDER_CODE_TAKEN") continue; // retry with a fresh code
        throw err;
      }
    }

    if (!placedOrderCode) throw new Error("ORDER_CODE_TAKEN");

    // Remember this order locally so "My Orders" can show it without a login.
    const mine = JSON.parse(localStorage.getItem("shop_my_orders") || "[]");
    mine.unshift(placedOrderCode);
    localStorage.setItem("shop_my_orders", JSON.stringify(mine.slice(0, 20)));

    // Instantly (not on a timer) tell the push relay to alert the shop owner.
    triggerPushRelay(PUSH_RELAY_URL, PUSH_RELAY_KEY, "order", SHOP_ID, placedOrderCode);

    clearCart();
    renderCart();
    form.reset();
    closeModal("modal-cart");
    $("#confirm-order-id").textContent = placedOrderCode;
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

async function lookupOrder() {
  const code = $("#order-lookup-input").value.trim();
  if (!code) return;
  const order = await checkOrder(code);
  if (!order) { toast(t("errorGeneric")); return; }
  const mine = JSON.parse(localStorage.getItem("shop_my_orders") || "[]");
  if (!mine.includes(order.id)) {
    mine.unshift(order.id);
    localStorage.setItem("shop_my_orders", JSON.stringify(mine.slice(0, 20)));
  }
  loadMyOrders();
}

$("#order-lookup-btn").addEventListener("click", lookupOrder);
// Fix: pressing Enter in the order-lookup input did nothing before —
// only clicking "Check" worked, which most people don't expect on mobile.
$("#order-lookup-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); lookupOrder(); }
});

// =================================================================
// NOTIFICATIONS
// In-app "something new arrived" indicator — a red dot on the bottom-nav
// bell plus a toast the moment a new notification lands. This works purely
// off the existing Firestore listener, so it's instant and reliable even
// on devices where push permission was never granted or push delivery is
// delayed/unavailable.
// =================================================================
let latestNotifTs = 0;
let notificationsFirstLoad = true;

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

      const ts = n.createdAt?.toMillis ? n.createdAt.toMillis() : 0;
      if (ts > latestNotifTs) latestNotifTs = ts;
    });

    const lastSeen = Number(localStorage.getItem("shop_notif_last_seen") || 0);

    // Only toast for notifications that arrive AFTER this listener attached
    // (Firestore reports every existing doc as "added" on the very first
    // snapshot too — without this guard every old notification would toast
    // once on every page load).
    if (!notificationsFirstLoad) {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const n = change.doc.data();
        const ts = n.createdAt?.toMillis ? n.createdAt.toMillis() : 0;
        if (ts > lastSeen) {
          const title = lang === "ml" && n.title_ml ? n.title_ml : n.title_en;
          toast(`🔔 ${title || t("notifications")}`);
        }
      });
    }
    notificationsFirstLoad = false;
    setNotifBadge(latestNotifTs > lastSeen);
  });
}

function setNotifBadge(on) {
  const dot = $("#notif-dot");
  if (dot) dot.classList.toggle("hidden", !on);
}

function markNotificationsSeen() {
  localStorage.setItem("shop_notif_last_seen", String(latestNotifTs || Date.now()));
  setNotifBadge(false);
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
    if (view === "notifications") { markNotificationsSeen(); updateNotifPermissionBanner(); }
  });
});

// =================================================================
// MODAL HELPERS
// =================================================================
function openModal(id) {
  show($(`#${id}`));
  if (id === "modal-cart") hide($("#cart-floating-bar")); // avoid the floating bar showing through behind the sheet
  if (id === "modal-sort") updateSortUI();
}
function closeModal(id) {
  hide($(`#${id}`));
  if (id === "modal-cart") renderCart(); // brings the floating bar back if the cart still has items
}
$$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); }));

$("#btn-lang-switch").addEventListener("click", () => {
  setLang(getLang() === "en" ? "ml" : "en");
  applyTranslations();
  $("#btn-lang-switch").textContent = getLang().toUpperCase();
  updateSortUI();
  renderCategoryNav();
  renderProducts();
  renderCart();
});

// =================================================================
// BOOT
// =================================================================
updateSortUI();
ensureServiceWorker(); // register early so offline caching starts ASAP
initLanguageStep();
initAddHomeStep();
initNotifyStep();
