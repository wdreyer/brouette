import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const inputPath = process.argv[2];
const applyMode = process.argv.includes("--apply");

if (!inputPath) {
  throw new Error(
    "Usage: node scripts/importProductsStrongAliases.mjs <xlsx-path> [--apply]",
  );
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
  : JSON.parse(fs.readFileSync(credentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

const STRONG_ALIAS_MAP = {
  "Baud SARL": "Ferme Baud",
  "Cave Pierre LONG": "Cave Long Pierre",
  "Cooperative Val Fruits Lacroix": "Lacroix - Val'fruits",
  "Cotes du Rhone": "Cote rhone - Francois PONT",
  "Distillerie des Fleurs de Lune": "Fleur de lune",
  "Ferme Le Vallon": "Ferme de Vallon",
  "Ferme de Pisse Renard": "Ferme de Pisse-renart",
  "GAEC Les Gorges des Tines": "GAEC Gorges de Tines (cassina)",
  "GAEL Le Chalet": "GAEC Le chalet",
  "La Bergerie des Roches": "Bergerie des roches",
  "La ferme des quatre saisons": "Ferme des 4 saisons",
};

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
print(json.dumps({"rows": rows}, ensure_ascii=False))
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
      baseName = leftRaw.slice(
        0,
        Math.max(0, leftRaw.length - leftQty.length),
      ).trim();
    }
    if (!baseName) baseName = fullName;

    const rightUnit = rightQty.match(/[a-z]+$/i)?.[0] ?? "";
    let firstVariant = leftQty || leftRaw;
    if (firstVariant && !/[a-z]+/i.test(firstVariant) && rightUnit) {
      firstVariant = `${firstVariant} ${rightUnit}`;
    }

    return {
      baseName,
      variantLabels: [firstVariant, rightQty]
        .map((x) => x.trim())
        .filter(Boolean),
    };
  }

  const tailQty = fullName.match(qtyRegex)?.[1]?.trim() ?? "";
  if (tailQty) {
    const baseName = fullName
      .slice(0, Math.max(0, fullName.length - tailQty.length))
      .trim();
    return {
      baseName: baseName || fullName,
      variantLabels: [tailQty],
    };
  }

  return { baseName: fullName, variantLabels: ["Standard"] };
}

function pickCategoryId(producerName, productName) {
  const p = normalize(producerName);
  const n = normalize(productName);
  if (
    p.includes("brasserie") ||
    n.includes("biere") ||
    n.includes("vin") ||
    n.includes("sirop")
  ) {
    return "boissons";
  }
  if (
    p.includes("biopain") ||
    n.includes("pain") ||
    n.includes("brioche") ||
    n.includes("farine")
  ) {
    return "cat_boulangerie";
  }
  if (
    p.includes("belle orange") ||
    n.includes("orange") ||
    n.includes("citron") ||
    n.includes("banane") ||
    n.includes("mangue") ||
    n.includes("fruit")
  ) {
    return "fruits";
  }
  if (
    n.includes("oeuf") ||
    n.includes("lait") ||
    n.includes("fromage") ||
    n.includes("yaourt")
  ) {
    return "oeufs-laitages";
  }
  if (
    n.includes("basilic") ||
    n.includes("persil") ||
    n.includes("aromate") ||
    n.includes("ail des ours")
  ) {
    return "herbes";
  }
  if (
    n.includes("carotte") ||
    n.includes("poireau") ||
    n.includes("patate") ||
    n.includes("pomme de terre") ||
    n.includes("courge")
  ) {
    return "legumes";
  }
  return "epicerie";
}

function buildTargetIndex(producers) {
  const byNorm = new Map();
  producers.forEach((p) => byNorm.set(normalize(p.name), p));

  const aliasNormMap = new Map();
  Object.entries(STRONG_ALIAS_MAP).forEach(([source, target]) => {
    aliasNormMap.set(normalize(source), normalize(target));
  });

  return { byNorm, aliasNormMap };
}

