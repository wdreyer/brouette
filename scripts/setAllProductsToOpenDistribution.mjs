import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, query, setDoc, doc, where } from "firebase/firestore";

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

const openSnap = await getDocs(
  query(collection(db, "distributionDates"), where("status", "==", "open")),
);
const openDist = openSnap.docs[0]?.data();

if (!openDist?.dates?.length) {
  console.log("No open distribution with dates found.");
  process.exit(0);
}

const saleDates = openDist.dates;

const productsSnap = await getDocs(collection(db, "products"));
let updated = 0;
for (const product of productsSnap.docs) {
  await setDoc(doc(db, "products", product.id), { saleDates }, { merge: true });
  updated += 1;
}

console.log(`Updated ${updated} products with current open distribution dates.`);
