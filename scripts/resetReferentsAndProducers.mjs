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

async function deleteCollection(collectionName) {
  const snap = await db.collection(collectionName).get();
  let deleted = 0;
  for (const docSnap of snap.docs) {
    await docSnap.ref.delete();
    deleted += 1;
  }
  return deleted;
}

async function deleteReferents() {
  const snap = await db.collection("members").where("auth.role", "==", "referent").get();
  let deleted = 0;
  for (const docSnap of snap.docs) {
    const email = String(docSnap.data().email || "").toLowerCase();
    if (email === adminEmail) continue;
    await docSnap.ref.delete();
    deleted += 1;
  }
  return deleted;
}

const deletedProducers = await deleteCollection("producers");
const deletedReferents = await deleteReferents();

console.log(`Deleted producers: ${deletedProducers}`);
console.log(`Deleted referent members: ${deletedReferents}`);
