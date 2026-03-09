import fs from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const adminCredentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const adminJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!adminCredentialPath && !adminJson) {
  throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = adminJson
  ? JSON.parse(adminJson)
  : JSON.parse(fs.readFileSync(adminCredentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const adminEmail = (process.env.ADMIN_EMAIL || "dreyer.wil@gmail.com").toLowerCase();

async function deleteAllDocuments(collectionName, predicate = () => true) {
  const snap = await db.collection(collectionName).get();
  let deleted = 0;
  for (const docSnap of snap.docs) {
    if (!predicate(docSnap)) continue;
    await docSnap.ref.delete();
    deleted += 1;
  }
  return deleted;
}

async function deleteAllProducts() {
  const productsSnap = await db.collection("products").get();
  let deletedProducts = 0;
  let deletedVariants = 0;

  for (const productDoc of productsSnap.docs) {
    const variantsSnap = await productDoc.ref.collection("variants").get();
    for (const variantDoc of variantsSnap.docs) {
      await variantDoc.ref.delete();
      deletedVariants += 1;
    }
    await productDoc.ref.delete();
    deletedProducts += 1;
  }

  return { deletedProducts, deletedVariants };
}

const { deletedProducts, deletedVariants } = await deleteAllProducts();
const deletedProducers = await deleteAllDocuments("producers");
const deletedMembers = await deleteAllDocuments("members", (docSnap) => {
  const email = String(docSnap.data().email || "").toLowerCase();
  return email !== adminEmail;
});

console.log(`Deleted products: ${deletedProducts}`);
console.log(`Deleted variants: ${deletedVariants}`);
console.log(`Deleted producers: ${deletedProducers}`);
console.log(`Deleted members (except ${adminEmail}): ${deletedMembers}`);
