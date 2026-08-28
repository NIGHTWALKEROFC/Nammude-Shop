// server/push-relay/worker.js
//
// Cloudflare Worker — Free plan (no credit card needed), no GitHub
// Actions, no Firebase Blaze billing plan.
//
// WHAT IT DOES
//   POST / with JSON body { type, shopId, id }
//     type: "notification"  -> delivers shops/{shopId}/notifications/{id}
//                               to every subscribed customer device
//     type: "order"          -> delivers a "New Order" alert for
//                               shops/{shopId}/orders/{id} to every device
//                               the shop owner enabled alerts on
//     type: "order_status"   -> delivers a status-update push (e.g.
//                               "Your order is ready!") to the ONE device
//                               that placed shops/{shopId}/orders/{id},
//                               using the token saved on that order at
//                               checkout time
//     type: "catchup"        -> re-checks every notification/order for
//                               this shop that is still unsent and (re)sends
//                               them. Called once whenever the customer or
//                               admin app opens.
//
// SETUP: see server/push-relay/README.md.

function withCors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Relay-Key");
  return resp;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (request.method !== "POST") return withCors(new Response("Method not allowed", { status: 405 }));

    if (!env.RELAY_KEY || request.headers.get("X-Relay-Key") !== env.RELAY_KEY) {
      return withCors(new Response("Unauthorized", { status: 401 }));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(new Response("Invalid JSON", { status: 400 }));
    }

    const { type, shopId } = body;
    if (!type || !shopId) return withCors(new Response("Missing type/shopId", { status: 400 }));

    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      const accessToken = await getAccessToken(serviceAccount);
      const projectId = serviceAccount.project_id;

      let result;
      if (type === "notification") result = await handleNotification(projectId, accessToken, shopId, body.id);
      else if (type === "order") result = await handleOrder(projectId, accessToken, shopId, body.id);
      else if (type === "order_status") result = await handleOrderStatus(projectId, accessToken, shopId, body.id);
      else if (type === "catchup") result = await handleCatchup(projectId, accessToken, shopId);
      else return withCors(new Response("Unknown type", { status: 400 }));

      return withCors(new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } }));
    } catch (err) {
      console.error(err);
      return withCors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }
  },
};

// ---------------------------------------------------------------
// Google OAuth2 (service account -> access token)
// ---------------------------------------------------------------
let cachedToken = null;

async function getAccessToken(serviceAccount) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64urlFromBuffer(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Could not get Google access token: " + JSON.stringify(data));

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

function base64url(str) {
  return base64urlFromBuffer(new TextEncoder().encode(str));
}
function base64urlFromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------
// Minimal Firestore REST helpers
// ---------------------------------------------------------------
function fsUrl(projectId, path) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

async function fsGet(projectId, accessToken, path) {
  const res = await fetch(fsUrl(projectId, path), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status}`);
  return decodeDoc(await res.json());
}

async function fsPatch(projectId, accessToken, path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${fsUrl(projectId, path)}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed: ${res.status}`);
}

