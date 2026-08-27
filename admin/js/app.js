// admin/js/app.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, addDoc, updateDoc, deleteDoc, collection,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getMessaging, getToken, isSupported as messagingIsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

import {
  firebaseConfig, VAPID_KEY, SHOP_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET,
  PUSH_RELAY_URL, PUSH_RELAY_KEY,
} from "../../shared/js/firebase-config.js";
import { formatCurrency, triggerPushRelay } from "../../shared/js/utils.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

let categories = [];
let products = [];
let orders = [];
let shopSettings = {};

// =================================================================
// AUTH
// =================================================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    hide($("#screen-login"));
    show($("#app"));
    bootAdminData();
  } else {
    show($("#screen-login"));
    hide($("#app"));
  }
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-password").value);
  } catch (err) {
    $("#login-error").textContent = "Incorrect email or password.";
    show($("#login-error"));
  }
});

$("#btn-forgot").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  if (!email) { toast("Enter your email above first."); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Password reset email sent.");
  } catch {
    toast("Could not send reset email.");
  }
});

$("#btn-logout").addEventListener("click", () => signOut(auth));

// =================================================================
// NAVIGATION
// =================================================================
$$(".side-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".side-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".view").forEach((v) => v.classList.add("hidden"));
    show($(`#view-${btn.dataset.view}`));
    $("#crumb").textContent = btn.textContent.trim();
    if (btn.dataset.view === "orders") markOrdersSeen();
  });
});

function openModal(id) { show($(`#${id}`)); }
function closeModal(id) { hide($(`#${id}`)); }
$$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.close)));

// =================================================================
// BOOT — set up all real-time listeners once logged in
// =================================================================
function bootAdminData() {
  listenShopSettings();
  listenCategories();
  listenProducts();
  listenOrders();
  listenAnnouncements();
  // Catch up on anything that failed to push-notify since the last admin
  // login (e.g. the relay Worker was briefly unreachable). One-off check
  // on login, NOT a scheduled/polling job — this is what replaced the old
  // GitHub Actions cron.
  triggerPushRelay(PUSH_RELAY_URL, PUSH_RELAY_KEY, "catchup", SHOP_ID, null);
}

// =================================================================
// SHOP SETTINGS
// =================================================================
function listenShopSettings() {
  onSnapshot(doc(db, "shops", SHOP_ID), (snap) => {
    shopSettings = snap.exists() ? snap.data() : {};
    const f = $("#settings-form");
    f.name.value = shopSettings.name || "";
    f.logoUrl.value = shopSettings.logoUrl || "";
    f.isOpen.value = String(shopSettings.isOpen !== false);
    f.phone.value = shopSettings.phone || "";
    f.whatsapp.value = shopSettings.whatsapp || "";
    f.requireAddress.value = String(shopSettings.requireAddress !== false);
    f.lowStockThreshold.value = shopSettings.lowStockThreshold ?? 5;
    f.orderPrefix.value = shopSettings.orderPrefix || "SHOP";
    renderDashboard();
  });
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  await setDoc(doc(db, "shops", SHOP_ID), {
    name: f.name.value.trim(),
    logoUrl: f.logoUrl.value.trim(),
    isOpen: f.isOpen.value === "true",
    phone: f.phone.value.trim(),
    whatsapp: f.whatsapp.value.trim(),
    requireAddress: f.requireAddress.value === "true",
    lowStockThreshold: Number(f.lowStockThreshold.value) || 5,
    orderPrefix: f.orderPrefix.value.trim() || "SHOP",
  }, { merge: true });
  toast("Settings saved.");
});

// =================================================================
// CATEGORIES
// =================================================================
function listenCategories() {
  const q = query(collection(db, "shops", SHOP_ID, "categories"), orderBy("order", "asc"));
  onSnapshot(q, (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategoriesTable();
    fillCategorySelect();
  });
}

function renderCategoriesTable() {
  const tbody = $("#categories-table tbody");
  tbody.innerHTML = "";
  categories.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Name (EN)">${escapeHtml(c.name_en || "")}</td>
      <td data-label="Name (ML)">${escapeHtml(c.name_ml || "")}</td>
      <td data-label="Order">${c.order ?? 0}</td>
      <td class="row-actions" data-label="Actions">
        <button data-edit>Edit</button>
        <button data-delete>Delete</button>
      </td>
    `;
    tr.querySelector("[data-edit]").addEventListener("click", () => openCategoryForm(c));
    tr.querySelector("[data-delete]").addEventListener("click", () => deleteCategory(c.id));
    tbody.appendChild(tr);
  });
}

function fillCategorySelect() {
  const sel = $("#product-category-select");
  sel.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name_en)}</option>`).join("");
}

