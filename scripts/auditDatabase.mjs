import fs from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountPath && !serviceAccountJson) {
  throw new Error(
    "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.",
  );
}

const serviceAccount = serviceAccountJson
  ? JSON.parse(serviceAccountJson)
  : JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function normalizeStatus(value) {
  return String(value || "").toLowerCase();
}

const [membersSnap, producersSnap, productsSnap, distSnap, ordersSnap, messagesSnap] =
  await Promise.all([
    db.collection("members").get(),
    db.collection("producers").get(),
    db.collection("products").get(),
    db.collection("distributionDates").get(),
    db.collection("orders").get(),
    db.collection("messages").get(),
  ]);

const memberIds = new Set(membersSnap.docs.map((d) => d.id));
const producerIds = new Set(producersSnap.docs.map((d) => d.id));
const productIds = new Set(productsSnap.docs.map((d) => d.id));
const distributionIds = new Set(distSnap.docs.map((d) => d.id));

let referentMissingInMembers = 0;
producersSnap.docs.forEach((docSnap) => {
  const referentId = docSnap.data().referentId;
  if (referentId && !memberIds.has(String(referentId))) {
    referentMissingInMembers += 1;
  }
});

let productsWithoutProducer = 0;
let productsFallbackProducer = 0;
let productsWithoutImage = 0;
const productsByProducer = new Map();
for (const productDoc of productsSnap.docs) {
  const data = productDoc.data();
  const producerId = String(data.producerId || "");
  if (!producerId || !producerIds.has(producerId)) {
    productsWithoutProducer += 1;
  }
  if (data.imageUrl === "" || data.imageUrl == null) {
    productsWithoutImage += 1;
  }
  if (producerId) {
    productsByProducer.set(producerId, (productsByProducer.get(producerId) ?? 0) + 1);
  }
}

const fallbackProducer = producersSnap.docs.find((d) => d.data().name === "A relier");
if (fallbackProducer) {
  productsFallbackProducer = productsByProducer.get(fallbackProducer.id) ?? 0;
}

let openDistributions = 0;
let distWithNoDates = 0;
let offersTotal = 0;
let offersBrokenProduct = 0;
let offersBrokenProducer = 0;
let offersBrokenVariant = 0;
let producerRowsTotal = 0;
let producerRowsBrokenProducer = 0;

for (const distDoc of distSnap.docs) {
  const data = distDoc.data();
  const status = normalizeStatus(data.status);
  if (status === "open" || status === "ouverte" || status === "ouvertes") {
    openDistributions += 1;
  }
  const dates = Array.isArray(data.dates) ? data.dates : [];
  if (!dates.length) {
    distWithNoDates += 1;
  }

  const [offerSnap, producerSnap] = await Promise.all([
    db.collection("distributionDates").doc(distDoc.id).collection("offerItems").get(),
    db.collection("distributionDates").doc(distDoc.id).collection("producers").get(),
  ]);
  offersTotal += offerSnap.size;
  producerRowsTotal += producerSnap.size;

  for (const producerRow of producerSnap.docs) {
    const producerId = String(producerRow.data().producerId || producerRow.id);
    if (!producerIds.has(producerId)) {
      producerRowsBrokenProducer += 1;
    }
  }

  for (const offerDoc of offerSnap.docs) {
    const offer = offerDoc.data();
    const productId = String(offer.productId || "");
    const producerId = String(offer.producerId || "");
    const variantId = String(offer.variantId || "");

    if (!productId || !productIds.has(productId)) {
      offersBrokenProduct += 1;
      continue;
    }
    if (!producerId || !producerIds.has(producerId)) {
      offersBrokenProducer += 1;
    }
    if (variantId) {
      const variantRef = db.collection("products").doc(productId).collection("variants").doc(variantId);
      const variantSnap = await variantRef.get();
      if (!variantSnap.exists) {
        offersBrokenVariant += 1;
      }
    }
  }
}

let ordersBrokenMember = 0;
let ordersBrokenDistribution = 0;
for (const orderDoc of ordersSnap.docs) {
  const data = orderDoc.data();
  const memberId = String(data.memberId || "");
  const distributionId = String(data.distributionId || "");
  if (memberId && !memberIds.has(memberId)) {
    ordersBrokenMember += 1;
  }
  if (distributionId && !distributionIds.has(distributionId)) {
    ordersBrokenDistribution += 1;
  }
}

const rolesCount = { admin: 0, referent: 0, member: 0, unknown: 0 };
membersSnap.docs.forEach((memberDoc) => {
  const role = String(memberDoc.data()?.auth?.role || "").toLowerCase();
  if (role === "admin") rolesCount.admin += 1;
  else if (role === "referent") rolesCount.referent += 1;
  else if (role === "member" || role === "") rolesCount.member += 1;
  else rolesCount.unknown += 1;
});

console.log("=== Database Audit ===");
console.log("members:", membersSnap.size, rolesCount);
console.log("producers:", producersSnap.size, "broken referentId:", referentMissingInMembers);
console.log(
  "products:",
  productsSnap.size,
  "without producer:",
  productsWithoutProducer,
  "fallback(A relier):",
  productsFallbackProducer,
  "without image:",
  productsWithoutImage,
);
console.log(
  "distributions:",
  distSnap.size,
  "open:",
  openDistributions,
  "without dates:",
  distWithNoDates,
);
console.log(
  "distribution/producers rows:",
  producerRowsTotal,
  "broken producer link:",
  producerRowsBrokenProducer,
);
console.log(
  "offers:",
  offersTotal,
  "broken product:",
  offersBrokenProduct,
  "broken producer:",
  offersBrokenProducer,
  "broken variant:",
  offersBrokenVariant,
);
console.log(
  "orders:",
  ordersSnap.size,
  "broken member:",
  ordersBrokenMember,
  "broken distribution:",
  ordersBrokenDistribution,
);
console.log("messages:", messagesSnap.size);
