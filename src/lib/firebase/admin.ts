import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    const raw = fs.readFileSync(credentialPath, "utf8");
    return JSON.parse(raw);
  }

  throw new Error(
    "Missing Firebase admin credentials. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.",
  );
}

export function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(getServiceAccount()),
    });
  }
  return getFirestore();
}
