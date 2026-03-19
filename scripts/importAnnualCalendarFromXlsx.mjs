import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/importAnnualCalendarFromXlsx.mjs <xlsx-path>");
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
    if active_cols:
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
    throw new Error(`Python parse failed: ${result.stderr || result.stdout}`);
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

function chunk(array, chunkSize) {
  const result = [];
  for (let index = 0; index < array.length; index += chunkSize) {
    result.push(array.slice(index, index + chunkSize));
  }
  return result;
}

async function deleteSubcollection(parentRef, name) {
  const snapshot = await parentRef.collection(name).get();
  if (snapshot.empty) return;
  for (const docsChunk of chunk(snapshot.docs, 350)) {
    const batch = db.batch();
    docsChunk.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
}

function groupDatesByDistribution(dateColumns) {
  const groups = [];
  for (let index = 0; index < dateColumns.length; index += 3) {
    const slice = dateColumns.slice(index, index + 3);
    if (slice.length) groups.push(slice);
  }
  return groups;
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
      if (fuzzy.length === 1) match = fuzzy[0];
    }

    if (!match) {
      const createdRef = await db.collection("producers").add({
        name: sourceName,
        coopStatus: "active",
        createdAt: Timestamp.now(),
      });
      match = { id: createdRef.id, name: sourceName, referentId: null, referentName: null };
      producerDocs.push(match);
      exactMap.set(normalized, match);
      unresolved.push(sourceName);
    }
    producerBySourceName.set(sourceName, match);
  }

  return { producerBySourceName, unresolved };
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
    dates: dates.map((entry) => entry.date),
    byProducer: new Map(),
  }));

  rows.forEach((row) => {
    distributions.forEach((distribution) => {
      const activeDateKeys = row.activeCols
        .map((col) => dateByCol.get(col))
        .filter((key) => key && distribution.dateKeys.includes(key));
      if (activeDateKeys.length) {
        distribution.byProducer.set(row.producer, activeDateKeys);
      }
    });
  });

  return distributions;
}

async function replaceDistributions(distributionDefinitions) {
  const existingSnap = await db.collection("distributionDates").get();
  for (const distributionDoc of existingSnap.docs) {
    const status = String(distributionDoc.get("status") ?? "");
    if (isOpenStatus(status)) continue;
    await deleteSubcollection(distributionDoc.ref, "offerItems");
    await deleteSubcollection(distributionDoc.ref, "producers");
    await deleteSubcollection(distributionDoc.ref, "calendarProducers");
    await distributionDoc.ref.delete();
  }

  const createdRefs = [];
  for (const definition of distributionDefinitions) {
    const ref = db.collection("distributionDates").doc();
    await ref.set({
      status: "planned",
      dates: definition.dates.map((date) => Timestamp.fromDate(date)),
      createdAt: Timestamp.now(),
    });
    createdRefs.push(ref);
  }
  return createdRefs;
}

async function applyCalendarToDistributions(createdRefs, distributionDefinitions, producerBySourceName) {
  for (let index = 0; index < createdRefs.length; index += 1) {
    const distributionRef = createdRefs[index];
    const definition = distributionDefinitions[index];
    const ops = [];

    definition.byProducer.forEach((activeDateKeys, sourceProducerName) => {
      const producer = producerBySourceName.get(sourceProducerName);
      if (!producer) return;
      const calendarRef = distributionRef.collection("calendarProducers").doc(producer.id);
      const producerRef = distributionRef.collection("producers").doc(producer.id);
      ops.push({
        calendarRef,
        producerRef,
        producer,
        activeDateKeys,
      });
    });

    for (const chunkOps of chunk(ops, 250)) {
      const batch = db.batch();
      chunkOps.forEach((entry) => {
        batch.set(
          entry.calendarRef,
          {
            producerId: entry.producer.id,
            active: true,
            activeDateKeys: entry.activeDateKeys,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );
        batch.set(
          entry.producerRef,
          {
            producerId: entry.producer.id,
            referentId: entry.producer.referentId ?? null,
            referentName: entry.producer.referentName ?? null,
            active: true,
            activeDateKeys: entry.activeDateKeys,
            validatedByReferent: false,
            validatedAt: null,
          },
          { merge: true },
        );
      });
      await batch.commit();
    }
  }
}

function isOpenStatus(status) {
  return ["open", "ouverte", "ouvertes"].includes(String(status ?? "").toLowerCase());
}

async function main() {
  const parsed = parseWorkbookWithPython(absoluteInputPath);
  const normalizedDateColumns = normalizeChronologicalDates(parsed.dateColumns ?? []);
  if (!normalizedDateColumns.length) {
    throw new Error("No date columns found in workbook row 2.");
  }

  const distributions = computeCalendarByDistribution(parsed.rows ?? [], normalizedDateColumns);
  if (!distributions.length) {
    throw new Error("No distribution periods detected from workbook.");
  }

  const { producerBySourceName, unresolved } = await resolveProducerIds(parsed.rows ?? []);
  const createdDistributionRefs = await replaceDistributions(distributions);
  await applyCalendarToDistributions(createdDistributionRefs, distributions, producerBySourceName);

  console.log(`Imported ${distributions.length} distributions from annual calendar.`);
  if (unresolved.length) {
    console.log(`Created missing producers (${unresolved.length}):`);
    unresolved.forEach((name) => console.log(`- ${name}`));
  }
}

await main();

