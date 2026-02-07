import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, updateDoc, doc, Timestamp } from "firebase/firestore";

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

const snapshot = await getDocs(collection(db, "distributionDates"));
if (snapshot.empty) {
  console.log("No distribution documents found.");
  process.exit(0);
}

for (const docSnap of snapshot.docs) {
  const data = docSnap.data();
  let baseDate = null;
  if (Array.isArray(data.dates) && data.dates[0]?.toDate) {
    baseDate = data.dates[0].toDate();
  } else if (data.date?.toDate) {
    baseDate = data.date.toDate();
  }

  if (!baseDate) {
    console.log(`Skipping ${docSnap.id} (no base date)`);
    continue;
  }

  baseDate.setHours(18, 0, 0, 0);
  const dates = [0, 14, 28].map((offset) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + offset);
    return Timestamp.fromDate(date);
  });

  await updateDoc(doc(db, "distributionDates", docSnap.id), {
    dates,
  });
}

console.log(`Updated ${snapshot.size} distributions with 3 dates.`);