$("#btn-new-category").addEventListener("click", () => openCategoryForm(null));

function openCategoryForm(c) {
  const f = $("#category-form");
  f.reset();
  f.id.value = c?.id || "";
  f.name_en.value = c?.name_en || "";
  f.name_ml.value = c?.name_ml || "";
  f.order.value = c?.order ?? categories.length;
  openModal("modal-category-form");
}

$("#category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = { name_en: f.name_en.value.trim(), name_ml: f.name_ml.value.trim(), order: Number(f.order.value) || 0 };
  if (f.id.value) {
    await updateDoc(doc(db, "shops", SHOP_ID, "categories", f.id.value), data);
  } else {
    await addDoc(collection(db, "shops", SHOP_ID, "categories"), data);
  }
  closeModal("modal-category-form");
  toast("Category saved.");
});

async function deleteCategory(id) {
  if (!confirm("Delete this category? Products in it will keep their category ID but it won't show a name.")) return;
  await deleteDoc(doc(db, "shops", SHOP_ID, "categories", id));
}

// =================================================================
// PRODUCTS
// =================================================================
function listenProducts() {
  const q = query(collection(db, "shops", SHOP_ID, "products"), orderBy("name_en", "asc"));
  onSnapshot(q, (snap) => {
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    selectedProductIds = new Set([...selectedProductIds].filter((id) => products.some((p) => p.id === id)));
    renderProductsTable();
    renderDashboard();
  });
}

let selectedProductIds = new Set();

function renderProductsTable() {
  const tbody = $("#products-table tbody");
  const threshold = shopSettings.lowStockThreshold ?? 5;
  tbody.innerHTML = "";
  products.forEach((p) => {
    const cat = categories.find((c) => c.id === p.categoryId);
    let stockBadge = `<span class="badge">${p.stock ?? 0}</span>`;
    if ((p.stock ?? 0) <= 0) stockBadge = `<span class="badge out">Out of stock</span>`;
    else if ((p.stock ?? 0) <= threshold) stockBadge = `<span class="badge low">${p.stock} — Low</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Select"><input type="checkbox" class="row-select" ${selectedProductIds.has(p.id) ? "checked" : ""} /></td>
      <td data-label="Photo"><img src="${p.imageUrl || ""}" alt="" /></td>
      <td data-label="Name">${escapeHtml(p.name_en || "")}</td>
      <td data-label="Category">${escapeHtml(cat?.name_en || "—")}</td>
      <td data-label="Price">${formatCurrency(p.price)}</td>
      <td data-label="Stock">${stockBadge}</td>
      <td data-label="Status">${p.active === false ? '<span class="badge hidden-status">Hidden</span>' : '<span class="badge">Available</span>'}</td>
      <td class="row-actions" data-label="Actions">
        <button data-edit>Edit</button>
        <button data-delete>Delete</button>
      </td>
    `;
    tr.querySelector("[data-edit]").addEventListener("click", () => openProductForm(p));
    tr.querySelector("[data-delete]").addEventListener("click", () => deleteProduct(p.id));
    tr.querySelector(".row-select").addEventListener("change", (e) => {
      if (e.target.checked) selectedProductIds.add(p.id);
      else selectedProductIds.delete(p.id);
      updateProductsBulkBar();
    });
    tbody.appendChild(tr);
  });
  updateProductsBulkBar();
}

function updateProductsBulkBar() {
  const bar = $("#products-bulk-bar");
  const n = selectedProductIds.size;
  bar.classList.toggle("hidden", n === 0);
  $("#products-selected-count").textContent = `${n} selected`;
  $("#products-select-all").checked = n > 0 && n === products.length;
}

$("#products-select-all").addEventListener("change", (e) => {
  selectedProductIds = e.target.checked ? new Set(products.map((p) => p.id)) : new Set();
  renderProductsTable();
});

