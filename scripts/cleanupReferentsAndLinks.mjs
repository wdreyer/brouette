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
const adminEmail = (process.env.ADMIN_EMAIL || "dreyer.wil@gmail.com").toLowerCase();
const DEFAULT_REFERENTS_CSV = "C:\\\\Users\\\\dreye\\\\Downloads\\\\référents coop (1).csv";
const referentsCsvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_REFERENTS_CSV;

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

function slugify(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function hasDigits(value) {
  return /\d/.test(String(value || ""));
}

const raw = fs.readFileSync(referentsCsvPath, "utf8");
const rows = parseCsv(raw);
if (!rows.length) throw new Error("CSV vide.");

const headers = rows[0].map((cell) => normalize(cell));
const col = (label) => headers.findIndex((header) => header.includes(normalize(label)));
const idxFirst = col("first name");
const idxLast = col("last name");
const idxEmail = col("e-mail 1 - value");
const idxPhone1 = col("phone 1 - value");
const idxPhone2 = col("phone 2 - value");

const canonicalByEmail = new Map();
const canonicalByName = new Map();

rows.slice(1).forEach((row) => {
  const firstName = (row[idxFirst] || "").trim();
  const lastName = (row[idxLast] || "").trim();
  const email = (row[idxEmail] || "").trim().toLowerCase();
  const phone = (row[idxPhone1] || row[idxPhone2] || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) return;
  const record = {
    firstName,
    lastName,
    email,
    phone,
    nameKey: normalize(fullName),
  };
  if (email) canonicalByEmail.set(email, record);
  canonicalByName.set(record.nameKey, record);
});

const referentSnap = await db.collection("members").where("auth.role", "==", "referent").get();
const referents = referentSnap.docs.map((docSnap) => ({
  id: docSnap.id,
  data: docSnap.data(),
}));

const membersByEmail = new Map();
const membersByName = new Map();
referents.forEach((entry) => {
  const data = entry.data;
  const email = String(data.email || "").toLowerCase();
  const nameKey = normalize(`${data.firstName || ""} ${data.lastName || ""}`);
  if (email) {
    const list = membersByEmail.get(email) || [];
    list.push(entry);
    membersByEmail.set(email, list);
  }
  if (nameKey.trim()) {
    const list = membersByName.get(nameKey) || [];
    list.push(entry);
    membersByName.set(nameKey, list);
  }
});

const keptIds = new Set();
const idMap = new Map(); // oldId -> keptId
let created = 0;
let updated = 0;

function pickPrimary(list, canonical) {
  if (!list.length) return null;
  const nameKey = canonical ? canonical.nameKey : "";
  const exact = nameKey ? list.find((entry) => normalize(`${entry.data.firstName || ""} ${entry.data.lastName || ""}`) === nameKey) : null;
  if (exact) return exact;
  const clean = list.find((entry) => !hasDigits(entry.data.firstName) && !hasDigits(entry.data.lastName));
  return clean || list[0];
}

for (const canonical of canonicalByEmail.values()) {
  const email = canonical.email;
  const candidates = membersByEmail.get(email) || [];
  if (candidates.length) {
    const primary = pickPrimary(candidates, canonical);
    if (primary) {
      await db.collection("members").doc(primary.id).set(
        {
          firstName: canonical.firstName,
          lastName: canonical.lastName,
          email,
          phone: canonical.phone || primary.data.phone || "",
          membershipStatus: primary.data.membershipStatus || "active",
          auth: { ...(primary.data.auth || {}), role: "referent" },
        },
        { merge: true },
      );
      keptIds.add(primary.id);
      updated += 1;
      candidates.forEach((entry) => {
        if (entry.id !== primary.id) {
          idMap.set(entry.id, primary.id);
        }
      });
    }
  } else {
    const docRef = await db.collection("members").add({
      firstName: canonical.firstName,
      lastName: canonical.lastName,
      email,
      phone: canonical.phone || "",
      membershipStatus: "active",
      auth: { role: "referent" },
    });
    keptIds.add(docRef.id);
    created += 1;
  }
}

for (const [nameKey, canonical] of canonicalByName.entries()) {
  if (canonical.email && canonicalByEmail.has(canonical.email)) continue;
  const candidates = membersByName.get(nameKey) || [];
  if (candidates.length) {
    const primary = pickPrimary(candidates, canonical);
    if (primary) {
      await db.collection("members").doc(primary.id).set(
        {
          firstName: canonical.firstName,
          lastName: canonical.lastName,
          email: canonical.email || primary.data.email || `${slugify(`${canonical.firstName} ${canonical.lastName}`)}@referent.local`,
          phone: canonical.phone || primary.data.phone || "",
          membershipStatus: primary.data.membershipStatus || "active",
          auth: { ...(primary.data.auth || {}), role: "referent" },
        },
        { merge: true },
      );
      keptIds.add(primary.id);
      updated += 1;
      candidates.forEach((entry) => {
        if (entry.id !== primary.id) {
          idMap.set(entry.id, primary.id);
        }
      });
    }
  } else {
    const docRef = await db.collection("members").add({
      firstName: canonical.firstName,
      lastName: canonical.lastName,
      email: canonical.email || `${slugify(`${canonical.firstName} ${canonical.lastName}`)}@referent.local`,
      phone: canonical.phone || "",
      membershipStatus: "active",
      auth: { role: "referent" },
    });
    keptIds.add(docRef.id);
    created += 1;
  }
}

let deleted = 0;
for (const entry of referents) {
  const data = entry.data;
  const email = String(data.email || "").toLowerCase();
  if (email === adminEmail) continue;
  if (keptIds.has(entry.id)) continue;
  const nameKey = normalize(`${data.firstName || ""} ${data.lastName || ""}`);
  if (hasDigits(data.firstName) || hasDigits(data.lastName)) {
    await db.collection("members").doc(entry.id).delete();
    deleted += 1;
    continue;
  }
  if (email && !canonicalByEmail.has(email) && !canonicalByName.has(nameKey)) {
    await db.collection("members").doc(entry.id).delete();
    deleted += 1;
    continue;
  }
  if (!email && !canonicalByName.has(nameKey)) {
    await db.collection("members").doc(entry.id).delete();
    deleted += 1;
  }
}

const freshReferentSnap = await db.collection("members").where("auth.role", "==", "referent").get();
const referentById = new Map();
freshReferentSnap.docs.forEach((docSnap) => {
  referentById.set(docSnap.id, { id: docSnap.id, data: docSnap.data() });
});
const referentByName = new Map();
freshReferentSnap.docs.forEach((docSnap) => {
  const data = docSnap.data();
  const nameKey = normalize(`${data.firstName || ""} ${data.lastName || ""}`);
  if (nameKey) referentByName.set(nameKey, { id: docSnap.id, data });
});

const producersSnap = await db.collection("producers").get();
let producersUpdated = 0;
const unmatched = [];

for (const docSnap of producersSnap.docs) {
  const data = docSnap.data();
  let referentId = data.referentId || null;
  if (referentId && idMap.has(referentId)) {
    referentId = idMap.get(referentId);
  }
  if (!referentId && data.referentName) {
    const nameKey = normalize(data.referentName);
    const ref = referentByName.get(nameKey);
    if (ref) {
      referentId = ref.id;
    }
  }

  let referentName = data.referentName || null;
  let referentPhone = data.referentPhone || null;
  if (referentId) {
    const ref = referentById.get(referentId);
    if (ref) {
      const refName = `${ref.data.firstName || ""} ${ref.data.lastName || ""}`.trim();
      referentName = refName || referentName;
      referentPhone = ref.data.phone || referentPhone || null;
    }
  } else {
    if (referentName && hasDigits(referentName)) {
      referentName = null;
    }
    unmatched.push({ producer: data.name, referentName: data.referentName || "" });
  }

  await docSnap.ref.set(
    {
      referentId: referentId || null,
      referentName: referentName || null,
      referentPhone: referentPhone || null,
    },
    { merge: true },
  );
  producersUpdated += 1;
}

console.log(`Referents created: ${created}, updated: ${updated}, deleted: ${deleted}`);
console.log(`Producers updated: ${producersUpdated}`);
if (unmatched.length) {
  console.log("Unmatched producers (first 10):");
  console.log(unmatched.slice(0, 10));
}
