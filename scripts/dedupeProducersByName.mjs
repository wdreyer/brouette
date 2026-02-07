import { initializeApp } from "firebase/app";
import {
  collection,
  getDocs,
  getFirestore,
  query,
  doc,
  deleteDoc,
  setDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const required = Object.entries(firebaseConfig).filter(([, value]) => !value);
if (required.length) {
  const keys = required.map(([key]) => key).join(", ");
  throw new Error(`Missing Firebase env vars: ${keys}`);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const producersSnap = await getDocs(query(collection(db, "producers")));
const producers = producersSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  data: docSnap.data(),
}));

const normalize = (name) =>
  String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const groups = new Map();
for (const producer of producers) {
  const key = normalize(producer.data.name);
  if (!key) continue;
  const list = groups.get(key) ?? [];
  list.push(producer);
  groups.set(key, list);
}

const productsSnap = await getDocs(query(collection(db, "products")));
const products = productsSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  data: docSnap.data(),
}));

let reassigned = 0;
let removed = 0;

for (const [key, list] of groups.entries()) {
  if (list.length <= 1) continue;
  const keep = list[0];
  const duplicateIds = list.slice(1).map((p) => p.id);

  for (const product of products) {
    if (duplicateIds.includes(product.data.producerId)) {
      await setDoc(doc(db, "products", product.id), { producerId: keep.id }, { merge: true });
      reassigned += 1;
    }
  }

  for (const dupId of duplicateIds) {
    await deleteDoc(doc(db, "producers", dupId));
    removed += 1;
  }
}

console.log(`Reassigned ${reassigned} products and removed ${removed} duplicate producers.`);
