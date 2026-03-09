import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_CSV = "C:\\Users\\dreye\\Downloads\\products_2026-02-25_16-01 (1) - Feuille 1.csv";
const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;

if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV not found: ${csvPath}`);
}

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountPath && !serviceAccountJson) {
  throw new Error("Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = serviceAccountJson
  ? JSON.parse(serviceAccountJson)
  : JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function parseCsv(text, delimiter = ",") {
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

    if (char === delimiter && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
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
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, "-");
}

function cleanName(name) {
  return String(name || "")
    .replace(/^C-\s*/i, "")
    .replace(/\s*-\s*\d{2}\/\d{2}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePrice(raw) {
  const value = Number(String(raw || "").replace(",", ".").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function parseDefaultVariantLabel(name, description) {
  const byWeight = String(name).match(/(\d+\s?(?:g|kg))/i);
  if (byWeight) return byWeight[1].replace(/\s+/g, "");
  const byPortion = `${name} ${description}`.match(/par\s*(\d+\s?g)/i);
  if (byPortion) return byPortion[1].replace(/\s+/g, "");
  return "Standard";
}

function round2(value) {
  return Number((Math.round(value * 100) / 100).toFixed(2));
}

const csvText = fs.readFileSync(csvPath, "utf8");
const matrix = parseCsv(csvText, ",");
if (!matrix.length) throw new Error("CSV is empty.");

const header = matrix[0];
const rows = matrix.slice(1).map((line) => {
  const obj = {};
  header.forEach((key, index) => {
    obj[key] = line[index] ?? "";
  });
  return obj;
});

const grouped = new Map();
for (const row of rows) {
  const clean = cleanName(row.name);
  if (!clean) continue;
  if (!grouped.has(clean)) grouped.set(clean, []);
  grouped.get(clean).push(row);
}

const producersSnap = await db.collection("producers").get();
let producerDoc =
  producersSnap.docs.find((docSnap) => normalize(docSnap.data().name).includes("biopain")) ?? null;

if (!producerDoc) {
  const producerRef = db.collection("producers").doc("producer_biopain");
  await producerRef.set(
    {
      name: "BIOPAIN",
      email: "",
      phone: "",
      coopStatus: "Actif",
      notes: "Import automatique CSV BIOPAIN",
    },
    { merge: true },
  );
  producerDoc = await producerRef.get();
}
const producerId = producerDoc.id;

const categoriesSnap = await db.collection("categories").get();
let categoryDoc =
  categoriesSnap.docs.find((docSnap) => normalize(docSnap.data().name) === "boulangerie") ?? null;
if (!categoryDoc) {
  const categoryRef = db.collection("categories").doc("cat_boulangerie");
  await categoryRef.set(
    {
      name: "Boulangerie",
      description: "Pains, miches et produits de boulangerie",
    },
    { merge: true },
  );
  categoryDoc = await categoryRef.get();
}
const categoryId = categoryDoc.id;

const importedProductIds = new Set();
const recap = [];

for (const [name, lines] of grouped.entries()) {
  const docId = `biopain-${slugify(name)}`.slice(0, 120);
  importedProductIds.add(docId);

  const representative = lines.find((row) => row.image || row.description) ?? lines[0];
  const basePrice = parsePrice(representative.price);
  const description = stripHtml(representative.description);
  const isOrganic = normalize(`${name} ${description}`).includes("bio");

  const productRef = db.collection("products").doc(docId);
  await productRef.set(
    {
      producerId,
      name,
      description,
      imageUrl: representative.image || "",
      isOrganic,
      categoryId,
      tags: ["pain", "biopain"],
    },
    { merge: true },
  );

  const variantsRef = productRef.collection("variants");
  const existingVariants = await variantsRef.get();
  for (const variantDoc of existingVariants.docs) {
    await variantDoc.ref.delete();
  }

  const hasTwoWeights = /500\s?g\s*ou\s*1\s?kg/i.test(name) || /500\s?g\s*ou\s*1\s?kg/i.test(description);
  const variants = hasTwoWeights
    ? [
        { id: "v500g", label: "500g", price: basePrice || 2.8, unit: "piece", type: "Pain" },
        { id: "v1kg", label: "1kg", price: round2((basePrice || 2.8) * 2), unit: "piece", type: "Pain" },
      ]
    : [
        {
          id: "v1",
          label: parseDefaultVariantLabel(name, description),
          price: basePrice,
          unit: "piece",
          type: "Pain",
        },
      ];

  for (const variant of variants) {
    await variantsRef.doc(variant.id).set(variant, { merge: true });
  }

  recap.push({
    name,
    variants: variants.map((variant) => `${variant.label} (${variant.price.toFixed(2)} EUR)`),
    image: Boolean(representative.image),
  });
}

const existingProductsSnap = await db.collection("products").where("producerId", "==", producerId).get();
let removedProducts = 0;
for (const productDoc of existingProductsSnap.docs) {
  if (importedProductIds.has(productDoc.id)) continue;
  const variantsSnap = await productDoc.ref.collection("variants").get();
  for (const variantDoc of variantsSnap.docs) {
    await variantDoc.ref.delete();
  }
  await productDoc.ref.delete();
  removedProducts += 1;
}

console.log(`Producer used: ${producerDoc.data().name} (${producerId})`);
console.log(`Category used: ${categoryDoc.data().name} (${categoryId})`);
console.log(`Imported products: ${recap.length}`);
console.log(`Removed old BIOPAIN products not in CSV: ${removedProducts}`);
console.log("");
console.log("Recap:");
recap
  .sort((a, b) => a.name.localeCompare(b.name))
  .forEach((item) => {
    console.log(`- ${item.name}`);
    console.log(`  variants: ${item.variants.join(", ")}`);
    console.log(`  image: ${item.image ? "yes" : "no"}`);
  });
