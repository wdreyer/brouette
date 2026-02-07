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
const openDoc = openSnap.docs[0];
if (!openDoc) {
  console.log("No open distribution found.");
  process.exit(0);
}

const productsSnap = await getDocs(collection(db, "products"));
const productIds = new Set(productsSnap.docs.map((docSnap) => docSnap.id));

const offerSnap = await getDocs(collection(db, "distributionDates", openDoc.id, "offerItems"));
const offerProductIds = offerSnap.docs.map((docSnap) => String(docSnap.data().productId ?? ""));

const missing = offerProductIds.filter((id) => id && !productIds.has(id));
console.log(`Open distribution: ${openDoc.id}`);
console.log(`Offer productIds: ${offerProductIds.length}`);
console.log(`Products collection: ${productIds.size}`);
console.log(`Missing productIds in products: ${missing.length}`);
if (missing.length) {
  console.log(`Sample missing: ${missing.slice(0, 5).join(", ")}`);
}
