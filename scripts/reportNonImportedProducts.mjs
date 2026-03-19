import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const inputPath = process.argv[2];
const outDirArg = process.argv[3] ?? "reports";

if (!inputPath) {
  throw new Error(
    "Usage: node scripts/reportNonImportedProducts.mjs <xlsx-path> [output-dir]",
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

async function main() {
  const absoluteInputPath = path.resolve(inputPath);
  const outDir = path.resolve(outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  const parsed = parseWorkbookWithPython(absoluteInputPath);
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

  const productsSnap = await db.collection("products").get();
  const dbProductNames = new Set(
    productsSnap.docs.map((docSnap) => normalize(String(docSnap.get("name") ?? ""))).filter(Boolean),
  );

  const missingRows = [];
  const groups = new Map();

  for (const row of rows) {
    const sourceName = String(row.nom_produit ?? "").trim();
    if (!sourceName) continue;
    const producerName = String(row.nom_producteur ?? "").trim();
    const description = stripHtml(String(row.description ?? ""));
    const imageUrl = String(row.image ?? "").trim();
    const price = parsePrice(row.price);
    const baseName = parseBaseName(sourceName);
    const key = normalize(baseName);
    if (!key || dbProductNames.has(key)) continue;

    missingRows.push({
      sourceName,
      baseName,
      producerName,
      description,
      imageUrl,
      price,
    });

    const group = groups.get(key) ?? {
      baseName,
      producers: new Set(),
      count: 0,
      minPrice: null,
      maxPrice: null,
      description,
      imageUrl,
    };
    group.producers.add(producerName);
    group.count += 1;
    if (price !== null) {
      group.minPrice = group.minPrice === null ? price : Math.min(group.minPrice, price);
      group.maxPrice = group.maxPrice === null ? price : Math.max(group.maxPrice, price);
    }
    if (!group.description && description) group.description = description;
    if (!group.imageUrl && imageUrl) group.imageUrl = imageUrl;
    groups.set(key, group);
  }

  missingRows.sort((a, b) =>
    a.baseName.localeCompare(b.baseName, "fr") ||
    a.producerName.localeCompare(b.producerName, "fr"),
  );

  const groupedRows = Array.from(groups.values())
    .map((group) => ({
      baseName: group.baseName,
      producers: Array.from(group.producers).sort((a, b) => a.localeCompare(b, "fr")).join(" | "),
      count: group.count,
      minPrice: group.minPrice,
      maxPrice: group.maxPrice,
      description: group.description,
      imageUrl: group.imageUrl,
    }))
    .sort((a, b) => b.count - a.count || a.baseName.localeCompare(b.baseName, "fr"));

  const lineFile = path.join(outDir, "produits_non_importes_lignes.csv");
  const groupedFile = path.join(outDir, "produits_non_importes_groupes.csv");

  const lineCsv = [
    "nom_produit_source;nom_produit_fusion;producteur;description;image;prix",
    ...missingRows.map(
      (row) =>
        `${csvEscape(row.sourceName)};${csvEscape(row.baseName)};${csvEscape(row.producerName)};${csvEscape(row.description)};${csvEscape(row.imageUrl)};${csvEscape(row.price ?? "")}`,
    ),
  ].join("\n");

  const groupedCsv = [
    "nom_produit_fusion;producteurs;nb_lignes;prix_min;prix_max;description;image",
    ...groupedRows.map(
      (row) =>
        `${csvEscape(row.baseName)};${csvEscape(row.producers)};${row.count};${csvEscape(row.minPrice ?? "")};${csvEscape(row.maxPrice ?? "")};${csvEscape(row.description)};${csvEscape(row.imageUrl)}`,
    ),
  ].join("\n");

  fs.writeFileSync(lineFile, `\uFEFF${lineCsv}`, "utf8");
  fs.writeFileSync(groupedFile, `\uFEFF${groupedCsv}`, "utf8");

  console.log("Report generated:");
  console.log("- line file:", lineFile, "| rows:", missingRows.length);
  console.log("- grouped file:", groupedFile, "| rows:", groupedRows.length);
}

await main();
