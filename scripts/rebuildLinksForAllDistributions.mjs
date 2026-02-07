import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  Timestamp,
  writeBatch,
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

async function deleteSubcollection(parentRef, name) {
  const snap = await getDocs(collection(parentRef, name));
  if (snap.empty) return;
  let batch = writeBatch(db);
  let count = 0;
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

function normalizeDates(baseDate) {
  const date = new Date(baseDate);
  date.setHours(18, 0, 0, 0);
  return [0, 14, 28].map((offset) => {
    const d = new Date(date);
    d.setDate(date.getDate() + offset);
    return Timestamp.fromDate(d);
  });
}

function nextWednesday(base = new Date()) {
  const date = new Date(base);
  const day = date.getDay();
  const diff = (3 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  date.setHours(18, 0, 0, 0);
  return date;
}

const productsSnap = await getDocs(collection(db, "products"));
const producersSnap = await getDocs(collection(db, "producers"));
const distributionsSnap = await getDocs(collection(db, "distributionDates"));

const products = productsSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  ...(docSnap.data() ?? {}),
}));
const producers = producersSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  ...(docSnap.data() ?? {}),
}));

const variantsByProduct = new Map();
for (const product of products) {
  const variantsSnap = await getDocs(collection(db, "products", product.id, "variants"));
  const variants = variantsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() ?? {}),
  }));
  variantsByProduct.set(product.id, variants);
}

const distDocs = distributionsSnap.docs;
let seedDate = nextWednesday();

for (let i = 0; i < distDocs.length; i += 1) {
  const distDoc = distDocs[i];
  const distRef = distDoc.ref;
  const data = distDoc.data();
  const firstDate = data.dates?.[0]?.toDate?.();
  const baseDate = firstDate || new Date(seedDate);
  if (!firstDate) {
    seedDate.setDate(seedDate.getDate() + 42);
  }
  const dates = normalizeDates(baseDate);

  await deleteSubcollection(distRef, "offerItems");
  await deleteSubcollection(distRef, "producers");

  const batch = writeBatch(db);
  batch.set(distRef, { dates }, { merge: true });

  producers.forEach((producer) => {
    const ref = doc(collection(distRef, "producers"), producer.id);
    batch.set(ref, { producerId: producer.id, active: true });
  });

  let count = 0;
  for (const product of products) {
    const variants = variantsByProduct.get(product.id) ?? [];
    for (const variant of variants) {
      for (let dateIndex = 0; dateIndex < 3; dateIndex += 1) {
        const ref = doc(collection(distRef, "offerItems"));
        batch.set(ref, {
          producerId: product.producerId ?? null,
          productId: product.id,
          variantId: variant.id,
          dateIndex,
          limitPerMember: 0,
          limitTotal: 0,
          price: Number(variant.price ?? 0),
          title: product.name ?? "",
          variantLabel: variant.label ?? "",
          imageUrl: product.imageUrl ?? null,
          isOrganic: Boolean(product.isOrganic),
          categoryId: product.categoryId ?? null,
        });
        count += 1;
        if (count >= 350) {
          await batch.commit();
          count = 0;
        }
      }
    }
  }

  await batch.commit();
}

console.log("Rebuild done: distributions normalized, offers/producers rebuilt.");