async function fsDelete(projectId, accessToken, path) {
  await fetch(fsUrl(projectId, path), { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
}

async function fsQuery(projectId, accessToken, collectionId, parentPath, fieldFilters) {
  const structuredQuery = {
    from: [{ collectionId }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: fieldFilters.map((f) => ({
          fieldFilter: { field: { fieldPath: f.field }, op: "EQUAL", value: encodeValue(f.value) },
        })),
      },
    },
  };
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${parentPath ? "/" + parentPath : ""}:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`Firestore query ${collectionId} failed: ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), ...decodeDoc(r.document) }));
}

function encodeValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { nullValue: null };
}
function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
  return out;
}
function decodeValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue) return decodeDoc({ fields: v.mapValue.fields || {} });
  if (v.arrayValue) return (v.arrayValue.values || []).map(decodeValue);
  if (v.timestampValue !== undefined) return v.timestampValue;
  return null;
}
function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

// ---------------------------------------------------------------
// FCM HTTP v1
// ---------------------------------------------------------------
async function sendFcm(projectId, accessToken, token, title, body) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title, body } } }),
  });
  if (res.ok) return { success: true };
  const err = await res.json().catch(() => ({}));
  return { success: false, code: err?.error?.status || "" };
}

async function sendToTokens(projectId, accessToken, tokenDocs, title, body, tokenCollectionPath) {
  if (!tokenDocs.length || !title) return 0;
  let pruned = 0;
  await Promise.all(tokenDocs.map(async (t) => {
    const result = await sendFcm(projectId, accessToken, t.id, title, body);
    if (!result.success && ["UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"].includes(result.code)) {
      await fsDelete(projectId, accessToken, `${tokenCollectionPath}/${t.id}`);
      pruned++;
    }
  }));
  return pruned;
}

// ---------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------
async function handleNotification(projectId, accessToken, shopId, id) {
  const path = `shops/${shopId}/notifications/${id}`;
  const notif = await fsGet(projectId, accessToken, path);
  if (!notif || !notif.sendPush || notif.pushSent) return { skipped: true };

  const subs = await fsQuery(projectId, accessToken, "notificationSubscriptions", "", [{ field: "shopId", value: shopId }]);
  const byLang = { en: [], ml: [] };
  subs.forEach((s) => byLang[s.lang === "ml" ? "ml" : "en"].push(s));

  let pruned = 0;
  pruned += await sendToTokens(projectId, accessToken, byLang.en, notif.title_en, notif.body_en, "notificationSubscriptions");
  pruned += await sendToTokens(projectId, accessToken, byLang.ml, notif.title_ml || notif.title_en, notif.body_ml || notif.body_en, "notificationSubscriptions");

  await fsPatch(projectId, accessToken, path, { pushSent: true });
  return { sent: subs.length, pruned };
}

async function handleOrder(projectId, accessToken, shopId, id) {
  const path = `shops/${shopId}/orders/${id}`;
  const order = await fsGet(projectId, accessToken, path);
  if (!order || order.ownerAlertSent) return { skipped: true };

  const tokens = await fsQuery(projectId, accessToken, "ownerNotificationTokens", "", [{ field: "shopId", value: shopId }]);
  const pruned = await sendToTokens(
    projectId, accessToken, tokens,
    "🛒 New Order",
    `${order.customerName || "A customer"} placed order ${id} (₹${order.total ?? "?"}).`,
    "ownerNotificationTokens"
  );

  await fsPatch(projectId, accessToken, path, { ownerAlertSent: true });
  return { sent: tokens.length, pruned };
}

// Order-status message text, keyed by status then language. "New" has no
// entry — that's the initial state, not a status change worth pushing.
const STATUS_MESSAGES = {
  Confirmed: { en: "Your order has been confirmed!", ml: "നിങ്ങളുടെ ഓർഡർ സ്ഥിരീകരിച്ചു!" },
  Preparing: { en: "Your order is being prepared.", ml: "നിങ്ങളുടെ ഓർഡർ തയ്യാറാക്കുന്നു." },
  Ready: { en: "Your order is ready!", ml: "നിങ്ങളുടെ ഓർഡർ തയ്യാറാണ്!" },
  Completed: { en: "Your order is complete. Thank you!", ml: "നിങ്ങളുടെ ഓർഡർ പൂർത്തിയായി. നന്ദി!" },
  Cancelled: { en: "Your order has been cancelled.", ml: "നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി." },
};

async function handleOrderStatus(projectId, accessToken, shopId, id) {
  const path = `shops/${shopId}/orders/${id}`;
  const order = await fsGet(projectId, accessToken, path);
  if (!order || !order.customerToken) return { skipped: true }; // customer never enabled notifications for this order
  if (order.lastNotifiedStatus === order.status) return { skipped: true }; // avoid duplicate sends for the same status

  const msg = STATUS_MESSAGES[order.status];
  if (!msg) return { skipped: true };

  const lang = order.lang === "ml" ? "ml" : "en";
  const result = await sendFcm(projectId, accessToken, order.customerToken, `Order ${id}`, msg[lang]);

  if (!result.success && ["UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"].includes(result.code)) {
    // Token's stale (e.g. they cleared browser data) — clear it so future
    // status changes on this order don't keep failing the same way.
    await fsPatch(projectId, accessToken, path, { customerToken: null, lastNotifiedStatus: order.status });
    return { sent: false, pruned: true };
  }

  await fsPatch(projectId, accessToken, path, { lastNotifiedStatus: order.status });
  return { sent: result.success };
}

async function handleCatchup(projectId, accessToken, shopId) {
  const pendingNotifs = await fsQuery(projectId, accessToken, "notifications", `shops/${shopId}`, [
    { field: "sendPush", value: true },
    { field: "pushSent", value: false },
  ]);
  const pendingOrders = await fsQuery(projectId, accessToken, "orders", `shops/${shopId}`, [
    { field: "ownerAlertSent", value: false },
  ]);

  for (const n of pendingNotifs) await handleNotification(projectId, accessToken, shopId, n.id);
  for (const o of pendingOrders) await handleOrder(projectId, accessToken, shopId, o.id);

  // Note: order-status pushes are NOT retried by catchup — they're
  // real-time/best-effort only (there's no "pending" flag to track a
  // failed one against). If a status push is missed, the customer can
  // still see the current status any time via "My Orders" or the order
  // lookup, since that always reads live from Firestore.
  return { notifications: pendingNotifs.length, orders: pendingOrders.length };
}
