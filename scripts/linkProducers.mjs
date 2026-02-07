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

const producerTemplates = [
  {
    name: "Ferme du Ruisseau",
    email: "contact@fermeduruisseau.fr",
    phone: "06 32 44 10 18",
    coopStatus: "actif",
    notes: "Maraichage, herbes et legumes de saison.",
  },
  {
    name: "Domaine des Coteaux",
    email: "bonjour@coteaux.bio",
    phone: "06 88 52 31 02",
    coopStatus: "actif",
    notes: "Fruits et vergers.",
  },
  {
    name: "La Laiterie d'Opale",
    email: "contact@laiterie-opale.fr",
    phone: "06 71 18 55 90",
    coopStatus: "actif",
    notes: "Produits laitiers et oeufs.",
  },
  {
    name: "Les Jardins du Vent",
    email: "hello@jardinsduvent.fr",
    phone: "06 27 40 63 19",
    coopStatus: "actif",
    notes: "Legumes, aromates, fleurs comestibles.",
  },
];

const producersSnap = await getDocs(collection(db, "producers"));
const producerDocs = producersSnap.docs;

if (!producerDocs.length) {
  console.log("No producers found.");
  process.exit(0);
}

for (let index = 0; index < producerDocs.length; index += 1) {
  const docSnap = producerDocs[index];
  const template = producerTemplates[index % producerTemplates.length];
  await setDoc(doc(db, "producers", docSnap.id), template, { merge: true });
}

const productsSnap = await getDocs(collection(db, "products"));
const producerIds = producerDocs.map((docSnap) => docSnap.id);

let updated = 0;
for (let index = 0; index < productsSnap.docs.length; index += 1) {
  const productDoc = productsSnap.docs[index];
  const producerId = producerIds[index % producerIds.length];
  await setDoc(doc(db, "products", productDoc.id), { producerId }, { merge: true });
  updated += 1;
}

console.log(`Linked ${updated} products to ${producerIds.length} producers.`);
