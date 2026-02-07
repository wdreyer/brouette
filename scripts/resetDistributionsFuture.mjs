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
  const batch = writeBatch(db);
  snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
}

function nextWednesday(base = new Date()) {
  const date = new Date(base);
  const day = date.getDay(); // 0=Sunday, 3=Wednesday
  const diff = (3 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  date.setHours(18, 0, 0, 0);
  return date;
}

async function resetDistributions() {
  const snapshot = await getDocs(collection(db, "distributionDates"));
  for (const docSnap of snapshot.docs) {
    const ref = docSnap.ref;
    await deleteSubcollection(ref, "producers");
    await deleteSubcollection(ref, "offerItems");
    await deleteDoc(ref);
  }

  const start = nextWednesday();
  const batch = writeBatch(db);
  for (let i = 0; i < 4; i += 1) {
    const base = new Date(start);
    base.setDate(start.getDate() + i * 42);
    const dates = [0, 14, 28].map((offset) => {
      const date = new Date(base);
      date.setDate(base.getDate() + offset);
      return Timestamp.fromDate(date);
    });
    const ref = doc(collection(db, "distributionDates"));
    batch.set(ref, {
      status: "planned",
      dates,
    });
  }
  await batch.commit();
}

await resetDistributions();
console.log("Distributions reset: 4 planned periods, 3 dates each.");
