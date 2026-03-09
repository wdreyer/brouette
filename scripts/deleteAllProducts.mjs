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

let deletedProducts = 0;
let deletedVariants = 0;
let deletedOfferItems = 0;

const productsSnap = await db.collection("products").get();
for (const productDoc of productsSnap.docs) {
  const variantsSnap = await productDoc.ref.collection("variants").get();
  for (const variantDoc of variantsSnap.docs) {
    await variantDoc.ref.delete();
    deletedVariants += 1;
  }
  await productDoc.ref.delete();
  deletedProducts += 1;
}

const distributionsSnap = await db.collection("distributionDates").get();
for (const distributionDoc of distributionsSnap.docs) {
  const offerItemsSnap = await distributionDoc.ref.collection("offerItems").get();
  for (const offerItemDoc of offerItemsSnap.docs) {
    await offerItemDoc.ref.delete();
    deletedOfferItems += 1;
  }
}

console.log(`Deleted products: ${deletedProducts}`);
console.log(`Deleted variants: ${deletedVariants}`);
console.log(`Deleted offerItems: ${deletedOfferItems}`);
