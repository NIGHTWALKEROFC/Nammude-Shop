/**
 * functions/index.js
 *
 * OPTIONAL. The rest of this project runs entirely on Firebase's free
 * Spark plan. These two functions are the ONE exception: actually
 * delivering a push notification to many devices requires the Firebase
 * Admin SDK, which can only run on a trusted server — a browser can never
 * safely hold the credentials to send pushes to other people's devices.
 * Cloud Functions is Firebase's option for that server, but Cloud
 * Functions requires the "Blaze" (pay-as-you-go) plan even to deploy,
 * because it needs a billing account on file. In everyday use for a shop
 * this size, the usage below stays inside Firebase's free monthly quota
 * (2,000,000 invocations, 400,000 GB-seconds compute) so the bill is
 * normally ₹0 / $0 — but a card must be attached to the account, and if
 * quotas are ever exceeded, charges apply. If you'd rather not attach a
 * card, skip deploying this folder: the site still works fully, except
 * push notifications won't physically arrive on customer/owner devices.
 * The in-app "Notifications" history still shows everything regardless
 * (see spec section 11) — that part needs no Cloud Function.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// Fires when the admin site (or a product-edit "notify customers") writes
// a new doc into shops/{shopId}/notifications.
exports.sendCustomerNotification = onDocumentCreated(
  "shops/{shopId}/notifications/{notificationId}",
  async (event) => {
    const data = event.data.data();
    if (!data.sendPush) return;

    const { shopId } = event.params;
    const subsSnap = await db.collection("notificationSubscriptions")
      .where("shopId", "==", shopId)
      .get();
    if (subsSnap.empty) return;

    const tokensByLang = { en: [], ml: [] };
    subsSnap.forEach((doc) => {
      const lang = doc.data().lang === "ml" ? "ml" : "en";
      tokensByLang[lang].push(doc.id);
    });

    await sendToTokens(tokensByLang.en, data.title_en, data.body_en);
    await sendToTokens(tokensByLang.ml, data.title_ml || data.title_en, data.body_ml || data.body_en);
  }
);

// Fires when a customer places a new order, alerts the shop owner.
exports.sendOwnerOrderAlert = onDocumentCreated(
  "shops/{shopId}/orders/{orderId}",
  async (event) => {
    const order = event.data.data();
    const { shopId, orderId } = event.params;

    const tokensSnap = await db.collection("ownerNotificationTokens")
      .where("shopId", "==", shopId)
      .get();
    if (tokensSnap.empty) return;

    const tokens = tokensSnap.docs.map((d) => d.id);
    await sendToTokens(tokens, "🛒 New Order", `New order ${orderId} received.`);
  }
);

async function sendToTokens(tokens, title, body) {
  if (!tokens.length || !title) return;
  // FCM allows max 500 tokens per multicast call — chunk if a shop ever
  // grows past that many subscribed devices.
  const messaging = getMessaging();
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
      });
    } catch (err) {
      console.error("Push send failed for a batch:", err.message);
    }
  }
}
