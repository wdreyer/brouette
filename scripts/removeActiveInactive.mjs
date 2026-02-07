import { initializeApp } from "firebase/app";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  updateDoc,
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

const productsSnap = await getDocs(collection(db, "products"));
let productUpdates = 0;
let variantUpdates = 0;

for (const product of productsSnap.docs) {
  await updateDoc(doc(db, "products", product.id), { status: deleteField() });
  productUpdates += 1;
  const variantsSnap = await getDocs(collection(db, "products", product.id, "variants"));
  for (const variant of variantsSnap.docs) {
    await updateDoc(doc(db, "products", product.id, "variants", variant.id), {
      status: deleteField(),
    });
    variantUpdates += 1;
  }
}

const categoriesSnap = await getDocs(collection(db, "categories"));
let categoryUpdates = 0;
for (const category of categoriesSnap.docs) {
  await updateDoc(doc(db, "categories", category.id), { status: deleteField() });
  categoryUpdates += 1;
}

console.log(
  `Removed status from ${productUpdates} products, ${variantUpdates} variants, ${categoryUpdates} categories.`,
);
