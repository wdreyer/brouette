import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, query, setDoc, doc } from "firebase/firestore";

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

const distSnap = await getDocs(query(collection(db, "distributionDates")));
const distributions = distSnap.docs
  .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
  .filter((dist) => Array.isArray(dist.dates));

distributions.sort((a, b) => {
  const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
  const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
  return aDate.getTime() - bDate.getTime();
});

if (!distributions.length) {
  console.log("No distributions with dates found.");
  process.exit(0);
}

const productSaleMap = {
  pr1: [0],
  pr2: [0, 1],
  pr3: [0],
  pr4: [1],
  pr5: [0, 1],
  pr6: [1],
  pr7: [2],
  pr8: [2],
  pr9: [1],
  pr10: [2],
};

const productsSnap = await getDocs(collection(db, "products"));
for (const docSnap of productsSnap.docs) {
  const indexes = productSaleMap[docSnap.id] ?? [0];
  const saleDates = indexes.flatMap((index) => distributions[index]?.dates ?? []);
  await setDoc(doc(db, "products", docSnap.id), { saleDates }, { merge: true });
}

console.log(`Updated ${productsSnap.size} products with saleDates.`);
