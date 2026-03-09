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

let deletedOrders = 0;
let deletedOrderItems = 0;
let deletedDistributions = 0;
let deletedDistributionProducers = 0;
let deletedDistributionOffers = 0;

const ordersSnap = await db.collection("orders").get();
for (const orderDoc of ordersSnap.docs) {
  const itemsSnap = await orderDoc.ref.collection("items").get();
  for (const itemDoc of itemsSnap.docs) {
    await itemDoc.ref.delete();
    deletedOrderItems += 1;
  }
  await orderDoc.ref.delete();
  deletedOrders += 1;
}

const distSnap = await db.collection("distributionDates").get();
for (const distDoc of distSnap.docs) {
  const [producersSnap, offerItemsSnap] = await Promise.all([
    distDoc.ref.collection("producers").get(),
    distDoc.ref.collection("offerItems").get(),
  ]);

  for (const producerDoc of producersSnap.docs) {
    await producerDoc.ref.delete();
    deletedDistributionProducers += 1;
  }

  for (const offerDoc of offerItemsSnap.docs) {
    await offerDoc.ref.delete();
    deletedDistributionOffers += 1;
  }

  await distDoc.ref.delete();
  deletedDistributions += 1;
}

console.log(`Deleted orders: ${deletedOrders}`);
console.log(`Deleted order items: ${deletedOrderItems}`);
console.log(`Deleted distributions: ${deletedDistributions}`);
console.log(`Deleted distribution/producers: ${deletedDistributionProducers}`);
console.log(`Deleted distribution/offerItems: ${deletedDistributionOffers}`);
