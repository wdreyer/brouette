import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!credentialPath && !credentialJson) {
  throw new Error("Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = credentialJson
  ? JSON.parse(credentialJson)
  : JSON.parse(fs.readFileSync(credentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyCategoryName(name) {
  const base = String(name ?? "")
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[&]/g, " et ")
    .replace(/['’]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "categorie";
}

function pickPreferredCategory(rows) {
  return [...rows].sort((a, b) => {
    const byNameLen = b.name.length - a.name.length;
    if (byNameLen !== 0) return byNameLen;
    return a.id.localeCompare(b.id, "fr");
  })[0];
}

function titleFromId(id) {
  return String(id)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function commitInChunks(ops, chunkSize = 400) {
  if (!ops.length) return;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch();
    const slice = ops.slice(i, i + chunkSize);
    slice.forEach((fn) => fn(batch));
    await batch.commit();
  }
}

const categoriesSnap = await db.collection("categories").get();
const categories = categoriesSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  name: normalizeText(docSnap.get("name")),
  description: normalizeText(docSnap.get("description")),
}));

if (!categories.length) {
  console.log("No categories found. Nothing to harmonize.");
  process.exit(0);
}

const groupsByTargetId = new Map();
for (const category of categories) {
  const targetId = slugifyCategoryName(category.name || category.id);
  if (!groupsByTargetId.has(targetId)) groupsByTargetId.set(targetId, []);
  groupsByTargetId.get(targetId).push(category);
}

const oldToNew = new Map();
const canonicalById = new Map();
for (const [targetId, group] of groupsByTargetId.entries()) {
  const preferred = pickPreferredCategory(group);
  canonicalById.set(targetId, {
    id: targetId,
    name: preferred.name || preferred.id,
    description: preferred.description || "",
    mergedFrom: group.map((item) => item.id),
  });
  group.forEach((item) => oldToNew.set(item.id, targetId));
}

const targetIds = new Set(canonicalById.keys());

const setCategoryOps = [];
for (const canonical of canonicalById.values()) {
  const ref = db.collection("categories").doc(canonical.id);
  setCategoryOps.push((batch) =>
    batch.set(
      ref,
      {
        id: canonical.id,
        name: canonical.name,
        description: canonical.description,
      },
      { merge: true },
    ),
  );
}
await commitInChunks(setCategoryOps);

const productsSnap = await db.collection("products").get();
const productOps = [];
let productsUpdated = 0;
for (const productDoc of productsSnap.docs) {
  const oldCategoryId = String(productDoc.get("categoryId") ?? "").trim();
  if (!oldCategoryId) continue;
  const nextCategoryId = oldToNew.get(oldCategoryId);
  if (!nextCategoryId || nextCategoryId === oldCategoryId) continue;
  productsUpdated += 1;
  productOps.push((batch) =>
    batch.set(productDoc.ref, { categoryId: nextCategoryId }, { merge: true }),
  );
}
await commitInChunks(productOps);

const distSnap = await db.collection("distributionDates").get();
let offersUpdated = 0;
for (const distDoc of distSnap.docs) {
  const offerSnap = await distDoc.ref.collection("offerItems").get();
  const offerOps = [];
  for (const offerDoc of offerSnap.docs) {
    const oldCategoryId = String(offerDoc.get("categoryId") ?? "").trim();
    if (!oldCategoryId) continue;
    const nextCategoryId = oldToNew.get(oldCategoryId);
    if (!nextCategoryId || nextCategoryId === oldCategoryId) continue;
    offersUpdated += 1;
    offerOps.push((batch) =>
      batch.set(offerDoc.ref, { categoryId: nextCategoryId }, { merge: true }),
    );
  }
  await commitInChunks(offerOps);
}

const productsAfterSnap = await db.collection("products").get();
const usedCategoryIds = new Set(
  productsAfterSnap.docs
    .map((docSnap) => String(docSnap.get("categoryId") ?? "").trim())
    .filter(Boolean),
);

const orphanCreationOps = [];
let orphanCategoriesCreated = 0;
for (const categoryId of usedCategoryIds) {
  if (targetIds.has(categoryId)) continue;
  orphanCategoriesCreated += 1;
  orphanCreationOps.push((batch) =>
    batch.set(
      db.collection("categories").doc(categoryId),
      {
        id: categoryId,
        name: titleFromId(categoryId),
        description: "",
      },
      { merge: true },
    ),
  );
}
await commitInChunks(orphanCreationOps);

const deleteOps = [];
let categoriesDeleted = 0;
for (const category of categories) {
  const targetId = oldToNew.get(category.id) || category.id;
  if (targetId === category.id) continue;
  if (targetIds.has(category.id)) continue;
  categoriesDeleted += 1;
  deleteOps.push((batch) => batch.delete(db.collection("categories").doc(category.id)));
}
await commitInChunks(deleteOps);

console.log("harmonizeCategories done");
console.log(`- categories before: ${categories.length}`);
console.log(`- categories after target set: ${canonicalById.size}`);
console.log(`- categories deleted: ${categoriesDeleted}`);
console.log(`- orphan categories created: ${orphanCategoriesCreated}`);
console.log(`- products updated: ${productsUpdated}`);
console.log(`- offerItems updated: ${offersUpdated}`);
console.log("- mapping:");
for (const [targetId, canonical] of [...canonicalById.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"))) {
  const mergedFrom = canonical.mergedFrom.join(", ");
  console.log(`  ${targetId} <= ${mergedFrom}`);
}