async function bulkSetProductsActive(active) {
  if (selectedProductIds.size === 0) return;
  const batch = writeBatch(db);
  selectedProductIds.forEach((id) => {
    batch.update(doc(db, "shops", SHOP_ID, "products", id), { active });
  });
  await batch.commit();
  toast(active ? "Selected products shown to customers." : "Selected products hidden from customers.");
  selectedProductIds = new Set();
}
$("#btn-bulk-show").addEventListener("click", () => bulkSetProductsActive(true));
$("#btn-bulk-hide").addEventListener("click", () => bulkSetProductsActive(false));

$("#btn-bulk-delete").addEventListener("click", async () => {
  const n = selectedProductIds.size;
  if (n === 0) return;
  if (!confirm(`Delete ${n} selected product(s)? Past orders will keep showing their name and price as they were.`)) return;
  const batch = writeBatch(db);
  selectedProductIds.forEach((id) => batch.delete(doc(db, "shops", SHOP_ID, "products", id)));
  await batch.commit();
  toast(`${n} product(s) deleted.`);
  selectedProductIds = new Set();
});

$("#btn-new-product").addEventListener("click", () => openProductForm(null));

function openProductForm(p) {
  const f = $("#product-form");
  f.reset();
  $("#product-form-title").textContent = p ? "Edit Product" : "Add Product";
  f.id.value = p?.id || "";
  f.name_en.value = p?.name_en || "";
  f.name_ml.value = p?.name_ml || "";
  f.description_en.value = p?.description_en || "";
  f.description_ml.value = p?.description_ml || "";
  f.price.value = p?.price ?? "";
  f.stock.value = p?.stock ?? "";
  f.active.value = String(p?.active !== false);
  if (categories.length) f.categoryId.value = p?.categoryId || categories[0].id;
  const preview = $("#product-image-preview");
  if (p?.imageUrl) { preview.src = p.imageUrl; show(preview); } else { hide(preview); }
  $("#product-notify").checked = false;
  openModal("modal-product-form");
}

$("#product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const submitBtn = f.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const existing = products.find((p) => p.id === f.id.value);
    const oldPrice = existing?.price;
    const oldStock = existing?.stock ?? 0;

    let imageUrl = existing?.imageUrl || "";
    const file = f.imageFile.files[0];
    if (file) imageUrl = await uploadProductImage(file);

    const data = {
      name_en: f.name_en.value.trim(),
      name_ml: f.name_ml.value.trim(),
      description_en: f.description_en.value.trim(),
      description_ml: f.description_ml.value.trim(),
      categoryId: f.categoryId.value,
      price: Number(f.price.value),
      stock: Number(f.stock.value),
      imageUrl,
      active: f.active.value === "true",
    };

    let productId = f.id.value;
    if (productId) {
      await updateDoc(doc(db, "shops", SHOP_ID, "products", productId), data);
    } else {
      const docRef = await addDoc(collection(db, "shops", SHOP_ID, "products"), data);
      productId = docRef.id;
    }

    // Owner-controlled notifications: only sent when explicitly requested,
    // never automatically for routine edits.
    if ($("#product-notify").checked) {
      let type = "general";
      if (!existing) type = "new_product";
      else if (oldPrice !== undefined && oldPrice !== data.price) type = "price_update";
      else if (oldStock <= 0 && data.stock > 0) type = "back_in_stock";

      await createAnnouncementAndNotify({
        type,
        title_en: notifyTitleFor(type, "en", data),
        title_ml: notifyTitleFor(type, "ml", data),
        body_en: notifyBodyFor(type, "en", data, oldPrice),
        body_ml: notifyBodyFor(type, "ml", data, oldPrice),
        productId,
        sendNotification: true,
      });
    }

    closeModal("modal-product-form");
    toast("Product saved.");
  } catch (err) {
    console.error(err);
    toast("Could not save product.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Product";
  }
});

async function deleteProduct(id) {
  if (!confirm("Delete this product? Past orders will keep showing the product name and price as they were.")) return;
  // Historical orders store their own copy of name/price (see checkout code),
  // so deleting the product here never changes old order records.
  await deleteDoc(doc(db, "shops", SHOP_ID, "products", id));
}

