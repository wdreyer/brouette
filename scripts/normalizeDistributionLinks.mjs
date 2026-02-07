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
const producerIds = new Set(producers.map((producer) => producer.id));

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
const distItems = distDocs.map((docSnap) => ({
  id: docSnap.id,
  ...(docSnap.data() ?? {}),
}));

// Choose one open distribution (earliest upcoming). If none, the earliest becomes open.
distItems.sort((a, b) => {
  const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
  const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
  return aDate.getTime() - bDate.getTime();
});

let openId = distItems.find((dist) => dist.status === "open")?.id;
if (!openId && distItems.length) openId = distItems[0].id;

let seedDate = nextWednesday();

for (const distDoc of distDocs) {
  const data = distDoc.data();
  const ref = distDoc.ref;
  const baseDate = data.dates?.[0]?.toDate?.() ?? seedDate;
  if (!data.dates?.[0]?.toDate?.()) {
    seedDate = new Date(seedDate);
    seedDate.setDate(seedDate.getDate() + 42);
  }
  const dates = normalizeDates(baseDate);

  await deleteSubcollection(ref, "offerItems");
  await deleteSubcollection(ref, "producers");

  const batch = writeBatch(db);
  batch.set(
    ref,
    {
      dates,
      status: ref.id === openId ? "open" : "planned",
      openedAt: ref.id === openId ? Timestamp.now() : null,
    },
    { merge: true },
  );

  const activeProducerIds = new Set(
    products
      .map((product) => String(product.producerId ?? ""))
      .filter((id) => id && producerIds.has(id)),
  );
  activeProducerIds.forEach((producerId) => {
    const producerRef = doc(collection(ref, "producers"), producerId);
    batch.set(producerRef, { producerId, active: true });
  });

  await batch.commit();

  let offerBatch = writeBatch(db);
  let count = 0;
  for (const product of products) {
    const producerId = String(product.producerId ?? "");
    if (!producerIds.has(producerId)) continue;
    const variants = variantsByProduct.get(product.id) ?? [];
    for (const variant of variants) {
      for (let dateIndex = 0; dateIndex < 3; dateIndex += 1) {
        const offerRef = doc(collection(ref, "offerItems"));
        offerBatch.set(offerRef, {
          producerId,
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
          await offerBatch.commit();
          offerBatch = writeBatch(db);
          count = 0;
        }
      }
    }
  }
  if (count > 0) await offerBatch.commit();
}

console.log("Normalize done: distributions updated, offers & producers rebuilt.");
