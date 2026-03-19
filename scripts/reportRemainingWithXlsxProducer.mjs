import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const xlsxPath = process.argv[2];
const csvPath = process.argv[3];
const outDirArg = process.argv[4] ?? "reports";

if (!xlsxPath || !csvPath) {
  throw new Error(
    "Usage: node scripts/reportRemainingWithXlsxProducer.mjs <xlsx-path> <csv-path> [output-dir]",
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

function buildSimilarity(a, b) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let inter = 0;
  for (const t of left) {
    if (right.has(t)) inter += 1;
  }
  const union = new Set([...left, ...right]).size;
  let score = inter / (union || 1);
  const na = normalize(a);
  const nb = normalize(b);
  if (na.includes(nb) || nb.includes(na)) score += 0.4;
  return score;
}

async function main() {
  const outDir = path.resolve(outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  const xlsx = parseXlsxWithPython(path.resolve(xlsxPath));
  const csv = parseCsvWithPython(path.resolve(csvPath));
  const xlsxRows = Array.isArray(xlsx.rows) ? xlsx.rows : [];
  const csvRows = Array.isArray(csv.rows) ? csv.rows : [];

  const productsSnap = await db.collection("products").get();
  const dbProductNames = new Set(
    productsSnap.docs.map((docSnap) => normalize(String(docSnap.get("name") ?? ""))).filter(Boolean),
  );

  const producerSnap = await db.collection("producers").get();
  const existingProducerNames = producerSnap.docs
    .map((docSnap) => String(docSnap.get("name") ?? "").trim())
    .filter(Boolean);

  const csvBySku = new Map();
  const csvByName = new Map();
  const csvByBase = new Map();
  for (const row of csvRows) {
    const sku = normalizeSku(row.sku);
    const sourceName = String(row.name ?? "").trim();
    const sourceNameKey = normalize(sourceName);
    const baseNameKey = normalize(parseBaseName(sourceName));
    if (sku) csvBySku.set(sku, row);
    if (sourceNameKey && !csvByName.has(sourceNameKey)) csvByName.set(sourceNameKey, row);
    if (baseNameKey && !csvByBase.has(baseNameKey)) csvByBase.set(baseNameKey, row);
  }

  const missingRows = [];
  const groups = new Map();

  for (const row of xlsxRows) {
    const sourceName = String(row.Product ?? "").trim();
    const producerName = String(row["NOM du producteur"] ?? "").trim();
    const sku = normalizeSku(row.SKU);
    const xlsxPrice = parsePrice(row.Price);
    if (!sourceName) continue;

    const baseName = parseBaseName(sourceName);
    const baseKey = normalize(baseName);
    if (!baseKey || dbProductNames.has(baseKey)) continue;

    const bySku = sku ? csvBySku.get(sku) : null;
    const byName = csvByName.get(normalize(sourceName));
    const byBase = csvByBase.get(baseKey);
    const csvRow = bySku ?? byName ?? byBase ?? null;

    const description = stripHtml(String(csvRow?.description ?? ""));
    const imageUrl = String(csvRow?.image ?? "").trim();
    const csvPrice = parsePrice(csvRow?.price);
    const finalPrice = csvPrice ?? xlsxPrice;

    const merged = {
      sourceName,
      baseName,
      producerName,
      sku: String(row.SKU ?? "").trim(),
      price: finalPrice,
      description,
      imageUrl,
      categoryCsv: String(csvRow?.category1 ?? "").trim(),
    };
    missingRows.push(merged);

    const g = groups.get(baseKey) ?? {
      baseName,
      producers: new Set(),
      rows: 0,
      minPrice: null,
      maxPrice: null,
      description,
      imageUrl,
    };
    g.producers.add(producerName);
    g.rows += 1;
    if (finalPrice !== null) {
      g.minPrice = g.minPrice === null ? finalPrice : Math.min(g.minPrice, finalPrice);
      g.maxPrice = g.maxPrice === null ? finalPrice : Math.max(g.maxPrice, finalPrice);
    }
    if (!g.description && description) g.description = description;
    if (!g.imageUrl && imageUrl) g.imageUrl = imageUrl;
    groups.set(baseKey, g);
  }

  missingRows.sort((a, b) =>
    a.producerName.localeCompare(b.producerName, "fr") || a.baseName.localeCompare(b.baseName, "fr"),
  );

  const groupedRows = Array.from(groups.values())
    .map((group) => ({
      baseName: group.baseName,
      producers: Array.from(group.producers).sort((a, b) => a.localeCompare(b, "fr")).join(" | "),
      rows: group.rows,
      minPrice: group.minPrice,
      maxPrice: group.maxPrice,
      description: group.description,
      imageUrl: group.imageUrl,
    }))
    .sort((a, b) => b.rows - a.rows || a.baseName.localeCompare(b.baseName, "fr"));

  const lineFile = path.join(outDir, "produits_restants_xlsx_csv_lignes.csv");
  const groupedFile = path.join(outDir, "produits_restants_xlsx_csv_groupes.csv");
  const mapFile = path.join(outDir, "proposition_mapping_producteurs.csv");

  const lineCsv = [
    "nom_produit_source;nom_produit_fusion;producteur_xlsx;sku;prix;description;image;categorie_csv",
    ...missingRows.map(
      (r) =>
        `${csvEscape(r.sourceName)};${csvEscape(r.baseName)};${csvEscape(r.producerName)};${csvEscape(r.sku)};${csvEscape(r.price ?? "")};${csvEscape(r.description)};${csvEscape(r.imageUrl)};${csvEscape(r.categoryCsv)}`,
    ),
  ].join("\n");

  const groupedCsv = [
    "nom_produit_fusion;producteurs_xlsx;nb_lignes;prix_min;prix_max;description;image",
    ...groupedRows.map(
      (r) =>
        `${csvEscape(r.baseName)};${csvEscape(r.producers)};${r.rows};${csvEscape(r.minPrice ?? "")};${csvEscape(r.maxPrice ?? "")};${csvEscape(r.description)};${csvEscape(r.imageUrl)}`,
    ),
  ].join("\n");

  const producerGroups = new Map();
  for (const row of missingRows) {
    const key = normalize(row.producerName);
    if (!key) continue;
    const g = producerGroups.get(key) ?? { name: row.producerName, count: 0 };
    g.count += 1;
    producerGroups.set(key, g);
  }

  const mappingRows = Array.from(producerGroups.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"))
    .map((producer) => {
      const ranked = existingProducerNames
        .map((candidate) => ({ candidate, score: buildSimilarity(producer.name, candidate) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return {
        source: producer.name,
        count: producer.count,
        suggestion1: ranked[0]?.candidate ?? "",
        score1: ranked[0]?.score?.toFixed(2) ?? "",
        suggestion2: ranked[1]?.candidate ?? "",
        score2: ranked[1]?.score?.toFixed(2) ?? "",
        suggestion3: ranked[2]?.candidate ?? "",
        score3: ranked[2]?.score?.toFixed(2) ?? "",
      };
    });

  const mapCsv = [
    "producteur_xlsx;nb_lignes;suggestion_1;score_1;suggestion_2;score_2;suggestion_3;score_3",
    ...mappingRows.map(
      (r) =>
        `${csvEscape(r.source)};${r.count};${csvEscape(r.suggestion1)};${r.score1};${csvEscape(r.suggestion2)};${r.score2};${csvEscape(r.suggestion3)};${r.score3}`,
    ),
  ].join("\n");

  fs.writeFileSync(lineFile, `\uFEFF${lineCsv}`, "utf8");
  fs.writeFileSync(groupedFile, `\uFEFF${groupedCsv}`, "utf8");
  fs.writeFileSync(mapFile, `\uFEFF${mapCsv}`, "utf8");

  console.log("Reports generated:");
  console.log("- line file:", lineFile, "| rows:", missingRows.length);
  console.log("- grouped file:", groupedFile, "| rows:", groupedRows.length);
  console.log("- mapping file:", mapFile, "| producers:", mappingRows.length);
}

await main();
