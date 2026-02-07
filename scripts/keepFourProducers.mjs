import { initializeApp } from "firebase/app";
import {
  collection,
  getDocs,
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
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

const producersSnap = await getDocs(query(collection(db, "producers"), orderBy("name")));
const producers = producersSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  data: docSnap.data(),
}));

if (producers.length <= 4) {
  console.log(`Already ${producers.length} producers. Nothing to do.`);
  process.exit(0);
}

const keep = producers.slice(0, 4);
const keepIds = keep.map((producer) => producer.id);

const productsSnap = await getDocs(collection(db, "products"));
let updated = 0;
for (let index = 0; index < productsSnap.docs.length; index += 1) {
  const productDoc = productsSnap.docs[index];
  const producerId = keepIds[index % keepIds.length];
  await setDoc(doc(db, "products", productDoc.id), { producerId }, { merge: true });
  updated += 1;
}

let removed = 0;
for (const producer of producers.slice(4)) {
  await deleteDoc(doc(db, "producers", producer.id));
  removed += 1;
}

console.log(`Reassigned ${updated} products to 4 producers and removed ${removed} producers.`);
