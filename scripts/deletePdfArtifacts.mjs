import fs from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

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

const storageBucket =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  `${serviceAccount.project_id}.firebasestorage.app`;

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    storageBucket,
  });
}

const db = getFirestore();
const bucket = getStorage().bucket(storageBucket);

const documentsSnap = await db.collection("documents").get();
const storagePaths = new Set();

for (const docSnap of documentsSnap.docs) {
  const path = docSnap.data()?.storagePath;
  if (typeof path === "string" && path.trim()) {
    storagePaths.add(path.trim());
  }
}

let deletedDocuments = 0;
for (let i = 0; i < documentsSnap.docs.length; i += 400) {
  const chunk = documentsSnap.docs.slice(i, i + 400);
  const batch = db.batch();
  for (const docSnap of chunk) {
    batch.delete(docSnap.ref);
  }
  await batch.commit();
  deletedDocuments += chunk.length;
}

let deletedReferencedFiles = 0;
for (const path of storagePaths) {
  await bucket.file(path).delete({ ignoreNotFound: true });
  deletedReferencedFiles += 1;
}

const [pdfFiles] = await bucket.getFiles({ prefix: "pdfs/" });
let deletedPrefixFiles = 0;
for (const file of pdfFiles) {
  await file.delete({ ignoreNotFound: true });
  deletedPrefixFiles += 1;
}

console.log(`Firestore documents deleted (collection documents): ${deletedDocuments}`);
console.log(`Storage files deleted from document paths: ${deletedReferencedFiles}`);
console.log(`Storage files deleted under prefix pdfs/: ${deletedPrefixFiles}`);
console.log(`Storage bucket used: ${storageBucket}`);
