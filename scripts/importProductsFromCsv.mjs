import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const DEFAULT_CSV = "C:\\Users\\dreye\\Downloads\\products_2026-02-25_16-01.csv";
const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;

if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV not found: ${csvPath}`);
}

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

function parseCsvSemicolon(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ";" && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (value.length || row.length) {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      }
      continue;
    }
    value += char;
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDateFromText(text) {
  const match = String(text || "").match(/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!day || !month) return null;
  // CSV provided is Feb 2026 export, so dates in products map to 2026 campaign.
  const date = new Date(Date.UTC(2026, month - 1, day, 12, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function collectProducerAliases(name) {
  const full = normalize(name);
  const aliases = new Set();
  if (full.length > 4) aliases.add(full);

  const noParen = full.replace(/\([^)]*\)/g, " ");
  noParen
    .split(" ")
    .filter((token) => token.length >= 5)
    .filter(
      (token) =>
        !["ferme", "gaec", "bergerie", "maison", "brasserie", "domaine", "les", "des", "avec"].includes(token),
    )
    .forEach((token) => aliases.add(token));

  const parenMatches = full.match(/\(([^)]*)\)/g) || [];
  parenMatches
    .map((part) => part.replace(/[()]/g, " ").trim())
    .filter((token) => token.length >= 4)
    .forEach((token) => aliases.add(token));

  return Array.from(aliases);
}

const MANUAL_ALIASES = {
  allobroges: "bière des allobroges",
  "age de faire": "BioPain",
  "l age de faire": "BioPain",
  vulliez: "La maison Vulliez (miel)",
  monet: "Les délices d'Alpages(Ph MONET)",
  "delices d alpages": "Les délices d'Alpages(Ph MONET)",
  yoyo: "les gaufres de yoyo",
  "long pierre": "cave Long Pierre",
  escargot: "bière des Allobroges",
};

function bestProducerMatch(rowName, rowDescription, producers) {
  const haystack = normalize(`${rowName} ${rowDescription}`);
  const parenTokens = (String(rowName || "").match(/\(([^)]*)\)/g) || [])
    .map((part) => normalize(part.replace(/[()]/g, " ")))
    .filter((token) => token.length >= 4);

  for (const token of parenTokens) {
    const direct = producers.find(
      (producer) =>
        producer.normalizedName.includes(token) ||
        producer.aliases.some((alias) => alias === token),
    );
    if (direct) return direct;
  }

  let best = null;

  for (const producer of producers) {
    let score = 0;
    if (haystack.includes(producer.normalizedName)) {
      score += 120;
    }
    producer.aliases.forEach((alias) => {
      if (alias && haystack.includes(alias)) {
        score += alias.length >= 10 ? 24 : 16;
      }
    });
    if (!best || score > best.score) {
      best = { producer, score };
    }
  }

  if (best && best.score >= 16) {
    return best.producer;
  }

  for (const [alias, targetName] of Object.entries(MANUAL_ALIASES)) {
    if (haystack.includes(normalize(alias))) {
      return producers.find((p) => p.normalizedName === normalize(targetName)) || null;
    }
  }

  return null;
}

async function ensureFallbackProducer() {
  const snap = await db.collection("producers").where("name", "==", "A relier").limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  const ref = await db.collection("producers").add({
    name: "A relier",
    notes: "Producteur de rattachement temporaire. A corriger manuellement.",
    referentName: "Non attribue",
    referentId: null,
    referentPhone: "",
  });
  return ref.id;
}

async function deleteAllProducts() {
  const productsSnap = await db.collection("products").get();
  for (const productDoc of productsSnap.docs) {
    const variantsSnap = await db.collection("products").doc(productDoc.id).collection("variants").get();
    if (!variantsSnap.empty) {
      const batch = db.batch();
      variantsSnap.docs.forEach((variantDoc) => batch.delete(variantDoc.ref));
      await batch.commit();
    }
    await productDoc.ref.delete();
  }
  return productsSnap.size;
}

const raw = fs.readFileSync(csvPath, "utf8");
const rows = parseCsvSemicolon(raw);
if (rows.length < 2) {
  throw new Error("CSV appears empty.");
}

const header = rows[0].map((cell) => normalize(cell));
const idx = (name) => header.findIndex((h) => h === normalize(name));
const idxIncludes = (name) => header.findIndex((h) => h.includes(normalize(name)));

const colName = idx("name");
const colSku = idx("sku");
const colDesc = idx("description");
const colImage = idx("image");
const colWeight = idx("weight");
const colPrice = idx("price");
const colRecommendedPrice = idx("recommended_price");
const colEnabled = idx("enabled");
const colCategory = idx("category1");
const colProductId = idx("product_id");
const colProductUrl = idxIncludes("product_url");

if (colName === -1 || colProductId === -1) {
  throw new Error("CSV columns missing required fields: name/product_id");
}

const producersSnap = await db.collection("producers").get();
const producers = producersSnap.docs
  .map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.data().name || ""),
    normalizedName: normalize(docSnap.data().name || ""),
    aliases: collectProducerAliases(String(docSnap.data().name || "")),
  }))
  .filter((item) => item.normalizedName);

const fallbackProducerId = await ensureFallbackProducer();
const deletedCount = await deleteAllProducts();

let imported = 0;
let linked = 0;
let fallbackLinked = 0;
const unmatched = [];

for (const row of rows.slice(1)) {
  const name = String(row[colName] || "").trim();
  const csvProductId = String(row[colProductId] || "").trim();
  if (!name || !csvProductId) continue;

  const sku = String(row[colSku] || "").trim();
  const descriptionHtml = String(row[colDesc] || "").trim();
  const description = stripHtml(descriptionHtml);
  const imageUrl = String(row[colImage] || "").trim();
  const enabled = String(row[colEnabled] || "").trim().toLowerCase() === "yes";
  const categoryRaw = String(row[colCategory] || "").trim();
  const productUrl = colProductUrl >= 0 ? String(row[colProductUrl] || "").trim() : "";
  const dateFromCategory = parseDateFromText(categoryRaw);
  const dateFromName = parseDateFromText(name);
  const saleDate = dateFromName || dateFromCategory;
  const saleDateKey = saleDate
    ? `${saleDate.getUTCFullYear()}-${String(saleDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
        saleDate.getUTCDate(),
      ).padStart(2, "0")}`
    : null;

  const priceRaw = String(row[colPrice] || "").replace(",", ".").trim();
  const fallbackPriceRaw = String(row[colRecommendedPrice] || "").replace(",", ".").trim();
  const price = Number(priceRaw || fallbackPriceRaw || 0);
  const weight = String(row[colWeight] || "").trim();

  const matchedProducer = bestProducerMatch(name, `${description} ${productUrl}`, producers);
  const producerId = matchedProducer?.id || fallbackProducerId;

  if (matchedProducer) {
    linked += 1;
  } else {
    fallbackLinked += 1;
    unmatched.push({ name, sku, csvProductId });
  }

  const productDocId = `csv-${csvProductId}`;
  const productRef = db.collection("products").doc(productDocId);
  const productPayload = {
    producerId,
    name,
    description,
    imageUrl: imageUrl || "",
    isOrganic: normalize(name).includes("bio"),
    categoryId: null,
    tags: [],
    saleDates: saleDate ? [Timestamp.fromDate(saleDate)] : [],
    source: {
      csvProductId,
      sku,
      category: categoryRaw || null,
      enabled,
      productUrl: productUrl || null,
    },
  };

  await productRef.set(productPayload, { merge: true });

  const variantId = sku ? slugify(sku) : "standard";
  await productRef.collection("variants").doc(variantId).set(
    {
      label: weight ? `Option ${weight}` : "Option",
      type: "",
      unit: "",
      price: Number.isFinite(price) ? price : 0,
      activeDates: saleDateKey ? [saleDateKey] : [],
    },
    { merge: true },
  );

  imported += 1;
}

console.log(`CSV: ${csvPath}`);
console.log(`Deleted previous products: ${deletedCount}`);
console.log(`Imported products: ${imported}`);
console.log(`Linked to known producers: ${linked}`);
console.log(`Linked to fallback producer "A relier": ${fallbackLinked}`);
if (unmatched.length) {
  console.log("\nUnmatched products (first 40):");
  unmatched.slice(0, 40).forEach((item) => {
    console.log(`- ${item.name} | sku=${item.sku || "-"} | csvId=${item.csvProductId}`);
  });
}
