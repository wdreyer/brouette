import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!credentialPath && !credentialJson) {
  throw new Error("Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = credentialJson
  ? JSON.parse(credentialJson)
  : JSON.parse(fs.readFileSync(credentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

async function deleteDocRefs(refs) {
  if (!refs.length) return 0;
  let deleted = 0;
  let batch = db.batch();
  let count = 0;
  for (const ref of refs) {
    batch.delete(ref);
    deleted += 1;
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }
  return deleted;
}

async function clearSubcollection(parentRef, name) {
  let total = 0;
  while (true) {
    const snap = await parentRef.collection(name).limit(400).get();
    if (snap.empty) break;
    total += await deleteDocRefs(snap.docs.map((docSnap) => docSnap.ref));
  }
  return total;
}

async function resetOrders() {
  const ordersSnap = await db.collection("orders").get();
  let ordersDeleted = 0;
  let orderItemsDeleted = 0;

  for (const orderDoc of ordersSnap.docs) {
    const itemsSnap = await orderDoc.ref.collection("items").get();
    orderItemsDeleted += await deleteDocRefs(itemsSnap.docs.map((docSnap) => docSnap.ref));
    await orderDoc.ref.delete();
    ordersDeleted += 1;
  }

  return { ordersDeleted, orderItemsDeleted };
}

async function resetDistributions() {
  const distSnap = await db.collection("distributionDates").get();
  let distributionsUpdated = 0;
  let producerLinksDeleted = 0;
  let offerItemsDeleted = 0;

  for (const distDoc of distSnap.docs) {
    producerLinksDeleted += await clearSubcollection(distDoc.ref, "producers");
    offerItemsDeleted += await clearSubcollection(distDoc.ref, "offerItems");

    await distDoc.ref.set(
      {
        status: "planned",
        openedAt: null,
        closeAt: null,
        closedAt: null,
      },
      { merge: true },
    );

    distributionsUpdated += 1;
  }

  return { distributionsUpdated, producerLinksDeleted, offerItemsDeleted };
}

const ordersResult = await resetOrders();
const distributionsResult = await resetDistributions();

console.log("resetSalesOpeningFlow done");
console.log(`- orders deleted: ${ordersResult.ordersDeleted}`);
console.log(`- order items deleted: ${ordersResult.orderItemsDeleted}`);
console.log(`- distributions updated to planned: ${distributionsResult.distributionsUpdated}`);
console.log(`- distribution producer links deleted: ${distributionsResult.producerLinksDeleted}`);
console.log(`- distribution offer items deleted: ${distributionsResult.offerItemsDeleted}`);
