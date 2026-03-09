import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const adminCredentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const adminJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!adminCredentialPath && !adminJson) {
  throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = adminJson
  ? JSON.parse(adminJson)
  : JSON.parse(fs.readFileSync(adminCredentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const DEFAULT_PRODUCERS_CSV =
  "C:\\\\Users\\\\dreye\\\\Downloads\\\\liste des producteurs et référents juin 25.xlsx - Feuil1.csv";
const DEFAULT_REFERENTS_CSV = "C:\\\\Users\\\\dreye\\\\Downloads\\\\référents coop (1).csv";

const producersCsvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PRODUCERS_CSV;
const referentsCsvPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_REFERENTS_CSV;

function parseCsv(text) {
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
    if (char === "," && !inQuotes) {
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
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const producerRaw = fs.readFileSync(producersCsvPath, "utf8");
const producerRows = parseCsv(producerRaw);
if (!producerRows.length) {
  throw new Error("CSV producteurs vide.");
}

const producerHeaders = producerRows[0].map((cell) => normalize(cell));
const exactHeaderIndex = (label) =>
  producerHeaders.findIndex((header) => header === normalize(label));
const firstHeaderIndex = (label) =>
  producerHeaders.findIndex((header) => header.includes(normalize(label)));
const idxProducer = firstHeaderIndex("producteur");
let idxReferent = exactHeaderIndex("referent");
if (idxReferent === -1) {
  idxReferent = producerHeaders.findIndex(
    (header) => header.includes("referent") && !header.includes("tel"),
  );
}
if (idxReferent === -1) {
  idxReferent = firstHeaderIndex("referent");
}

const producerReferentMap = new Map();
let lastReferent = "";
producerRows.slice(1).forEach((row) => {
  const referentName = (row[idxReferent] || "").trim();
  const producerName = (row[idxProducer] || "").trim();
  const resolved = referentName || lastReferent;
  if (resolved) lastReferent = resolved;
  if (!producerName) return;
  producerReferentMap.set(normalize(producerName), resolved);
});

let referentByName = new Map();
const referentByEmail = new Map();
if (referentsCsvPath && fs.existsSync(referentsCsvPath)) {
  const referentRaw = fs.readFileSync(referentsCsvPath, "utf8");
  const referentRows = parseCsv(referentRaw);
  if (referentRows.length) {
    const headers = referentRows[0].map((cell) => normalize(cell));
    const col = (label) => headers.findIndex((header) => header.includes(normalize(label)));
    const idxFirst = col("first name");
    const idxLast = col("last name");
    const idxEmail = col("e-mail 1 - value");
    referentRows.slice(1).forEach((row) => {
      const firstName = (row[idxFirst] || "").trim();
      const lastName = (row[idxLast] || "").trim();
      const email = (row[idxEmail] || "").trim().toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      if (!fullName) return;
      const key = normalize(fullName);
      referentByName.set(key, { name: fullName, email });
      if (email) referentByEmail.set(email, { name: fullName, email });
    });
  }
}

const referentSnap = await db.collection("members").where("auth.role", "==", "referent").get();
referentByName = new Map(
  Array.from(referentByName.entries()).filter(([key]) => key),
);
const referentMemberByName = new Map();
const referentMemberByEmail = new Map();
const referentMembersByLastName = new Map();
referentSnap.docs.forEach((docSnap) => {
  const data = docSnap.data();
  const nameKey = normalize(`${data.firstName || ""} ${data.lastName || ""}`);
  if (nameKey) referentMemberByName.set(nameKey, { id: docSnap.id, data });
  if (data.email) referentMemberByEmail.set(String(data.email).toLowerCase(), { id: docSnap.id, data });
  const lastNameKey = normalize(data.lastName || "");
  if (lastNameKey) {
    const list = referentMembersByLastName.get(lastNameKey) || [];
    list.push({ id: docSnap.id, data });
    referentMembersByLastName.set(lastNameKey, list);
  }
});

const producerSnap = await db.collection("producers").get();
let updated = 0;
let unmatched = 0;

for (const docSnap of producerSnap.docs) {
  const data = docSnap.data();
  const producerKey = normalize(data.name || "");
  const referentName = producerReferentMap.get(producerKey) || data.referentName || "";
  let referentId = null;
  let referentPhone = null;
  let referentFullName = null;

  if (referentName) {
    const nameKey = normalize(referentName);
    const member = referentMemberByName.get(nameKey);
    if (member) {
      referentId = member.id;
      referentFullName = `${member.data.firstName || ""} ${member.data.lastName || ""}`.trim();
      referentPhone = member.data.phone || null;
    } else {
      const lastToken = normalize(referentName).split(" ").pop();
      if (lastToken && referentMembersByLastName.has(lastToken)) {
        const candidates = referentMembersByLastName.get(lastToken) || [];
        if (candidates.length === 1) {
          const fallback = candidates[0];
          referentId = fallback.id;
          referentFullName = `${fallback.data.firstName || ""} ${fallback.data.lastName || ""}`.trim();
          referentPhone = fallback.data.phone || null;
        }
      }
      if (!referentId) {
        const fromCsv = referentByName.get(nameKey);
        if (fromCsv?.email) {
          const byEmail = referentMemberByEmail.get(fromCsv.email.toLowerCase());
          if (byEmail) {
            referentId = byEmail.id;
            referentFullName = `${byEmail.data.firstName || ""} ${byEmail.data.lastName || ""}`.trim();
            referentPhone = byEmail.data.phone || null;
          }
        }
      }
    }
  }

  if (!referentId) {
    unmatched += 1;
  }

  await docSnap.ref.set(
    {
      referentId: referentId || null,
      referentName: referentFullName || (referentName ? referentName : null),
      referentPhone: referentPhone || null,
    },
    { merge: true },
  );
  updated += 1;
}

console.log(`Producers updated: ${updated}`);
console.log(`Unmatched producers: ${unmatched}`);