// Resize/compress before upload, then send to Cloudinary (free tier, no
// billing card needed — Firebase Storage now requires the paid Blaze plan).
async function uploadProductImage(file) {
  const MAX_DIM = 900;
  const blob = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
    };
    img.src = URL.createObjectURL(file);
  });

  const formData = new FormData();
  formData.append("file", blob);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  if (!res.ok) throw new Error("Image upload failed");
  const data = await res.json();
  return data.secure_url; // saved on the product doc, same as the old Storage URL was
}

$("#product-form [name='imageFile']").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = $("#product-image-preview");
  preview.src = URL.createObjectURL(file);
  show(preview);
});

// =================================================================
// OWNER "NEW ORDER" PUSH ALERTS — this registers the device to RECEIVE
// alerts. Actually SENDING each alert happens instantly via the push
// relay Worker the moment a customer places an order (see
// customer/js/app.js's checkout handler, and /server/push-relay).
// =================================================================
$("#btn-enable-order-alerts").addEventListener("click", async () => {
  try {
    if (!("Notification" in window)) { toast("Notifications aren't supported on this browser."); return; }
    if (Notification.permission === "denied") { toast("Notifications are blocked in your browser settings."); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const supported = await messagingIsSupported().catch(() => false);
    if (!supported) { toast("Push isn't supported on this browser."); return; }

    const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!fcmToken) return;

    await setDoc(doc(db, "ownerNotificationTokens", fcmToken), {
      shopId: SHOP_ID,
      updatedAt: serverTimestamp(),
    });
    toast("New order alerts enabled on this device.");
  } catch (err) {
    console.warn(err);
    toast("Could not enable alerts.");
  }
});

// =================================================================
// DASHBOARD
// =================================================================
function renderDashboard() {
  const threshold = shopSettings.lowStockThreshold ?? 5;
  $("#stat-products").textContent = products.length;
  const lowStockProducts = products.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= threshold);
  $("#stat-low").textContent = lowStockProducts.length;
  $("#stat-out").textContent = products.filter((p) => (p.stock ?? 0) <= 0).length;
  $("#stat-new").textContent = orders.filter((o) => o.status === "New").length;

  const todayStr = new Date().toDateString();
  const todaysOrders = orders.filter((o) => o.createdAt?.toDate && o.createdAt.toDate().toDateString() === todayStr);
  $("#stat-today").textContent = todaysOrders.length;
  const todaysRevenue = todaysOrders
    .filter((o) => o.status !== "Cancelled")
    .reduce((sum, o) => sum + (o.total || 0), 0);
  $("#stat-revenue").textContent = formatCurrency(todaysRevenue);

  const outOfStockProducts = products.filter((p) => (p.stock ?? 0) <= 0);
  const needsRestock = [...lowStockProducts, ...outOfStockProducts];
  const panel = $("#low-stock-panel");
  panel.classList.toggle("hidden", needsRestock.length === 0);
  const listEl = $("#low-stock-list");
  listEl.innerHTML = "";
  needsRestock.forEach((p) => {
    const row = document.createElement("div");
    row.className = "alert-row";
    const stock = p.stock ?? 0;
    row.innerHTML = `
      <span>${escapeHtml(p.name_en || "")} — ${stock <= 0 ? "Out of stock" : `${stock} left`}</span>
      <button data-restock>Restock</button>
    `;
    row.querySelector("[data-restock]").addEventListener("click", () => openProductForm(p));
    listEl.appendChild(row);
  });

  const recent = $("#dashboard-recent-orders");
  recent.innerHTML = "";
  orders.slice(0, 6).forEach((o) => recent.appendChild(renderOrderCard(o)));
}

// =================================================================
// ORDERS
// =================================================================
// New-order indicator: a red dot on the "Orders" tab plus a toast + a short
// beep the moment an order actually arrives. Runs entirely off this
// existing listener, so it works immediately regardless of whether push
// notifications are enabled/permitted on this device.
let ordersFirstLoad = true;
let latestOrderTs = 0;

function listenOrders() {
  const q = query(collection(db, "shops", SHOP_ID, "orders"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOrdersList();
    renderDashboard();

    orders.forEach((o) => {
      const ts = o.createdAt?.toMillis ? o.createdAt.toMillis() : 0;
      if (ts > latestOrderTs) latestOrderTs = ts;
    });

    const lastSeen = Number(localStorage.getItem("admin_orders_last_seen") || 0);
    if (!ordersFirstLoad) {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const o = change.doc.data();
        const ts = o.createdAt?.toMillis ? o.createdAt.toMillis() : 0;
        if (ts > lastSeen) {
          toast(`🛒 New order from ${o.customerName || "a customer"}`);
          playNewOrderChime();
        }
      });
    }
    ordersFirstLoad = false;
    setOrdersBadge(latestOrderTs > lastSeen);
  });
}

