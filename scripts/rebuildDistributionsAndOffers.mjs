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

function nextWednesday(base = new Date()) {
  const date = new Date(base);
  const day = date.getDay(); // 0=Sunday, 3=Wednesday
  const diff = (3 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  date.setHours(18, 0, 0, 0);
  return date;
}

const productsSnap = await getDocs(collection(db, "products"));
const producersSnap = await getDocs(collection(db, "producers"));

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

// Delete existing distributions and subcollections
const distSnap = await getDocs(collection(db, "distributionDates"));
for (const docSnap of distSnap.docs) {
  const ref = docSnap.ref;
  await deleteSubcollection(ref, "offerItems");
  await deleteSubcollection(ref, "producers");
  await deleteDoc(ref);
}

// Create 4 future distributions, first one open
const start = nextWednesday();
const newDistIds = [];
for (let i = 0; i < 4; i += 1) {
  const base = new Date(start);
  base.setDate(start.getDate() + i * 42);
  const dates = [0, 14, 28].map((offset) => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return Timestamp.fromDate(date);
  });
  const ref = doc(collection(db, "distributionDates"));
  const isOpen = i === 0;
  const batch = writeBatch(db);
  batch.set(ref, {
    status: isOpen ? "open" : "planned",
    dates,
    openedAt: isOpen ? Timestamp.now() : null,
  });
  await batch.commit();
  newDistIds.push(ref.id);
}

const openDistId = newDistIds[0];
const distRef = doc(db, "distributionDates", openDistId);

// Create producers subcollection for the open distribution
{
  const batch = writeBatch(db);
  producers.forEach((producer) => {
    const ref = doc(collection(distRef, "producers"), producer.id);
    batch.set(ref, { producerId: producer.id, active: true });
  });
  await batch.commit();
}

// Create offerItems for all products/variants for each of 3 dates
{
  let batch = writeBatch(db);
  let count = 0;
  for (const product of products) {
    const variants = variantsByProduct.get(product.id) ?? [];
    for (const variant of variants) {
      for (let dateIndex = 0; dateIndex < 3; dateIndex += 1) {
        const ref = doc(collection(distRef, "offerItems"));
        const limitTotal = Math.random() > 0.6 ? 10 + Math.floor(Math.random() * 30) : 0;
        const limitPerMember = limitTotal === 0 && Math.random() > 0.6 ? 2 + Math.floor(Math.random() * 4) : 0;
        batch.set(ref, {
          producerId: product.producerId ?? null,
          productId: product.id,
          variantId: variant.id,
          dateIndex,
          limitPerMember,
          limitTotal,
          price: Number(variant.price ?? 0),
          title: product.name ?? "",
          variantLabel: variant.label ?? "",
          imageUrl: product.imageUrl ?? null,
          isOrganic: Boolean(product.isOrganic),
          categoryId: product.categoryId ?? null,
        });
        count += 1;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
    }
  }
  if (count > 0) {
    await batch.commit();
  }
}

console.log("Rebuild done: 4 distributions, open distribution seeded with offers.");
