import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, setDoc } from "firebase/firestore";

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

const categories = {
  fruits: ["pomme", "poire", "fraise", "framboise", "cerise", "prune", "peche", "abricot", "raisin"],
  legumes: ["carotte", "pomme de terre", "patate", "tomate", "salade", "courgette", "poireau", "oignon"],
  herbes: ["basilic", "persil", "menthe", "ciboulette", "thym", "romarin"],
  "oeufs-laitages": ["oeuf", "lait", "fromage", "yaourt", "beurre"],
  epicerie: ["miel", "confiture", "huile", "farine", "conserve"],
};

const productsSnap = await getDocs(collection(db, "products"));
let updated = 0;

for (const productDoc of productsSnap.docs) {
  const data = productDoc.data();
  const name = String(data.name ?? "").toLowerCase();
  let categoryId = "legumes";
  for (const [id, keywords] of Object.entries(categories)) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      categoryId = id;
      break;
    }
  }
  await setDoc(doc(db, "products", productDoc.id), { categoryId }, { merge: true });
  updated += 1;
}

console.log(`Assigned categories to ${updated} products.`);