function setOrdersBadge(on) {
  const dot = $("#admin-orders-dot");
  if (dot) dot.classList.toggle("hidden", !on);
}

function markOrdersSeen() {
  localStorage.setItem("admin_orders_last_seen", String(latestOrderTs || Date.now()));
  setOrdersBadge(false);
}

// Small two-tone beep so the shop owner notices a new order even with the
// screen unlocked but the tab in the background. No audio file needed.
function playNewOrderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1174].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.12);
    });
  } catch {
    // Autoplay/audio restrictions on some browsers — the visual badge and toast still work.
  }
}

let selectedOrderIds = new Set();

function renderOrdersList() {
  const filter = $("#order-status-filter").value;
  const list = $("#orders-list");
  list.innerHTML = "";
  const visible = orders.filter((o) => filter === "all" || o.status === filter);
  selectedOrderIds = new Set([...selectedOrderIds].filter((id) => visible.some((o) => o.id === id)));
  visible.forEach((o) => list.appendChild(renderOrderCard(o, true)));
  updateOrdersBulkBar();
}
$("#order-status-filter").addEventListener("change", renderOrdersList);

function renderOrderCard(o, clickable = false) {
  const div = document.createElement("div");
  div.className = "order-card-admin" + (o.status === "New" ? " is-new" : "");
  div.innerHTML = `
    <div class="order-card-top">
      ${clickable ? `<input type="checkbox" class="order-select-checkbox" ${selectedOrderIds.has(o.id) ? "checked" : ""} />` : ""}
      <strong style="flex:1">${o.id}</strong>
      <span class="badge">${o.status}</span>
    </div>
    <div class="muted" style="font-size:13px">${escapeHtml(o.customerName || "")} · ${escapeHtml(o.phone || "")} · ${formatCurrency(o.total)}</div>
  `;
  if (clickable) {
    div.addEventListener("click", () => openOrderDetail(o));
    const cb = div.querySelector(".order-select-checkbox");
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      if (e.target.checked) selectedOrderIds.add(o.id);
      else selectedOrderIds.delete(o.id);
      updateOrdersBulkBar();
    });
  }
  return div;
}

function updateOrdersBulkBar() {
  const bar = $("#orders-bulk-bar");
  const n = selectedOrderIds.size;
  bar.classList.toggle("hidden", n === 0);
  $("#orders-selected-count").textContent = `${n} selected`;
}

$("#btn-bulk-status-apply").addEventListener("click", async () => {
  const n = selectedOrderIds.size;
  if (n === 0) return;
  const newStatus = $("#bulk-status-select").value;
  const batch = writeBatch(db);
  selectedOrderIds.forEach((id) => {
    batch.update(doc(db, "shops", SHOP_ID, "orders", id), { status: newStatus, updatedAt: serverTimestamp() });
  });
  await batch.commit();
  toast(`${n} order(s) marked ${newStatus}.`);
  selectedOrderIds = new Set();
  renderOrdersList();
});

function openOrderDetail(o) {
  const itemsHtml = (o.items || [])
    .map((i) => `<div class="row-item">${escapeHtml(i.name_en)} × ${i.qty} — ${formatCurrency(i.price * i.qty)}</div>`)
    .join("");

  $("#order-detail-body").innerHTML = `
    <h2>${o.id}</h2>
    <p><strong>${escapeHtml(o.customerName || "")}</strong><br/>${escapeHtml(o.phone || "")}${o.address ? `<br/>${escapeHtml(o.address)}` : ""}</p>
    ${o.note ? `<p><em>Note: ${escapeHtml(o.note)}</em></p>` : ""}
    <div>${itemsHtml}</div>
    <p><strong>Total: ${formatCurrency(o.total)}</strong></p>
    <label>Status</label>
    <select id="order-status-select" class="order-status-select">
      ${["New", "Confirmed", "Preparing", "Ready", "Completed", "Cancelled"]
        .map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
    </select>
  `;
  $("#order-status-select").addEventListener("change", async (e) => {
    await updateDoc(doc(db, "shops", SHOP_ID, "orders", o.id), { status: e.target.value, updatedAt: serverTimestamp() });
    toast("Order status updated.");
  });
  openModal("modal-order-detail");
}

