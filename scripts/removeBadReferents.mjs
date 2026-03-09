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

const hasDigits = (value) => /\d/.test(String(value || ""));

const snap = await db.collection("members").where("auth.role", "==", "referent").get();
let deleted = 0;

for (const docSnap of snap.docs) {
  const data = docSnap.data();
  const email = String(data.email || "").toLowerCase();
  if (email === adminEmail) continue;

  const firstName = data.firstName || "";
  const lastName = data.lastName || "";
  if (hasDigits(firstName) || hasDigits(lastName)) {
    await docSnap.ref.delete();
    deleted += 1;
  }
}

console.log(`Deleted bad referents: ${deleted}`);
