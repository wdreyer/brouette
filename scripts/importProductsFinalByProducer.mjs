import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const inputPath = process.argv[2];
const targetProducerArg = process.argv[3] ?? "";
const applyMode = process.argv.includes("--apply");

if (!inputPath) {
  throw new Error(
    "Usage: node scripts/importProductsFinalByProducer.mjs <xlsx-path> [producer-name] [--apply]",
  );
}

const absoluteInputPath = path.resolve(inputPath);
if (!fs.existsSync(absoluteInputPath)) {
  throw new Error(`XLSX not found: ${absoluteInputPath}`);
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!credentialPath && !credentialJson) {
  throw new Error(
    "Missing admin credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.",
  );
}

const serviceAccount = credentialJson
  ? JSON.parse(credentialJson)
  : JSON.parse(fs.readFileSync(path.resolve(credentialPath), "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function parseWorkbookWithPython(xlsxPath) {
  const pythonScript = `
from openpyxl import load_workbook
import json
import sys

wb = load_workbook(sys.argv[1], data_only=True)
ws = wb[wb.sheetnames[0]]
headers = [str(ws.cell(1, c).value or "").strip() for c in range(1, ws.max_column + 1)]
rows = []
for r in range(2, ws.max_row + 1):
    row = {}
    has_value = False
    for c, h in enumerate(headers, start=1):
        value = ws.cell(r, c).value
        if value is not None and str(value).strip() != "":
            has_value = True
        row[h] = value
    if has_value:
        rows.append(row)
print(json.dumps({"headers": headers, "rows": rows}, ensure_ascii=False))
`;

  const result = spawnSync("python", ["-", xlsxPath], {
    input: pythonScript,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Python parse failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePrice(value) {
  const n = Number(String(value ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseVariantInfo(productNameRaw) {
  const fullName = String(productNameRaw ?? "").replace(/\s+/g, " ").trim();
  if (!fullName) {
    return { baseName: "Produit", variantLabels: ["Standard"] };
  }

  const qtyRegex =
    /(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|cl|ml|l|piece|pieces|pcs|x\d+)?)$/i;

  const ouMatch = fullName.match(/^(.*)\s+ou\s+(.+)$/i);
  if (ouMatch) {
    const leftRaw = ouMatch[1].trim();
    const rightRaw = ouMatch[2].trim();
    const leftQty = leftRaw.match(qtyRegex)?.[1]?.trim() ?? "";
    const rightQty = rightRaw.match(qtyRegex)?.[1]?.trim() ?? rightRaw;

    let baseName = leftRaw;
    if (leftQty) {
      baseName = leftRaw.slice(0, Math.max(0, leftRaw.length - leftQty.length)).trim();
    }
    if (!baseName) baseName = fullName;

    const rightUnit = rightQty.match(/[a-z]+$/i)?.[0] ?? "";
    let firstVariant = leftQty || leftRaw;
    if (firstVariant && !/[a-z]+/i.test(firstVariant) && rightUnit) {
      firstVariant = `${firstVariant} ${rightUnit}`;
    }

    return {
      baseName,
      variantLabels: [firstVariant, rightQty].map((x) => x.trim()).filter(Boolean),
    };
  }

  const tailQty = fullName.match(qtyRegex)?.[1]?.trim() ?? "";
  if (tailQty) {
    const baseName = fullName.slice(0, Math.max(0, fullName.length - tailQty.length)).trim();
    return {
      baseName: baseName || fullName,
      variantLabels: [tailQty],
    };
  }

  return { baseName: fullName, variantLabels: ["Standard"] };
}

async function ensureBaseCategories() {
  const required = [
    { id: "cat_boulangerie", name: "Boulangerie" },
    { id: "epicerie", name: "Epicerie locale" },
    { id: "fruits", name: "Fruits" },
    { id: "legumes", name: "Legumes" },
    { id: "herbes", name: "Herbes & aromates" },
    { id: "oeufs-laitages", name: "Oeufs & laitiers" },
    { id: "boissons", name: "Boissons" },
  ];
  for (const category of required) {
    await db.collection("categories").doc(category.id).set(
      {
        name: category.name,
      },
      { merge: true },
    );
  }
}

function pickCategoryId(producerName, productName) {
  const p = normalize(producerName);
  const n = normalize(productName);

  if (p.includes("brasserie") || n.includes("biere") || n.includes("vin") || n.includes("sirop")) {
    return "boissons";
  }
  if (p.includes("biopain") || n.includes("pain") || n.includes("brioche") || n.includes("farine")) {
    return "cat_boulangerie";
  }
  if (p.includes("belle orange") || n.includes("orange") || n.includes("citron") || n.includes("banane") || n.includes("mangue") || n.includes("fruit")) {
    return "fruits";
  }
  if (n.includes("oeuf") || n.includes("lait") || n.includes("fromage") || n.includes("yaourt")) {
    return "oeufs-laitages";
  }
  if (n.includes("basilic") || n.includes("persil") || n.includes("aromate") || n.includes("ail des ours")) {
    return "herbes";
  }
  if (n.includes("carotte") || n.includes("poireau") || n.includes("patate") || n.includes("pomme de terre") || n.includes("courge")) {
    return "legumes";
  }
  return "epicerie";
}

async function main() {
  await ensureBaseCategories();
  const parsed = parseWorkbookWithPython(absoluteInputPath);
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

  const producerSnap = await db.collection("producers").get();
  const producers = producerSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.get("name") ?? "").trim(),
  }));
  const producerByNorm = new Map(producers.map((p) => [normalize(p.name), p]));

  const rowsByProducer = new Map();
  const missingProducerNames = new Set();

  rows.forEach((row) => {
    const productName = String(row.nom_produit ?? "").trim();
    const producerNameRaw = String(row.nom_producteur ?? "").trim();
    if (!productName || !producerNameRaw) return;

    const match = producerByNorm.get(normalize(producerNameRaw));
    if (!match) {
      missingProducerNames.add(producerNameRaw);
      return;
    }
    const list = rowsByProducer.get(match.name) ?? [];
    list.push({
      productName,
      imageUrl: String(row.image ?? "").trim(),
      description: stripHtml(String(row.description ?? "")),
      price: parsePrice(row.price),
    });
    rowsByProducer.set(match.name, list);
  });

  const producerNames = Array.from(rowsByProducer.keys()).sort((a, b) => a.localeCompare(b, "fr"));
  console.log("Matched producers:", producerNames.length);
  producerNames.forEach((name) => console.log(`- ${name}: ${rowsByProducer.get(name).length} lignes`));

  if (missingProducerNames.size > 0) {
    console.log("\nMissing producers in DB (not imported):");
    Array.from(missingProducerNames)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .forEach((name) => console.log(`- ${name}`));
  }

  if (!targetProducerArg) {
    console.log("\nNo producer selected. Pass producer-name as 2nd argument to process one batch.");
    return;
  }

  const targetNorm = normalize(targetProducerArg);
  const selectedProducerName = producerNames.find((name) => normalize(name) === targetNorm);
  if (!selectedProducerName) {
    throw new Error(`Producer not found in matched set: ${targetProducerArg}`);
  }

  const producer = producers.find((p) => normalize(p.name) === targetNorm);
  if (!producer) {
    throw new Error(`Producer not found in DB: ${targetProducerArg}`);
  }

  const selectedRows = rowsByProducer.get(selectedProducerName) ?? [];
  const grouped = new Map();
  selectedRows.forEach((row) => {
    const variantInfo = parseVariantInfo(row.productName);
    const key = normalize(variantInfo.baseName);
    if (!grouped.has(key)) {
      grouped.set(key, {
        baseName: variantInfo.baseName,
        imageUrl: row.imageUrl,
        description: row.description,
        isOrganic: normalize(variantInfo.baseName).includes("bio"),
        variants: new Map(),
      });
    }
    const target = grouped.get(key);
    if (!target.imageUrl && row.imageUrl) target.imageUrl = row.imageUrl;
    if (!target.description && row.description) target.description = row.description;

    variantInfo.variantLabels.forEach((label) => {
      const variantKey = normalize(label);
      if (!target.variants.has(variantKey)) {
        target.variants.set(variantKey, {
          label,
          price: row.price,
        });
      }
    });
  });

  const preparedProducts = Array.from(grouped.values()).map((item) => ({
    ...item,
    variants: Array.from(item.variants.values()),
  }));

  console.log(`\nBatch producer: ${selectedProducerName}`);
  console.log(`Products prepared: ${preparedProducts.length}`);
  preparedProducts.slice(0, 20).forEach((item) => {
    console.log(
      `- ${item.baseName} | variantes: ${item.variants.map((v) => `${v.label} (${v.price})`).join(", ")}`,
    );
  });

  if (!applyMode) {
    console.log("\nDry-run only. Re-run with --apply to write this batch.");
    return;
  }

  const existingProductsSnap = await db
    .collection("products")
    .where("producerId", "==", producer.id)
    .get();
  const existingByName = new Map(
    existingProductsSnap.docs.map((docSnap) => [
      normalize(String(docSnap.get("name") ?? "")),
      { id: docSnap.id, ref: docSnap.ref },
    ]),
  );

  let created = 0;
  let updated = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;

  for (const product of preparedProducts) {
    const key = normalize(product.baseName);
    const existing = existingByName.get(key);
    const productRef = existing ? existing.ref : db.collection("products").doc();
    const payload = {
      producerId: producer.id,
      name: product.baseName,
      description: product.description || "",
      imageUrl: product.imageUrl || "",
      isOrganic: product.isOrganic,
      categoryId: pickCategoryId(selectedProducerName, product.baseName),
      updatedAt: Timestamp.now(),
    };
    await productRef.set(payload, { merge: true });
    if (existing) updated += 1;
    else created += 1;

    const variantsSnap = await productRef.collection("variants").get();
    const existingVariants = new Map(
      variantsSnap.docs.map((docSnap) => [normalize(String(docSnap.get("label") ?? "")), docSnap.ref]),
    );

    for (const variant of product.variants) {
      const vKey = normalize(variant.label);
      const existingVariantRef = existingVariants.get(vKey);
      const variantRef = existingVariantRef ?? productRef.collection("variants").doc();
      await variantRef.set(
        {
          label: variant.label,
          price: variant.price,
        },
        { merge: true },
      );
      if (existingVariantRef) variantsUpdated += 1;
      else variantsCreated += 1;
    }
  }

  console.log("\nImport done:");
  console.log(`- Products created: ${created}`);
  console.log(`- Products updated: ${updated}`);
  console.log(`- Variants created: ${variantsCreated}`);
  console.log(`- Variants updated: ${variantsUpdated}`);
}

await main();
