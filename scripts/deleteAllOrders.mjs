import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
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

const ordersSnap = await getDocs(collection(db, "orders"));
let deleted = 0;

for (const orderDoc of ordersSnap.docs) {
  const itemsSnap = await getDocs(collection(db, "orders", orderDoc.id, "items"));
  for (const itemDoc of itemsSnap.docs) {
    await deleteDoc(doc(db, "orders", orderDoc.id, "items", itemDoc.id));
  }
  await deleteDoc(doc(db, "orders", orderDoc.id));
  deleted += 1;
}

console.log(`Deleted ${deleted} orders (and their items).`);