// =================================================================
// ANNOUNCEMENTS
// =================================================================
function listenAnnouncements() {
  const q = query(collection(db, "shops", SHOP_ID, "notifications"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const list = $("#announcements-list");
    list.innerHTML = "";
    snap.forEach((d) => {
      const n = d.data();
      const div = document.createElement("div");
      div.className = "announcement-card";
      div.innerHTML = `<strong>${escapeHtml(n.title_en || "")}</strong><div class="muted">${escapeHtml(n.body_en || "")}</div>`;
      list.appendChild(div);
    });
  });
}

$("#btn-new-announcement").addEventListener("click", () => {
  $("#announcement-form").reset();
  openModal("modal-announcement-form");
});

$("#announcement-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  await createAnnouncementAndNotify({
    type: f.type.value,
    title_en: f.title_en.value.trim(),
    title_ml: f.title_ml.value.trim(),
    body_en: f.body_en.value.trim(),
    body_ml: f.body_ml.value.trim(),
    sendNotification: f.sendNotification.value === "true",
  });
  closeModal("modal-announcement-form");
  toast("Announcement sent.");
});

// Writes one record that the customer app's Notifications tab reads
// directly (works even if push delivery is skipped or fails), AND fires
// the push relay Worker instantly so subscribed devices get a real phone
// notification right away.
async function createAnnouncementAndNotify({ type, title_en, title_ml, body_en, body_ml, productId, sendNotification }) {
  const ref = await addDoc(collection(db, "shops", SHOP_ID, "notifications"), {
    type, title_en, title_ml, body_en, body_ml,
    productId: productId || null,
    sendPush: !!sendNotification,
    pushSent: false, // flipped to true by the push relay once it actually delivers — see /server/push-relay
    createdAt: serverTimestamp(),
  });

  if (sendNotification) {
    triggerPushRelay(PUSH_RELAY_URL, PUSH_RELAY_KEY, "notification", SHOP_ID, ref.id);
  }
}

function notifyTitleFor(type, lang, data) {
  const map = {
    new_product: { en: "New Product Available", ml: "പുതിയ ഉൽപ്പന്നം ലഭ്യമാണ്" },
    price_update: { en: "Price Updated", ml: "വില പുതുക്കി" },
    back_in_stock: { en: "Back in Stock", ml: "വീണ്ടും ലഭ്യമാണ്" },
    general: { en: "Shop Update", ml: "ഷോപ്പ് അപ്ഡേറ്റ്" },
  };
  return map[type]?.[lang] || map.general[lang];
}
function notifyBodyFor(type, lang, data, oldPrice) {
  const name = lang === "ml" && data.name_ml ? data.name_ml : data.name_en;
  if (type === "price_update") return lang === "ml" ? `${name} ഇപ്പോൾ ₹${data.price}` : `${name} is now ₹${data.price}`;
  if (type === "new_product") return lang === "ml" ? `${name} ഇപ്പോൾ ലഭ്യമാണ്.` : `${name} is now available.`;
  if (type === "back_in_stock") return lang === "ml" ? `${name} വീണ്ടും ലഭ്യമാണ്.` : `${name} is available again.`;
  return name || "";
}

// =================================================================
// CLEAR ALL — permanently wipes an entire subcollection. Deletes in
// batches of 400 (Firestore's limit per batch is 500) so this works even
// with hundreds of old orders/announcements.
// =================================================================
async function clearCollection(subpath, confirmMsg) {
  if (!confirm(confirmMsg)) return;
  const snap = await getDocs(collection(db, "shops", SHOP_ID, subpath));
  const docs = snap.docs;
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  toast(`Cleared ${docs.length} item(s).`);
}

$("#btn-clear-orders").addEventListener("click", () =>
  clearCollection("orders", "Delete ALL orders permanently? This cannot be undone.")
);
$("#btn-clear-announcements").addEventListener("click", () =>
  clearCollection("notifications", "Delete ALL announcements permanently? Customers will no longer see them in their Notifications tab. This cannot be undone.")
);

// =================================================================
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
