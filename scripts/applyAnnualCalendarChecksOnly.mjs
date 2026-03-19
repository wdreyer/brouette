import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/applyAnnualCalendarChecksOnly.mjs <xlsx-path>");
}

const absoluteInputPath = path.resolve(inputPath);
if (!fs.existsSync(absoluteInputPath)) {
  throw new Error(`XLSX introuvable: ${absoluteInputPath}`);
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!credentialPath && !credentialJson) {
  throw new Error(
    "Credentials manquantes. Definis GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT.",
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
from datetime import datetime
import json
import sys

wb = load_workbook(sys.argv[1], data_only=True)
ws = wb[wb.sheetnames[0]]

date_columns = []
for col in range(4, ws.max_column + 1):
    value = ws.cell(2, col).value
    if isinstance(value, datetime):
        date_columns.append({
            "col": col,
            "date": value.strftime("%Y-%m-%d"),
        })

rows = []
for row in range(4, ws.max_row + 1):
    name = ws.cell(row, 1).value
    if not name:
        continue
    active_cols = []
    for col in [entry["col"] for entry in date_columns]:
        value = ws.cell(row, col).value
        if isinstance(value, str) and "x" in value.lower():
            active_cols.append(col)
    rows.append({
        "producer": str(name).strip(),
        "activeCols": active_cols,
    })

print(json.dumps({"dateColumns": date_columns, "rows": rows}, ensure_ascii=False))
`;

  const result = spawnSync("python", ["-", xlsxPath], {
    input: pythonScript,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Parsing Python KO: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeChronologicalDates(rawDateColumns) {
  const next = [];
  let previous = null;
  rawDateColumns
    .sort((left, right) => left.col - right.col)
    .forEach((entry) => {
      const current = new Date(`${entry.date}T00:00:00.000Z`);
      if (Number.isNaN(current.getTime())) return;
      if (previous) {
        while (current.getTime() <= previous.getTime()) {
          current.setUTCFullYear(current.getUTCFullYear() + 1);
        }
      }
      previous = current;
      next.push({
        col: entry.col,
        date: current,
        key: current.toISOString().slice(0, 10),
      });
    });
  return next;
}

function groupDatesByDistribution(dateColumns) {
  const groups = [];
  for (let index = 0; index < dateColumns.length; index += 3) {
    const slice = dateColumns.slice(index, index + 3);
    if (slice.length === 3) groups.push(slice);
  }
  return groups;
}

function computeCalendarByDistribution(xlsxRows, dateColumns) {
  const dateByCol = new Map(dateColumns.map((entry) => [entry.col, entry.key]));
  const groupedDates = groupDatesByDistribution(dateColumns);
  const rows = xlsxRows.map((row) => ({
    producer: String(row.producer ?? "").trim(),
    activeCols: Array.isArray(row.activeCols) ? row.activeCols : [],
  }));

  const distributions = groupedDates.map((dates) => ({
    dateKeys: dates.map((entry) => entry.key),
    byProducer: new Map(),
  }));

  rows.forEach((row) => {
    distributions.forEach((distribution) => {
      const activeDateKeys = row.activeCols
        .map((col) => dateByCol.get(col))
        .filter((key) => key && distribution.dateKeys.includes(key));
      distribution.byProducer.set(row.producer, activeDateKeys);
    });
  });
  return distributions;
}

function sortDateKeys(keys) {
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

async function resolveProducerIds(xlsxRows) {
  const producersSnap = await db.collection("producers").get();
  const producerDocs = producersSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.get("name") ?? ""),
    referentId: docSnap.get("referentId") ?? null,
    referentName: docSnap.get("referentName") ?? null,
  }));

  const exactMap = new Map();
  producerDocs.forEach((producer) => {
    exactMap.set(normalizeName(producer.name), producer);
  });

  const unresolved = [];
  const ambiguous = [];
  const producerBySourceName = new Map();

  for (const row of xlsxRows) {
    const sourceName = String(row.producer ?? "").trim();
    if (!sourceName) continue;
    const normalized = normalizeName(sourceName);
    let match = exactMap.get(normalized) ?? null;
    if (!match) {
      const fuzzy = producerDocs.filter((producer) => {
        const norm = normalizeName(producer.name);
        return norm.includes(normalized) || normalized.includes(norm);
      });
      if (fuzzy.length === 1) {
        match = fuzzy[0];
      } else if (fuzzy.length > 1) {
        ambiguous.push({
          source: sourceName,
          candidates: fuzzy.map((item) => item.name),
        });
      }
    }
    if (!match) {
      unresolved.push(sourceName);
      continue;
    }
    producerBySourceName.set(sourceName, match);
  }

  const normalizedXlsxSet = new Set(
    xlsxRows.map((row) => normalizeName(row.producer)).filter(Boolean),
  );
  const extrasInDb = producerDocs
    .filter((producer) => !normalizedXlsxSet.has(normalizeName(producer.name)))
    .map((producer) => producer.name)
    .sort((a, b) => a.localeCompare(b, "fr"));

  return { producerBySourceName, unresolved, ambiguous, extrasInDb };
}

async function loadExistingDistributions() {
  const snap = await db.collection("distributionDates").get();
  return snap.docs
    .map((docSnap) => ({
      id: docSnap.id,
      status: String(docSnap.get("status") ?? ""),
      dateKeys: sortDateKeys(
        (docSnap.get("dates") ?? [])
          .map((value) => value?.toDate?.())
          .filter(Boolean)
          .map((date) => date.toISOString().slice(0, 10)),
      ),
    }))
    .filter((item) => item.dateKeys.length === 3)
    .sort((a, b) => a.dateKeys[0].localeCompare(b.dateKeys[0]));
}

function matchDistributionGroups(xlsxDistributions, dbDistributions) {
  const byDateKey = new Map(
    dbDistributions.map((distribution) => [distribution.dateKeys.join("|"), distribution]),
  );

  const matches = [];
  const unmatchedXlsx = [];
  const matchedDbIds = new Set();

  xlsxDistributions.forEach((group) => {
    const key = sortDateKeys(group.dateKeys).join("|");
    const dbDistribution = byDateKey.get(key);
    if (!dbDistribution) {
      unmatchedXlsx.push(group.dateKeys);
      return;
    }
    matchedDbIds.add(dbDistribution.id);
    matches.push({ group, dbDistribution });
  });

  const unmatchedDb = dbDistributions
    .filter((distribution) => !matchedDbIds.has(distribution.id))
    .map((distribution) => ({ id: distribution.id, dateKeys: distribution.dateKeys, status: distribution.status }));

  return { matches, unmatchedXlsx, unmatchedDb };
}

async function applyChecks(matches, producerBySourceName) {
  for (const { group, dbDistribution } of matches) {
    const distributionRef = db.collection("distributionDates").doc(dbDistribution.id);
    const existingCalendar = await distributionRef.collection("calendarProducers").get();
    const existingSet = new Set(existingCalendar.docs.map((docSnap) => docSnap.id));

    const operations = [];
    group.byProducer.forEach((activeDateKeys, sourceProducerName) => {
      const producer = producerBySourceName.get(sourceProducerName);
      if (!producer) return;
      const uniqueDateKeys = sortDateKeys(activeDateKeys.filter((key) => group.dateKeys.includes(key)));
      const calendarRef = distributionRef.collection("calendarProducers").doc(producer.id);
      const producerRef = distributionRef.collection("producers").doc(producer.id);

      if (uniqueDateKeys.length > 0) {
        operations.push((batch) =>
          batch.set(
            calendarRef,
            {
              producerId: producer.id,
              active: true,
              activeDateKeys: uniqueDateKeys,
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          ),
        );
        operations.push((batch) =>
          batch.set(
            producerRef,
            {
              producerId: producer.id,
              referentId: producer.referentId ?? null,
              referentName: producer.referentName ?? null,
              active: true,
              activeDateKeys: uniqueDateKeys,
            },
            { merge: true },
          ),
        );
      } else if (existingSet.has(producer.id)) {
        operations.push((batch) => batch.delete(calendarRef));
        operations.push((batch) =>
          batch.set(
            producerRef,
            {
              producerId: producer.id,
              active: false,
              activeDateKeys: [],
              validatedByReferent: false,
              validatedAt: null,
            },
            { merge: true },
          ),
        );
      }
    });

    const chunkSize = 350;
    for (let index = 0; index < operations.length; index += chunkSize) {
      const batch = db.batch();
      operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
      await batch.commit();
    }
  }
}

async function main() {
  const parsed = parseWorkbookWithPython(absoluteInputPath);
  const normalizedDateColumns = normalizeChronologicalDates(parsed.dateColumns ?? []);
  if (!normalizedDateColumns.length) {
    throw new Error("Aucune colonne date detectee (ligne 2).");
  }

  const xlsxDistributions = computeCalendarByDistribution(parsed.rows ?? [], normalizedDateColumns);
  if (!xlsxDistributions.length) {
    throw new Error("Aucune distribution complete (3 dates) trouvee dans le fichier.");
  }

  const dbDistributions = await loadExistingDistributions();
  const { matches, unmatchedXlsx, unmatchedDb } = matchDistributionGroups(xlsxDistributions, dbDistributions);
  const { producerBySourceName, unresolved, ambiguous, extrasInDb } = await resolveProducerIds(parsed.rows ?? []);

  await applyChecks(matches, producerBySourceName);

  console.log(`Distributions BDD trouvees (3 dates): ${dbDistributions.length}`);
  console.log(`Groupes XLSX (3 dates): ${xlsxDistributions.length}`);
  console.log(`Groupes appliques: ${matches.length}`);

  if (unmatchedXlsx.length) {
    console.log("\nGroupes XLSX sans distribution correspondante dans la BDD:");
    unmatchedXlsx.forEach((keys) => console.log(`- ${keys.join(" / ")}`));
  }

  if (unmatchedDb.length) {
    console.log("\nDistributions BDD sans groupe XLSX correspondant:");
    unmatchedDb.forEach((item) => console.log(`- ${item.id} | ${item.status} | ${item.dateKeys.join(" / ")}`));
  }

  if (unresolved.length) {
    console.log("\nProducteurs presents dans XLSX mais absents de la BDD (non modifies):");
    unresolved.forEach((name) => console.log(`- ${name}`));
  }

  if (ambiguous.length) {
    console.log("\nProducteurs ambigus (plusieurs candidats en BDD, non modifies):");
    ambiguous.forEach((entry) =>
      console.log(`- ${entry.source} -> ${entry.candidates.join(" | ")}`),
    );
  }

  if (extrasInDb.length) {
    console.log("\nProducteurs en BDD mais absents du XLSX:");
    extrasInDb.forEach((name) => console.log(`- ${name}`));
  }

  console.log("\nTermine: cases cochees/decochees appliquees sans creer ni supprimer de distribution/producteur.");
}

await main();
