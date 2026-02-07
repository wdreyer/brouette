import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, query, where } from "firebase/firestore";

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

const openSnap = await getDocs(query(collection(db, "distributionDates"), where("status", "==", "open")));
console.log(`Open distributions: ${openSnap.size}`);
if (openSnap.empty) {
  process.exit(0);
}

for (const docSnap of openSnap.docs) {
  const data = docSnap.data();
  const dates = (data.dates ?? []).map((d) => d.toDate?.()?.toISOString?.().slice(0, 10) ?? "?");
  console.log(`- ${docSnap.id} dates: ${dates.join(", ")}`);

  const offerSnap = await getDocs(collection(db, "distributionDates", docSnap.id, "offerItems"));
  console.log(`  offerItems: ${offerSnap.size}`);
  const productIds = new Set();
  offerSnap.docs.forEach((offerDoc) => {
    const offer = offerDoc.data();
    if (offer.productId) productIds.add(String(offer.productId));
  });
  console.log(`  distinct products in offers: ${productIds.size}`);
}
