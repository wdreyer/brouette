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

const categories = [
  { id: "fruits", name: "Fruits", description: "Pommes, poires, petits fruits." },
  { id: "legumes", name: "Legumes", description: "Legumes de saison." },
  { id: "herbes", name: "Herbes & aromates", description: "Basilic, persil, menthe." },
  { id: "oeufs-laitages", name: "Oeufs & laitiers", description: "Oeufs, fromages, lait." },
  { id: "epicerie", name: "Epicerie locale", description: "Miel, confitures, conserves." },
];

const existingSnap = await getDocs(query(collection(db, "categories")));
const existingIds = new Set(existingSnap.docs.map((docSnap) => docSnap.id));

let created = 0;
for (const category of categories) {
  if (existingIds.has(category.id)) continue;
  await setDoc(doc(db, "categories", category.id), category, { merge: true });
  created += 1;
}

console.log(`Seeded ${created} categories.`);
