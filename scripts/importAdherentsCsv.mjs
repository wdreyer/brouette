import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function normalize(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

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
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => String(cell ?? "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => String(cell ?? "").trim() !== "")) rows.push(row);
  }

  return rows;
}

function cleanSegment(value) {
  return String(value ?? "")
    .split(":::")
    .map((part) => part.trim())
    .find(Boolean) ?? "";
}

function parseFormattedAddress(formattedValue) {
  const first = cleanSegment(formattedValue).replace(/\s+/g, " ").trim();
  if (!first) return { street: "", postalCode: "", city: "" };
  let text = first
    .replace(/\bFR\b$/i, "")
    .replace(/([A-Za-zÀ-ÿ' -]+)FR$/i, "$1")
    .trim();

  const fullMatch = text.match(/^(.*?)(\d{4,5})\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]*)$/);
  if (fullMatch) {
    return {
      street: fullMatch[1].trim(),
      postalCode: fullMatch[2].trim(),
      city: fullMatch[3].trim(),
    };
  }

  return { street: text, postalCode: "", city: "" };
}

function normalizeAddressParts({ street = "", postalCode = "", city = "", formatted = "" }) {
  let nextStreet = String(street ?? "").trim();
  let nextPostalCode = String(postalCode ?? "").trim();
  let nextCity = String(city ?? "").trim();

  const parsedFormatted = parseFormattedAddress(formatted);
  if (!nextStreet && parsedFormatted.street) nextStreet = parsedFormatted.street;
  if (!nextPostalCode && parsedFormatted.postalCode) nextPostalCode = parsedFormatted.postalCode;
  if (!nextCity && parsedFormatted.city) nextCity = parsedFormatted.city;

  const streetMatch = nextStreet.match(/^(.*?)(\d{4,5})\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]*)$/);
  if (streetMatch) {
    nextStreet = streetMatch[1].trim();
    if (!nextPostalCode) nextPostalCode = streetMatch[2].trim();
    if (!nextCity) nextCity = streetMatch[3].trim();
  }

  return {
    street: nextStreet,
    postalCode: nextPostalCode,
    city: nextCity,
  };
}