async function main() {
  const parsed = parseWorkbookWithPython(inputPath);
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

  const producerSnap = await db.collection("producers").get();
  const producers = producerSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.get("name") ?? "").trim(),
  }));
  const { byNorm, aliasNormMap } = buildTargetIndex(producers);

  const selectedRows = [];
  const unmatchedRows = [];
  const unmatchedProducts = new Set();
  const unmatchedProducers = new Set();

  rows.forEach((row) => {
    const productName = String(row.nom_produit ?? "").trim();
    const sourceProducerName = String(row.nom_producteur ?? "").trim();
    if (!productName || !sourceProducerName) return;

    const sourceNorm = normalize(sourceProducerName);
    let targetNorm = null;

    if (byNorm.has(sourceNorm)) {
      return;
    }

    if (aliasNormMap.has(sourceNorm)) {
      targetNorm = aliasNormMap.get(sourceNorm);
    }

    if (!targetNorm || !byNorm.has(targetNorm)) {
      unmatchedRows.push(row);
      unmatchedProducts.add(productName);
      unmatchedProducers.add(sourceProducerName);
      return;
    }

    const targetProducer = byNorm.get(targetNorm);
    selectedRows.push({
      sourceProducerName,
      targetProducerId: targetProducer.id,
      targetProducerName: targetProducer.name,
      productName,
      imageUrl: String(row.image ?? "").trim(),
      description: stripHtml(String(row.description ?? "")),
      price: parsePrice(row.price),
    });
  });

  const rowsByTargetProducer = new Map();
  selectedRows.forEach((row) => {
    const key = row.targetProducerId;
    const list = rowsByTargetProducer.get(key) ?? [];
    list.push(row);
    rowsByTargetProducer.set(key, list);
  });

  console.log("Strong alias import plan:");
  console.log("- Source rows selected:", selectedRows.length);
  console.log("- Target producers touched:", rowsByTargetProducer.size);
  console.log(
    "- Unmatched producers remaining:",
    unmatchedProducers.size,
    "| unmatched products remaining:",
    unmatchedProducts.size,
  );

  if (!applyMode) {
    console.log("Dry-run only. Re-run with --apply.");
    return;
  }

  let productsCreated = 0;
  let productsUpdated = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;

  for (const [producerId, producerRows] of rowsByTargetProducer.entries()) {
    const targetProducerName = producerRows[0]?.targetProducerName ?? "";

    const grouped = new Map();
    producerRows.forEach((row) => {
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
      if (!target.description && row.description)
        target.description = row.description;

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

    const existingProductsSnap = await db
      .collection("products")
      .where("producerId", "==", producerId)
      .get();
    const existingByName = new Map(
      existingProductsSnap.docs.map((docSnap) => [
        normalize(String(docSnap.get("name") ?? "")),
        { ref: docSnap.ref },
      ]),
    );

    for (const product of preparedProducts) {
      const key = normalize(product.baseName);
      const existing = existingByName.get(key);
      const productRef = existing ? existing.ref : db.collection("products").doc();

      await productRef.set(
        {
          producerId,
          name: product.baseName,
          description: product.description || "",
          imageUrl: product.imageUrl || "",
          isOrganic: product.isOrganic,
          categoryId: pickCategoryId(targetProducerName, product.baseName),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      if (existing) productsUpdated += 1;
      else productsCreated += 1;

      const variantsSnap = await productRef.collection("variants").get();
      const existingVariants = new Map(
        variantsSnap.docs.map((docSnap) => [
          normalize(String(docSnap.get("label") ?? "")),
          docSnap.ref,
        ]),
      );

      for (const variant of product.variants) {
        const vKey = normalize(variant.label);
        const existingVariantRef = existingVariants.get(vKey);
        const variantRef =
          existingVariantRef ?? productRef.collection("variants").doc();
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
  }

  console.log("\nImport applied (strong aliases only):");
  console.log("- Products created:", productsCreated);
  console.log("- Products updated:", productsUpdated);
  console.log("- Variants created:", variantsCreated);
  console.log("- Variants updated:", variantsUpdated);
  console.log(
    "- Remaining unmatched producers:",
    unmatchedProducers.size,
    "| remaining unmatched products:",
    unmatchedProducts.size,
  );
}

await main();
