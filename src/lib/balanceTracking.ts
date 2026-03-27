import { Timestamp, doc, getDoc, setDoc, type Firestore } from "firebase/firestore";

const SETTINGS_COLLECTION = "settings";
const FEATURES_DOC_ID = "features";
const BALANCE_KEY = "balanceTrackingEnabled";

export async function readBalanceTrackingEnabled(db: Firestore): Promise<boolean> {
  const snapshot = await getDoc(doc(db, SETTINGS_COLLECTION, FEATURES_DOC_ID));
  if (!snapshot.exists()) return true;
  const raw = snapshot.get(BALANCE_KEY);
  return typeof raw === "boolean" ? raw : true;
}

export async function writeBalanceTrackingEnabled(db: Firestore, enabled: boolean): Promise<void> {
  await setDoc(
    doc(db, SETTINGS_COLLECTION, FEATURES_DOC_ID),
    {
      [BALANCE_KEY]: enabled,
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
}

