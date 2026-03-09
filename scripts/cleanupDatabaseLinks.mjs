import fs from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountPath && !serviceAccountJson) {
  throw new Error(
    "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.",
  );
}

const serviceAccount = serviceAccountJson
  ? JSON.parse(serviceAccountJson)
  : JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const [producersSnap, productsSnap, distributionsSnap] = await Promise.all([
  db.collection("producers").get(),
  db.collection("products").get(),
  db.collection("distributionDates").get(),
]);

const producerIds = new Set(producersSnap.docs.map((d) => d.id));
const productMap = new Map(
  productsSnap.docs.map((d) => [
    d.id,
    { producerId: String(d.data().producerId || ""), ref: d.ref },
  ]),
);

let deletedProducerRows = 0;
let deletedOfferRows = 0;
let fixedOfferProducer = 0;

for (const distDoc of distributionsSnap.docs) {
  const producersRef = db.collection("distributionDates").doc(distDoc.id).collection("producers");
  const offersRef = db.collection("distributionDates").doc(distDoc.id).collection("offerItems");
  const [producerRowsSnap, offerRowsSnap] = await Promise.all([producersRef.get(), offersRef.get()]);

  if (!producerRowsSnap.empty) {
    let batch = db.batch();
    let batchOps = 0;
    for (const row of producerRowsSnap.docs) {
      const producerId = String(row.data().producerId || row.id);
      if (!producerIds.has(producerId)) {
        batch.delete(row.ref);
        deletedProducerRows += 1;
        batchOps += 1;
      }
      if (batchOps >= 450) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }
    if (batchOps > 0) {
      await batch.commit();
    }
  }

  if (!offerRowsSnap.empty) {
    let batch = db.batch();
    let batchOps = 0;
    for (const row of offerRowsSnap.docs) {
      const data = row.data();
      const productId = String(data.productId || "");
      const producerId = String(data.producerId || "");
      const variantId = String(data.variantId || "");
      const productEntry = productMap.get(productId);
      if (!productEntry || !producerIds.has(productEntry.producerId)) {
        batch.delete(row.ref);
        deletedOfferRows += 1;
        batchOps += 1;
      } else {
        const variantSnap = variantId
          ? await db.collection("products").doc(productId).collection("variants").doc(variantId).get()
          : null;
        if (variantId && !variantSnap?.exists) {
          batch.delete(row.ref);
          deletedOfferRows += 1;
          batchOps += 1;
        } else if (!producerIds.has(producerId) || producerId !== productEntry.producerId) {
          batch.set(
            row.ref,
            { producerId: productEntry.producerId },
            { merge: true },
          );
          fixedOfferProducer += 1;
          batchOps += 1;
        }
      }

      if (batchOps >= 450) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }
    if (batchOps > 0) {
      await batch.commit();
    }
  }
}

const distributionsIds = new Set(distributionsSnap.docs.map((d) => d.id));
const ordersSnap = await db.collection("orders").get();
let fixedOrders = 0;
if (!ordersSnap.empty) {
  let batch = db.batch();
  let batchOps = 0;
  for (const orderDoc of ordersSnap.docs) {
    const distributionId = String(orderDoc.data().distributionId || "");
    if (distributionId && !distributionsIds.has(distributionId)) {
      batch.set(
        orderDoc.ref,
        {
          distributionId: null,
          legacyDistributionId: distributionId,
        },
        { merge: true },
      );
      fixedOrders += 1;
      batchOps += 1;
    }
    if (batchOps >= 450) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }
  if (batchOps > 0) {
    await batch.commit();
  }
}

console.log("Cleanup done");
console.log("Deleted distribution/producers rows:", deletedProducerRows);
console.log("Deleted offerItems rows:", deletedOfferRows);
console.log("Fixed offerItems producerId:", fixedOfferProducer);
console.log("Fixed orders with missing distribution:", fixedOrders);
