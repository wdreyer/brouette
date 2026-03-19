import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const xlsxFinalPath = process.argv[2];
const xlsxV3Path = process.argv[3];
const csvPath = process.argv[4];
const outDirArg = process.argv[5] ?? "reports";

if (!xlsxFinalPath || !xlsxV3Path || !csvPath) {
  throw new Error(
    "Usage: node scripts/reportMissingCombinedSources.mjs <liste_finale.xlsx> <tableau_v3.xlsx> <products.csv> [output-dir]",
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

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSku(text) {
  return String(text ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function cleanupName(name) {
  let s = String(name ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/^[A-Za-z0-9]+\s*-\s*/, "");
  s = s.replace(/\s*-\s*\d{2}\/\d{2}\s*$/i, "");
  return s.replace(/\s+/g, " ").trim();
}

function parseBaseName(rawName) {
  const fullName = cleanupName(rawName);
  if (!fullName) return "";

  const qtyRegex =
    /(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|cl|ml|l|piece|pieces|pcs|x\d+)?)$/i;
  const ouMatch = fullName.match(/^(.*)\s+ou\s+(.+)$/i);
  if (ouMatch) {
    const leftRaw = ouMatch[1].trim();
    const leftQty = leftRaw.match(qtyRegex)?.[1]?.trim() ?? "";
    let baseName = leftRaw;
    if (leftQty) {
      baseName = leftRaw.slice(0, Math.max(0, leftRaw.length - leftQty.length)).trim();
    }
    return baseName || fullName;
  }

  const tailQty = fullName.match(qtyRegex)?.[1]?.trim() ?? "";
  if (tailQty) {
    const baseName = fullName.slice(0, Math.max(0, fullName.length - tailQty.length)).trim();
    return baseName || fullName;
  }
  return fullName;
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
  const num = Number(String(value ?? "").replace(",", ".").trim());
  return Number.isFinite(num) ? num : null;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes('"') || str.includes(";") || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function parseXlsxWithPython(filePath) {
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

  const result = spawnSync("python", ["-", filePath], {
    input: pythonScript,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Python XLSX parse failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function parseCsvWithPython(filePath) {
  const pythonScript = `
import csv
import json
import sys

with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f, delimiter=";")
    rows = list(reader)
print(json.dumps({"rows": rows}, ensure_ascii=False))
`;

  const result = spawnSync("python", ["-", filePath], {
    input: pythonScript,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Python CSV parse failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function main() {
  const outDir = path.resolve(outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  const xlsxFinalRows = parseXlsxWithPython(path.resolve(xlsxFinalPath)).rows ?? [];
  const xlsxV3Rows = parseXlsxWithPython(path.resolve(xlsxV3Path)).rows ?? [];
  const csvRows = parseCsvWithPython(path.resolve(csvPath)).rows ?? [];

  const csvBySku = new Map();
  const csvByBase = new Map();
  for (const row of csvRows) {
    const sku = normalizeSku(row.sku);
    const base = parseBaseName(row.name);
    const baseKey = normalize(base);
    if (sku && !csvBySku.has(sku)) csvBySku.set(sku, row);
    if (baseKey && !csvByBase.has(baseKey)) csvByBase.set(baseKey, row);
  }

  const sourceRecords = [];

  for (const row of xlsxFinalRows) {
    sourceRecords.push({
      source: "xlsx_finale",
      rawName: String(row.Product ?? "").trim(),
      producer: String(row["NOM du producteur"] ?? "").trim(),
      sku: String(row.SKU ?? "").trim(),
      price: parsePrice(row.Price),
      description: "",
      imageUrl: "",
    });
  }

  for (const row of xlsxV3Rows) {
    sourceRecords.push({
      source: "xlsx_v3",
      rawName: String(row.nom_produit ?? "").trim(),
      producer: String(row.nom_producteur ?? "").trim(),
      sku: "",
      price: parsePrice(row.price),
      description: stripHtml(String(row.description ?? "")),
      imageUrl: String(row.image ?? "").trim(),
    });
  }

  const combined = [];
  for (const row of sourceRecords) {
    const baseName = parseBaseName(row.rawName);
    const baseKey = normalize(baseName);
    if (!baseKey) continue;

    let description = row.description;
    let imageUrl = row.imageUrl;
    let price = row.price;

    const skuKey = normalizeSku(row.sku);
    const csvMatch = (skuKey && csvBySku.get(skuKey)) || csvByBase.get(baseKey) || null;
    if (csvMatch) {
      if (!description) description = stripHtml(String(csvMatch.description ?? ""));
      if (!imageUrl) imageUrl = String(csvMatch.image ?? "").trim();
      if (price === null) price = parsePrice(csvMatch.price);
    }

    combined.push({
      ...row,
      baseName,
      baseKey,
      producer: row.producer,
      producerKey: normalize(row.producer),
      description,
      imageUrl,
      price,
    });
  }

  const productsSnap = await db.collection("products").get();
  const producersSnap = await db.collection("producers").get();
  const producerNameById = new Map(
    producersSnap.docs.map((docSnap) => [docSnap.id, String(docSnap.get("name") ?? "").trim()]),
  );

  const dbNameSet = new Set();
  const dbNameProducerSet = new Set();
  for (const docSnap of productsSnap.docs) {
    const data = docSnap.data();
    const name = String(data.name ?? "").trim();
    const producerId = String(data.producerId ?? "").trim();
    const producerName = String(data.producerName ?? producerNameById.get(producerId) ?? "").trim();
    const nameKey = normalize(name);
    const producerKey = normalize(producerName);
    if (nameKey) dbNameSet.add(nameKey);
    if (nameKey && producerKey) dbNameProducerSet.add(`${nameKey}::${producerKey}`);
  }

  const grouped = new Map();
  for (const row of combined) {
    const producerPart = row.producerKey || "no_producer";
    const groupKey = `${row.baseKey}::${producerPart}`;
    const inDbByName = dbNameSet.has(row.baseKey);
    const inDbByNameProducer =
      row.producerKey.length > 0 ? dbNameProducerSet.has(`${row.baseKey}::${row.producerKey}`) : inDbByName;

    const group = grouped.get(groupKey) ?? {
      baseName: row.baseName,
      baseKey: row.baseKey,
      producer: row.producer,
      producerKey: row.producerKey,
      sources: new Set(),
      lines: 0,
      minPrice: null,
      maxPrice: null,
      description: row.description,
      imageUrl: row.imageUrl,
      inDbByName,
      inDbByNameProducer,
      exampleRaw: row.rawName,
    };
    group.sources.add(row.source);
    group.lines += 1;
    if (row.price !== null) {
      group.minPrice = group.minPrice === null ? row.price : Math.min(group.minPrice, row.price);
      group.maxPrice = group.maxPrice === null ? row.price : Math.max(group.maxPrice, row.price);
    }
    if (!group.description && row.description) group.description = row.description;
    if (!group.imageUrl && row.imageUrl) group.imageUrl = row.imageUrl;
    if (!group.exampleRaw && row.rawName) group.exampleRaw = row.rawName;
    grouped.set(groupKey, group);
  }

  const allGroups = Array.from(grouped.values()).sort(
    (a, b) =>
      a.producer.localeCompare(b.producer, "fr") || a.baseName.localeCompare(b.baseName, "fr"),
  );
  const missingByName = allGroups.filter((g) => !g.inDbByName);
  const missingByNameProducer = allGroups.filter((g) => !g.inDbByNameProducer);

  const producerSummary = new Map();
  for (const row of missingByNameProducer) {
    const key = row.producer || "(sans producteur)";
    const item = producerSummary.get(key) ?? {
      producer: key,
      missingProducts: 0,
      totalLines: 0,
      examples: [],
    };
    item.missingProducts += 1;
    item.totalLines += row.lines;
    if (item.examples.length < 4) item.examples.push(row.baseName);
    producerSummary.set(key, item);
  }

  const summaryRows = Array.from(producerSummary.values()).sort(
    (a, b) => b.missingProducts - a.missingProducts || a.producer.localeCompare(b.producer, "fr"),
  );

  const missingFile = path.join(outDir, "bilan_produits_manquants_compiles.csv");
  const summaryFile = path.join(outDir, "bilan_manquants_par_producteur.csv");

  const missingCsv = [
    "nom_produit_fusion;producteur_source;lignes_sources;sources;manquant_nom;manquant_nom_producteur;prix_min;prix_max;description;image;exemple_nom_source",
    ...missingByNameProducer.map(
      (r) =>
        `${csvEscape(r.baseName)};${csvEscape(r.producer)};${r.lines};${csvEscape(Array.from(r.sources).sort().join(" | "))};${r.inDbByName ? "non" : "oui"};oui;${csvEscape(r.minPrice ?? "")};${csvEscape(r.maxPrice ?? "")};${csvEscape(r.description)};${csvEscape(r.imageUrl)};${csvEscape(r.exampleRaw)}`,
    ),
  ].join("\n");

  const summaryCsv = [
    "producteur_source;produits_manquants;nb_lignes_sources;exemples",
    ...summaryRows.map(
      (r) =>
        `${csvEscape(r.producer)};${r.missingProducts};${r.totalLines};${csvEscape(r.examples.join(" | "))}`,
    ),
  ].join("\n");

  fs.writeFileSync(missingFile, `\uFEFF${missingCsv}`, "utf8");
  fs.writeFileSync(summaryFile, `\uFEFF${summaryCsv}`, "utf8");

  console.log("Bilan compile termine:");
  console.log("- sources combinees (lignes):", combined.length);
  console.log("- groupes produit+producteur:", allGroups.length);
  console.log("- manquants par nom seul:", missingByName.length);
  console.log("- manquants par nom+producteur:", missingByNameProducer.length);
  console.log("- fichier detail:", missingFile);
  console.log("- fichier resume:", summaryFile);
}

await main();
