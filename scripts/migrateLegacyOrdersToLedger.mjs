import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

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

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMoney(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function isChargeableStatus(status) {
  const normalized = normalize(status);
  if (!normalized) return true;
  const blocked = new Set(["cancelled", "canceled", "annulee", "annulee", "draft", "brouillon"]);
  return !blocked.has(normalized);
}

function extractMemberUid(memberData) {
  const auth = memberData.auth;
  if (!auth || typeof auth !== "object") return "";
  const uid = auth.uid;
  return typeof uid === "string" ? uid : "";
}

function memberEmails(memberData) {
  const values = [];
  const primary = normalize(memberData.email);
  if (primary) values.push(primary);

  if (Array.isArray(memberData.emails)) {
    memberData.emails.forEach((email) => {
      const normalized = normalize(email);
      if (normalized) values.push(normalized);
    });
  }

  if (Array.isArray(memberData.accessEmails)) {
    memberData.accessEmails.forEach((email) => {
      const normalized = normalize(email);
      if (normalized) values.push(normalized);
    });
  }

  return Array.from(new Set(values));
}

function pickOrderTimestamp(orderData) {
  if (orderData.validatedAt instanceof Timestamp) return orderData.validatedAt;
  if (orderData.createdAt instanceof Timestamp) return orderData.createdAt;
  return Timestamp.now();
}

async function main() {
  const [ordersSnap, membersSnap] = await Promise.all([
    db.collection("orders").get(),
    db.collection("members").get(),
  ]);

  const membersById = new Map();
  const membersByUid = new Map();
  const membersByEmail = new Map();

  membersSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const member = {
      id: docSnap.id,
      email: normalize(data.email),
      uid: extractMemberUid(data),
      data,
    };
    membersById.set(member.id, member);
    if (member.uid && !membersByUid.has(member.uid)) {
      membersByUid.set(member.uid, member);
    }
    memberEmails(data).forEach((email) => {
      if (!membersByEmail.has(email)) {
        membersByEmail.set(email, member);
      }
    });
  });

  const ledgerOrderIdsByMember = new Map();
  async function ensureLedgerCache(memberId) {
    if (ledgerOrderIdsByMember.has(memberId)) return ledgerOrderIdsByMember.get(memberId);
    const ledgerSnap = await db.collection("members").doc(memberId).collection("ledger").get();
    const orderIds = new Set();
    ledgerSnap.docs.forEach((docSnap) => {
      orderIds.add(docSnap.id);
      const orderIdField = normalize(docSnap.get("orderId"));
      if (orderIdField) orderIds.add(orderIdField);
    });
    ledgerOrderIdsByMember.set(memberId, orderIds);
    return orderIds;
  }

  let ordersProcessed = 0;
  let ordersResolved = 0;
  let ordersUnresolved = 0;
  let ordersUpdated = 0;
  let totalsRecomputed = 0;
  let ledgerCreated = 0;
  let ledgerAlreadyPresent = 0;
  let ordersSkippedByStatus = 0;

  let batch = db.batch();
  let batchOps = 0;
  async function commitBatchIfNeeded(force = false) {
    if (!force && batchOps < 350) return;
    if (batchOps === 0) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }

  for (const orderDoc of ordersSnap.docs) {
    ordersProcessed += 1;
    const orderData = orderDoc.data();
    const rawMemberId = String(orderData.memberId ?? "");
    const rawMemberUid = String(orderData.memberUid ?? "");
    const snapshotEmail = normalize(orderData.memberSnapshot?.email);

    let member =
      membersById.get(rawMemberId) ||
      membersByUid.get(rawMemberUid) ||
      membersByUid.get(rawMemberId) ||
      membersByEmail.get(snapshotEmail);

    if (!member) {
      ordersUnresolved += 1;
      continue;
    }
    ordersResolved += 1;

    const itemsSnap = await orderDoc.ref.collection("items").get();
    let computedTotal = 0;
    let computedItems = 0;
    itemsSnap.docs.forEach((itemDoc) => {
      const item = itemDoc.data();
      const quantity = Number(item.quantity ?? 0);
      const lineTotal = Number(item.lineTotal);
      const unitPrice = Number(item.unitPrice ?? 0);
      const safeQty = Number.isFinite(quantity) ? quantity : 0;
      const safeLine = Number.isFinite(lineTotal) ? lineTotal : unitPrice * safeQty;
      computedTotal += Number.isFinite(safeLine) ? safeLine : 0;
      computedItems += safeQty;
    });
    computedTotal = normalizeMoney(computedTotal);

    const currentTotal = normalizeMoney(orderData.totals?.totalAmount);
    const currentItems = Number(orderData.totals?.itemCount ?? 0);
    const shouldUpdateTotals =
      !orderData.totals ||
      Math.abs(currentTotal - computedTotal) > 0.01 ||
      currentItems !== computedItems;

    const orderUpdate = {};
    if (rawMemberId !== member.id) {
      orderUpdate.memberId = member.id;
    }
    const resolvedUid = member.uid || (member.id.length >= 20 ? member.id : "");
    if (!rawMemberUid && resolvedUid) {
      orderUpdate.memberUid = resolvedUid;
    }
    if (!snapshotEmail && member.email) {
      orderUpdate.memberSnapshot = { ...(orderData.memberSnapshot ?? {}), email: member.email };
    }
    if (shouldUpdateTotals) {
      orderUpdate.totals = {
        totalAmount: computedTotal,
        itemCount: computedItems,
      };
      totalsRecomputed += 1;
    }
    if (Object.keys(orderUpdate).length > 0) {
      batch.set(orderDoc.ref, orderUpdate, { merge: true });
      batchOps += 1;
      ordersUpdated += 1;
      await commitBatchIfNeeded();
    }

    if (!isChargeableStatus(orderData.status)) {
      ordersSkippedByStatus += 1;
      continue;
    }

    const existingOrderIds = await ensureLedgerCache(member.id);
    if (existingOrderIds.has(orderDoc.id) || existingOrderIds.has(normalize(orderDoc.id))) {
      ledgerAlreadyPresent += 1;
      continue;
    }

    const timestamp = pickOrderTimestamp(orderData);
    const ledgerRef = db.collection("members").doc(member.id).collection("ledger").doc(orderDoc.id);
    batch.set(ledgerRef, {
      type: "order",
      label: "Commande",
      amount: -computedTotal,
      orderId: orderDoc.id,
      memberId: member.id,
      memberUid: resolvedUid || rawMemberUid || null,
      note: null,
      occurredAt: timestamp,
      createdAt: timestamp,
      migratedAt: FieldValue.serverTimestamp(),
      migrationVersion: "orders-ledger-v1",
    });
    batchOps += 1;
    ledgerCreated += 1;
    existingOrderIds.add(orderDoc.id);
    await commitBatchIfNeeded();
  }

  await commitBatchIfNeeded(true);

  console.log("Legacy orders migration completed.");
  console.log("ordersProcessed:", ordersProcessed);
  console.log("ordersResolved:", ordersResolved);
  console.log("ordersUnresolved:", ordersUnresolved);
  console.log("ordersUpdated:", ordersUpdated);
  console.log("totalsRecomputed:", totalsRecomputed);
  console.log("ledgerCreated:", ledgerCreated);
  console.log("ledgerAlreadyPresent:", ledgerAlreadyPresent);
  console.log("ordersSkippedByStatus:", ordersSkippedByStatus);
}

await main();
