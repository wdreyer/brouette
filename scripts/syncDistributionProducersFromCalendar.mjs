import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!credentialPath && !credentialJson) {
  throw new Error(
    "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.",
  );
}

const serviceAccount = credentialJson
  ? JSON.parse(credentialJson)
  : JSON.parse(fs.readFileSync(credentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function toDate(value) {
  if (!value || typeof value !== "object") return null;
  if ("toDate" in value && typeof value.toDate === "function") return value.toDate();
  return null;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeStatus(value) {
  return String(value ?? "").toLowerCase();
}

const producersSnap = await db.collection("producers").get();
const producersById = new Map(
  producersSnap.docs.map((docSnap) => [
    docSnap.id,
    {
      referentId: docSnap.get("referentId") ?? null,
      referentName: docSnap.get("referentName") ?? null,
    },
  ]),
);

const distSnap = await db.collection("distributionDates").get();
const distributions = distSnap.docs
  .map((docSnap) => ({
    id: docSnap.id,
    status: normalizeStatus(docSnap.get("status")),
    dates: Array.isArray(docSnap.get("dates")) ? docSnap.get("dates") : [],
  }))
  .filter((item) => item.status !== "finished");

let updatedRows = 0;
let createdRows = 0;
let deactivatedRows = 0;
let touchedDistributions = 0;

for (const distribution of distributions) {
  const distributionDateKeys = distribution.dates
    .slice(0, 3)
    .map((value) => toDate(value))
    .filter(Boolean)
    .map((value) => dateKey(value));

  const distributionRef = db.collection("distributionDates").doc(distribution.id);
  const [calendarSnap, producerRowsSnap] = await Promise.all([
    distributionRef.collection("calendarProducers").get(),
    distributionRef.collection("producers").get(),
  ]);

  const calendarByProducer = new Map();
  calendarSnap.docs.forEach((docSnap) => {
    const producerId = String(docSnap.get("producerId") ?? docSnap.id);
    const keys = Array.isArray(docSnap.get("activeDateKeys"))
      ? docSnap
          .get("activeDateKeys")
          .filter((key) => typeof key === "string" && distributionDateKeys.includes(key))
      : [];
    calendarByProducer.set(producerId, Array.from(new Set(keys)).sort());
  });

  const existingRowsByProducer = new Map(
    producerRowsSnap.docs.map((docSnap) => [docSnap.id, docSnap]),
  );

  const batch = db.batch();
  let localChanged = 0;

  for (const [producerId, activeDateKeys] of calendarByProducer.entries()) {
    if (!activeDateKeys.length) continue;
    const producerMeta = producersById.get(producerId) ?? {
      referentId: null,
      referentName: null,
    };
    const existing = existingRowsByProducer.get(producerId);
    const currentKeys = existing?.get("activeDateKeys");
    const normalizedCurrentKeys = Array.isArray(currentKeys)
      ? currentKeys.filter((key) => typeof key === "string").sort()
      : [];
    const activeChanged =
      normalizedCurrentKeys.length !== activeDateKeys.length ||
      normalizedCurrentKeys.some((key, index) => key !== activeDateKeys[index]);

    if (!existing) {
      createdRows += 1;
    } else if (activeChanged) {
      updatedRows += 1;
    } else {
      const needsReferentUpdate =
        (existing.get("referentId") ?? null) !== producerMeta.referentId ||
        (existing.get("referentName") ?? null) !== producerMeta.referentName ||
        existing.get("active") === false;
      if (!needsReferentUpdate) continue;
      updatedRows += 1;
    }

    batch.set(
      distributionRef.collection("producers").doc(producerId),
      {
        producerId,
        active: true,
        activeDateKeys,
        referentId: producerMeta.referentId,
        referentName: producerMeta.referentName,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    localChanged += 1;
  }

  producerRowsSnap.docs.forEach((docSnap) => {
    const producerId = docSnap.id;
    const calendarKeys = calendarByProducer.get(producerId) ?? [];
    if (calendarKeys.length > 0) return;
    const alreadyInactive =
      docSnap.get("active") === false &&
      Array.isArray(docSnap.get("activeDateKeys")) &&
      docSnap.get("activeDateKeys").length === 0;
    if (alreadyInactive) return;

    batch.set(
      docSnap.ref,
      {
        producerId,
        active: false,
        activeDateKeys: [],
        validatedByReferent: false,
        validatedAt: null,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    deactivatedRows += 1;
    localChanged += 1;
  });

  if (localChanged > 0) {
    await batch.commit();
    touchedDistributions += 1;
  }
}

console.log("syncDistributionProducersFromCalendar done");
console.log("- distributions scanned:", distributions.length);
console.log("- distributions updated:", touchedDistributions);
console.log("- producer rows created:", createdRows);
console.log("- producer rows updated:", updatedRows);
console.log("- producer rows deactivated:", deactivatedRows);
