/**
 * scripts/send-push/index.js
 *
 * WHY THIS EXISTS
 * Actually delivering a push notification as a popup on someone's phone
 * requires calling Firebase Cloud Messaging's send API from a trusted
 * server (never from a browser, which can't safely hold admin
 * credentials). Firebase's own server option for this is Cloud Functions
 * — but Cloud Functions requires the paid "Blaze" plan to deploy at all,
 * even if actual usage stays inside the free monthly quota. Since this
 * project intentionally never attaches a billing card, this script does
 * the exact same job as the (undeployed) functions/index.js, but runs on
 * a schedule in GitHub Actions instead — which is genuinely free, needs
 * no card, and needs no server you have to maintain.
 *
 * WHAT IT DOES, EVERY TIME IT RUNS
 *   1. Looks for shop notifications with sendPush=true and pushSent=false,
 *      sends them to every subscribed customer device, marks them sent.
 *   2. Looks for orders with status="New" and ownerAlertSent=false, sends
 *      a "🛒 New Order" push to every device the shop owner enabled alerts
 *      on, marks them sent.
 *   3. Cleans up device tokens that FCM reports as dead (uninstalled app,
 *      revoked permission, etc.) so future sends don't waste time on them.
 *
 * LATENCY: this runs on a schedule (see ../.github/workflows/send-push.yml),
 * not instantly on write like a Cloud Function would. A few minutes' delay
 * is the trade-off for not needing a billing card — for a local shop's
 * order/announcement volume this is normally unnoticeable.
 *
 * SETUP: see scripts/send-push/README.md — you only need to do this once.
 */

const admin = require("firebase-admin");

const SHOP_ID = process.env.SHOP_ID || "main";
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable. See scripts/send-push/README.md.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
});

const db = admin.firestore();
const messaging = admin.messaging();

async function main() {
  const results = { notifications: 0, orderAlerts: 0, prunedTokens: 0 };

  await sendPendingNotifications(results);
  await sendPendingOrderAlerts(results);

  console.log(
    `Done. Sent ${results.notifications} customer notification(s), ` +
    `${results.orderAlerts} owner order alert(s), pruned ${results.prunedTokens} dead token(s).`
  );
}

async function sendPendingNotifications(results) {
  const snap = await db
    .collection("shops").doc(SHOP_ID).collection("notifications")
    .where("sendPush", "==", true)
    .where("pushSent", "==", false)
    .get();

  if (snap.empty) return;

  const subsSnap = await db
    .collection("notificationSubscriptions")
    .where("shopId", "==", SHOP_ID)
    .get();
  if (subsSnap.empty) {
    // No subscribed devices yet — still mark as sent so we don't retry forever.
    await Promise.all(snap.docs.map((d) => d.ref.update({ pushSent: true })));
    return;
  }

  const tokensByLang = { en: [], ml: [] };
  subsSnap.forEach((doc) => {
    const lang = doc.data().lang === "ml" ? "ml" : "en";
    tokensByLang[lang].push(doc.id);
  });

  for (const doc of snap.docs) {
    const data = doc.data();
    const enResult = await sendToTokens(tokensByLang.en, data.title_en, data.body_en);
    const mlResult = await sendToTokens(tokensByLang.ml, data.title_ml || data.title_en, data.body_ml || data.body_en);
    results.notifications += 1;
    results.prunedTokens += await pruneDeadTokens("notificationSubscriptions", [enResult, mlResult]);
    await doc.ref.update({ pushSent: true });
  }
}

async function sendPendingOrderAlerts(results) {
  const snap = await db
    .collection("shops").doc(SHOP_ID).collection("orders")
    .where("status", "==", "New")
    .where("ownerAlertSent", "==", false)
    .get();

  if (snap.empty) return;

  const tokensSnap = await db
    .collection("ownerNotificationTokens")
    .where("shopId", "==", SHOP_ID)
    .get();
  if (tokensSnap.empty) {
    await Promise.all(snap.docs.map((d) => d.ref.update({ ownerAlertSent: true })));
    return;
  }
  const tokens = tokensSnap.docs.map((d) => d.id);

  for (const doc of snap.docs) {
    const order = doc.data();
    const result = await sendToTokens(
      tokens,
      "🛒 New Order",
      `${order.customerName || "A customer"} placed order ${doc.id} (₹${order.total ?? "?"}).`
    );
    results.orderAlerts += 1;
    results.prunedTokens += await pruneDeadTokens("ownerNotificationTokens", [result]);
    await doc.ref.update({ ownerAlertSent: true });
  }
}

async function sendToTokens(tokens, title, body) {
  if (!tokens.length || !title) return null;
  // FCM allows max 500 tokens per multicast call — chunk if a shop ever
  // grows past that many subscribed devices.
  const allResponses = [];
  const allTokens = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
      });
      allResponses.push(...res.responses);
      allTokens.push(...chunk);
    } catch (err) {
      console.error("Push send failed for a batch:", err.message);
    }
  }
  return { tokens: allTokens, responses: allResponses };
}

// Removes tokens FCM reports as permanently invalid (app uninstalled,
// notifications revoked, etc.) so future runs don't keep trying them.
async function pruneDeadTokens(collectionName, sendResults) {
  let pruned = 0;
  for (const result of sendResults) {
    if (!result) continue;
    for (let i = 0; i < result.responses.length; i++) {
      const res = result.responses[i];
      if (res.success) continue;
      const code = res.error?.code || "";
      if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
        await db.collection(collectionName).doc(result.tokens[i]).delete().catch(() => {});
        pruned += 1;
      }
    }
  }
  return pruned;
}

main().catch((err) => {
  console.error("send-push failed:", err);
  process.exit(1);
});