function extractEmails(value) {
  const raw = String(value ?? "");
  const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const seen = new Set();
  const out = [];
  for (const item of matches) {
    const cleaned = item.trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function normalizePhoneForKey(value) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

function extractPhones(value) {
  const parts = String(value ?? "")
    .split(":::")
    .map((part) => part.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const key = normalizePhoneForKey(part);
    if (!key || key.replace(/\D/g, "").length < 6) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

function uniqueStrings(values, keyFn = (value) => String(value ?? "").toLowerCase()) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const cleaned = String(value ?? "").trim();
    if (!cleaned) continue;
    const key = keyFn(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function splitHeaderIndexes(headers, expectedPrefix) {
  const prefix = normalize(expectedPrefix);
  const matches = [];
  headers.forEach((header, index) => {
    const h = normalize(header);
    if (h.startsWith(prefix) && h.endsWith(" value")) {
      matches.push(index);
    }
  });
  return matches;
}

const csvArg = process.argv[2];
const shouldApply = process.argv.includes("--apply");
const reportsDir = path.resolve(process.cwd(), "reports");
const defaultCsvPath = "C:\\Users\\dreye\\Downloads\\adhérents.csv";
const csvPath = path.resolve(csvArg ?? defaultCsvPath);

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!credentialPath && !credentialJson) {
  throw new Error("Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.");
}

const serviceAccount = credentialJson
  ? JSON.parse(credentialJson)
  : JSON.parse(fs.readFileSync(credentialPath, "utf8"));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV not found: ${csvPath}`);
}

const raw = fs.readFileSync(csvPath);
let text = raw.toString("utf8");
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const rows = parseCsv(text);
if (!rows.length) {
  throw new Error("CSV is empty.");
}

const headers = rows[0];
const headerNorm = headers.map((h) => normalize(h));
const idxFirstName = headerNorm.findIndex((h) => h === normalize("First Name"));
const idxLastName = headerNorm.findIndex((h) => h === normalize("Last Name"));
const idxStreet1 = headerNorm.findIndex((h) => h === normalize("Address 1 - Street"));
const idxCity1 = headerNorm.findIndex((h) => h === normalize("Address 1 - City"));
const idxPostal1 = headerNorm.findIndex((h) => h === normalize("Address 1 - Postal Code"));
const idxFormatted1 = headerNorm.findIndex((h) => h === normalize("Address 1 - Formatted"));
const idxStreet2 = headerNorm.findIndex((h) => h === normalize("Address 2 - Street"));
const idxCity2 = headerNorm.findIndex((h) => h === normalize("Address 2 - City"));
const idxPostal2 = headerNorm.findIndex((h) => h === normalize("Address 2 - Postal Code"));
const idxFormatted2 = headerNorm.findIndex((h) => h === normalize("Address 2 - Formatted"));
const emailIndexes = splitHeaderIndexes(headers, "E-mail");
const phoneIndexes = splitHeaderIndexes(headers, "Phone");

if (idxFirstName === -1 || idxLastName === -1 || !emailIndexes.length || !phoneIndexes.length) {
  throw new Error("Unsupported CSV format: missing expected Google Contacts columns.");
}

const byCandidateKey = new Map();
let skippedRowsNoIdentity = 0;
const forceExcludedNames = new Set([normalize("Ludovic LECUYER")]);

for (const row of rows.slice(1)) {
  const firstName = String(row[idxFirstName] ?? "").trim();
  const lastName = String(row[idxLastName] ?? "").trim();
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
  const normalizedFullName = normalize(fullName);

  const emails = uniqueStrings(
    emailIndexes.flatMap((index) => extractEmails(row[index])),
    (value) => value.toLowerCase(),
  );
  const phones = uniqueStrings(
    phoneIndexes.flatMap((index) => extractPhones(row[index])),
    (value) => normalizePhoneForKey(value),
  );

  const normalizedAddress = normalizeAddressParts({
    street: cleanSegment(row[idxStreet1] ?? row[idxStreet2] ?? ""),
    city: cleanSegment(row[idxCity1] ?? row[idxCity2] ?? ""),
    postalCode: cleanSegment(row[idxPostal1] ?? row[idxPostal2] ?? ""),
    formatted: cleanSegment(row[idxFormatted1] ?? row[idxFormatted2] ?? ""),
  });

  const key = normalizedFullName || emails[0] || normalizePhoneForKey(phones[0] ?? "");
  if (!key) {
    skippedRowsNoIdentity += 1;
    continue;
  }

  const existing = byCandidateKey.get(key) ?? {
    firstName,
    lastName,
    fullName,
    normalizedFullName,
    emails: [],
    phones: [],
    address: { street: "", city: "", postalCode: "" },
    sourceRows: 0,
  };

  if (!existing.firstName && firstName) existing.firstName = firstName;
  if (!existing.lastName && lastName) existing.lastName = lastName;
  if (!existing.fullName && fullName) existing.fullName = fullName;
  if (!existing.normalizedFullName && normalizedFullName) existing.normalizedFullName = normalizedFullName;

  existing.emails = uniqueStrings(
    [...existing.emails, ...emails],
    (value) => value.toLowerCase(),
  );
  existing.phones = uniqueStrings(
    [...existing.phones, ...phones],
    (value) => normalizePhoneForKey(value),
  );

  if (!existing.address.street && normalizedAddress.street) existing.address.street = normalizedAddress.street;
  if (!existing.address.city && normalizedAddress.city) existing.address.city = normalizedAddress.city;
  if (!existing.address.postalCode && normalizedAddress.postalCode) existing.address.postalCode = normalizedAddress.postalCode;
  existing.sourceRows += 1;

  byCandidateKey.set(key, existing);
}

const candidates = Array.from(byCandidateKey.values());

const membersSnap = await db.collection("members").get();
const existingMembers = membersSnap.docs.map((docSnap) => {
  const data = docSnap.data();
  const emailList = uniqueStrings(
    [
      String(data.email ?? ""),
      ...(Array.isArray(data.emails) ? data.emails.map((item) => String(item ?? "")) : []),
      ...(Array.isArray(data.accessEmails) ? data.accessEmails.map((item) => String(item ?? "")) : []),
    ],
    (value) => value.toLowerCase(),
  ).map((value) => value.toLowerCase());
  const firstName = String(data.firstName ?? "").trim();
  const lastName = String(data.lastName ?? "").trim();
  const normalizedFullName = normalize(`${firstName} ${lastName}`);
  const role = String((data.auth ?? {}).role ?? "member").toLowerCase();
  return {
    id: docSnap.id,
    role,
    normalizedFullName,
    emails: emailList,
  };
});

const existingByEmail = new Map();
const existingByName = new Map();
for (const member of existingMembers) {
  for (const email of member.emails) {
    const list = existingByEmail.get(email) ?? [];
    list.push(member);
    existingByEmail.set(email, list);
  }
  if (member.normalizedFullName) {
    const list = existingByName.get(member.normalizedFullName) ?? [];
    list.push(member);
    existingByName.set(member.normalizedFullName, list);
  }
}

const toCreate = [];
const skippedExisting = [];
const ambiguous = [];
const skippedForced = [];

for (const candidate of candidates) {
  if (forceExcludedNames.has(candidate.normalizedFullName)) {
    skippedForced.push({
      candidate,
      reason: "force_excluded_name",
    });
    continue;
  }

  const matches = new Map();
  for (const email of candidate.emails) {
    const matched = existingByEmail.get(email.toLowerCase()) ?? [];
    matched.forEach((entry) => matches.set(entry.id, entry));
  }
  if (matches.size === 0 && candidate.normalizedFullName) {
    const byName = existingByName.get(candidate.normalizedFullName) ?? [];
    byName.forEach((entry) => matches.set(entry.id, entry));
  }

  if (matches.size > 1) {
    ambiguous.push({
      candidate,
      reason: "multiple_existing_matches",
      matches: Array.from(matches.values()).map((item) => ({
        id: item.id,
        role: item.role,
        nameKey: item.normalizedFullName,
        emails: item.emails,
      })),
    });
    continue;
  }

  if (matches.size === 1) {
    const existing = Array.from(matches.values())[0];
    skippedExisting.push({
      candidate,
      existingId: existing.id,
      existingRole: existing.role,
    });
    continue;
  }

  if (!candidate.firstName || !candidate.lastName) {
    ambiguous.push({
      candidate,
      reason: "missing_name",
      matches: [],
    });
    continue;
  }

  if (!candidate.emails.length) {
    ambiguous.push({
      candidate,
      reason: "missing_email",
      matches: [],
    });
    continue;
  }

  toCreate.push(candidate);
}

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `import_adherents_report_${timestamp}.json`);
const report = {
  csvPath,
  totalRows: Math.max(rows.length - 1, 0),
  groupedCandidates: candidates.length,
  skippedRowsNoIdentity,
  toCreate: toCreate.length,
  skippedExisting: skippedExisting.length,
  skippedForced: skippedForced.length,
  ambiguous: ambiguous.length,
  ambiguousDetails: ambiguous,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(`Report: ${reportPath}`);
console.log(`Rows: ${report.totalRows}`);
console.log(`Grouped candidates: ${report.groupedCandidates}`);
console.log(`To create: ${report.toCreate}`);
console.log(`Skipped existing: ${report.skippedExisting}`);
console.log(`Skipped forced: ${report.skippedForced}`);
console.log(`Ambiguous: ${report.ambiguous}`);
console.log(`Skipped no identity rows: ${report.skippedRowsNoIdentity}`);

if (!shouldApply) {
  console.log("Dry-run only. Re-run with --apply to write to Firestore.");
  process.exit(0);
}

if (ambiguous.length > 0) {
  console.log("Apply aborted because ambiguous candidates exist. Check report and resolve first.");
  process.exit(2);
}

let created = 0;
let batch = db.batch();
let opCount = 0;
for (const candidate of toCreate) {
  const ref = db.collection("members").doc();
  const payload = {
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.emails[0],
    emails: candidate.emails,
    phone: candidate.phones[0] ?? "",
    phones: candidate.phones ?? [],
    accessEmails: candidate.emails.map((email) => email.toLowerCase()),
    address: {
      street: candidate.address.street || "",
      city: candidate.address.city || "",
      postalCode: candidate.address.postalCode || "",
    },
    membershipStatus: "active",
    membershipPaymentStatus: "to_pay",
    membershipJoinedAt: null,
    auth: {
      role: "member",
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(ref, payload, { merge: true });
  opCount += 1;
  created += 1;
  if (opCount >= 400) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }
}
if (opCount > 0) {
  await batch.commit();
}

console.log(`Created members: ${created}`);
