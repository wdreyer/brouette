import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
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

const producerTemplates = [
  {
    name: "Domaine des Coteaux",
    email: "bonjour@coteaux.bio",
    phone: "06 88 52 31 02",
    coopStatus: "actif",
    notes: "Fruits et vergers.",
  },
  {
    name: "Ferme du Ruisseau",
    email: "contact@fermeduruisseau.fr",
    phone: "06 32 44 10 18",
    coopStatus: "actif",
    notes: "Maraichage, legumes de saison.",
  },
  {
    name: "Les Jardins du Vent",
    email: "hello@jardinsduvent.fr",
    phone: "06 27 40 63 19",
    coopStatus: "actif",
    notes: "Herbes, aromates, fleurs comestibles.",
  },
  {
    name: "La Laiterie d'Opale",
    email: "contact@laiterie-opale.fr",
    phone: "06 71 18 55 90",
    coopStatus: "actif",
    notes: "Oeufs et produits laitiers.",
  },
];

const producersSnap = await getDocs(query(collection(db, "producers")));
const producers = producersSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  data: docSnap.data(),
}));

const keepIds = [];

for (let i = 0; i < producerTemplates.length; i += 1) {
  const docSnap = producers[i] ?? null;
  if (!docSnap) {
    const newRef = doc(collection(db, "producers"));
    await setDoc(newRef, producerTemplates[i], { merge: true });
    keepIds.push(newRef.id);
  } else {
    await setDoc(doc(db, "producers", docSnap.id), producerTemplates[i], { merge: true });
    keepIds.push(docSnap.id);
  }
}

for (const producer of producers.slice(4)) {
  await deleteDoc(doc(db, "producers", producer.id));
}

const categoryToProducerIndex = {
  fruits: 0,
  legumes: 1,
  herbes: 2,
  "oeufs-laitages": 3,
  epicerie: 0,
};

const productsSnap = await getDocs(query(collection(db, "products")));
let updated = 0;
let idx = 0;
for (const productDoc of productsSnap.docs) {
  const data = productDoc.data();
  const categoryId = data.categoryId;
  const mappedIndex =
    categoryId && categoryToProducerIndex[categoryId] !== undefined
      ? categoryToProducerIndex[categoryId]
      : idx % keepIds.length;
  const producerId = keepIds[mappedIndex];
  await setDoc(doc(db, "products", productDoc.id), { producerId }, { merge: true });
  updated += 1;
  idx += 1;
}

console.log(`Kept ${keepIds.length} producers, updated ${updated} products.`);
