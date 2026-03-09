import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { cert, getApps, initializeApp as initAdmin } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const required = Object.entries(firebaseConfig).filter(([, value]) => !value);
if (required.length) {
  const keys = required.map(([key]) => key).join(", ");
  throw new Error(`Missing Firebase env vars: ${keys}`);
}

const adminCredentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const adminJson = process.env.FIREBASE_SERVICE_ACCOUNT;
let db;
let usingAdmin = false;

if (adminCredentialPath || adminJson) {
  const serviceAccount = adminJson
    ? JSON.parse(adminJson)
    : JSON.parse(fs.readFileSync(adminCredentialPath, "utf8"));
  if (!getApps().length) {
    initAdmin({ credential: cert(serviceAccount) });
  }
  db = getAdminFirestore();
  usingAdmin = true;
  console.log("Using Firebase Admin SDK.");
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log("Using Firebase client SDK (rules apply).");
}

const api = {
  async getAll(collectionName) {
    if (usingAdmin) {
      const snap = await db.collection(collectionName).get();
      return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
    }
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
  },
  async findByField(collectionName, field, value) {
    if (usingAdmin) {
      const snap = await db.collection(collectionName).where(field, "==", value).get();
      return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
    }
    const snap = await getDocs(
      query(collection(db, collectionName), where(field, "==", value)),
    );
    return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
  },
  async setDoc(collectionName, docId, data, options) {
    if (usingAdmin) {
      await db.collection(collectionName).doc(docId).set(data, options);
      return;
    }
    await setDoc(doc(db, collectionName, docId), data, options);
  },
  async addDoc(collectionName, data) {
    if (usingAdmin) {
      const ref = await db.collection(collectionName).add(data);
      return ref.id;
    }
    const ref = await addDoc(collection(db, collectionName), data);
    return ref.id;
  },
};

const DEFAULT_PRODUCERS_CSV =
  "C:\\\\Users\\\\dreye\\\\Downloads\\\\liste des producteurs et référents juin 25.xlsx - Feuil1.csv";
const DEFAULT_REFERENTS_CSV = "C:\\\\Users\\\\dreye\\\\Downloads\\\\référents coop.csv";

const producersCsvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PRODUCERS_CSV;
const referentsCsvPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : process.env.REFERENTS_CSV || DEFAULT_REFERENTS_CSV;
const adminEmail = (process.env.ADMIN_EMAIL || "dreyer.wil@gmail.com").toLowerCase();

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

function splitName(fullName) {
  const clean = String(fullName || "").replace(/\s+/g, " ").trim();
  if (!clean) return { firstName: "", lastName: "" };
  const parts = clean.split(" ");
  if (parts.length === 1) return { firstName: clean, lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

const producersRaw = fs.readFileSync(producersCsvPath, "utf8");
const producerRows = parseCsv(producersRaw);

const referentsByName = new Map();
const referentsByEmail = new Map();

if (referentsCsvPath && fs.existsSync(referentsCsvPath)) {
  const referentsRaw = fs.readFileSync(referentsCsvPath, "utf8");
  const referentRows = parseCsv(referentsRaw);
  if (referentRows.length) {
    const headers = referentRows[0].map((cell) => normalize(cell));
    const col = (label) => headers.findIndex((header) => header.includes(normalize(label)));
    const idxFirst = col("first name");
    const idxLast = col("last name");
    const idxEmail = col("e-mail 1 - value");
    const idxPhone1 = col("phone 1 - value");
    const idxPhone2 = col("phone 2 - value");
    referentRows.slice(1).forEach((row) => {
      const firstName = (row[idxFirst] || "").trim();
      const lastName = (row[idxLast] || "").trim();
      const email = (row[idxEmail] || "").trim();
      const phone = (row[idxPhone1] || row[idxPhone2] || "").trim();
      if (!firstName && !lastName && !email) return;
      const fullName = `${firstName} ${lastName}`.trim();
      if (!fullName) return;
      const key = normalize(fullName);
      const entry = referentsByName.get(key) || {
        name: fullName,
        firstName,
        lastName,
        email: "",
        phone: "",
      };
      if (!entry.firstName && firstName) entry.firstName = firstName;
      if (!entry.lastName && lastName) entry.lastName = lastName;
      if (!entry.email && email) entry.email = email;
      if (!entry.phone && phone) entry.phone = phone;
      referentsByName.set(key, entry);
      if (email) {
        referentsByEmail.set(email.toLowerCase(), entry);
      }
    });
  }
}

const rows = producerRows;
if (!rows.length) {
  throw new Error("CSV vide.");
}

const headers = rows[0].map((cell) => normalize(cell));
const exactHeaderIndex = (label) => headers.findIndex((header) => header === normalize(label));
const firstHeaderIndex = (label) => headers.findIndex((header) => header.includes(normalize(label)));

const idxReferentPhone = firstHeaderIndex("tel referents");
let idxReferentName = exactHeaderIndex("referent");
if (idxReferentName === -1) {
  idxReferentName = headers.findIndex(
    (header) => header.includes("referent") && !header.includes("tel"),
  );
}
if (idxReferentName === -1) {
  idxReferentName = firstHeaderIndex("referent");
}
const idxProducerName = firstHeaderIndex("producteur");
const idxProducerPhone = col("n");
const idxProductType = col("type");
const idxFrequency = col("frequence");
const idxNotes = col("precisions");

const producers = [];
let lastReferent = "";

rows.slice(1).forEach((row) => {
  const referentName = (row[idxReferentName] || "").trim();
  const referentPhone = (row[idxReferentPhone] || "").trim();
  const producerName = (row[idxProducerName] || "").trim();
  const producerPhone = (row[idxProducerPhone] || "").trim();
  const productType = (row[idxProductType] || "").trim();
  const frequency = (row[idxFrequency] || "").trim();
  const notes = (row[idxNotes] || "").trim();

  const resolvedReferent = referentName || lastReferent;
  if (resolvedReferent) {
    lastReferent = resolvedReferent;
    const key = normalize(resolvedReferent);
    const existing =
      referentsByName.get(key) || {
        name: resolvedReferent,
        firstName: splitName(resolvedReferent).firstName,
        lastName: splitName(resolvedReferent).lastName,
        email: "",
        phone: "",
      };
    if (!existing.phone && referentPhone) {
      existing.phone = referentPhone;
    }
    referentsByName.set(key, existing);
  }

  if (!producerName) return;

  producers.push({
    name: producerName,
    phone: producerPhone,
    productType,
    frequency,
    notes,
    referentName: resolvedReferent || "",
  });
});

const membersSnap = await api.getAll("members");
const membersByName = new Map();
const membersByEmail = new Map();
membersSnap.forEach(({ id, data }) => {
  const firstName = data.firstName || "";
  const lastName = data.lastName || "";
  const fullName = normalize(`${firstName} ${lastName}`);
  if (fullName) membersByName.set(fullName, { id, data });
  if (data.email) membersByEmail.set(String(data.email).toLowerCase(), { id, data });
});

const referentIdByName = new Map();
const emailCounts = new Map();

for (const referent of referentsByName.values()) {
  const nameKey = normalize(referent.name);
  const existingByEmail = referent.email
    ? membersByEmail.get(referent.email.toLowerCase())
    : null;
  const existing = existingByEmail || membersByName.get(nameKey);
  const firstName = referent.firstName || splitName(referent.name).firstName;
  const lastName = referent.lastName || splitName(referent.name).lastName;

  if (existing) {
    if (String(existing.data?.email || "").toLowerCase() !== adminEmail) {
      await api.setDoc(
        "members",
        existing.id,
        {
          firstName,
          lastName,
          phone: referent.phone || existing.data.phone || "",
          membershipStatus: existing.data.membershipStatus || "active",
          auth: {
            ...(existing.data.auth || {}),
            role: "referent",
          },
        },
        { merge: true },
      );
    }
    referentIdByName.set(nameKey, existing.id);
    continue;
  }

  let email = referent.email || `${slugify(referent.name)}@referent.local`;
  const count = emailCounts.get(email) || 0;
  if (count) {
    email = referent.email
      ? `${slugify(referent.name)}.${count}@referent.local`
      : `${slugify(referent.name)}.${count}@referent.local`;
  }
  emailCounts.set(`${slugify(referent.name)}@referent.local`, count + 1);

  if (email.toLowerCase() === adminEmail) {
    email = `referent.${Date.now()}@referent.local`;
  }

  const docId = await api.addDoc("members", {
    firstName,
    lastName,
    email,
    phone: referent.phone || "",
    membershipStatus: "active",
    auth: { role: "referent" },
  });
  referentIdByName.set(nameKey, docId);
}

const producerSnap = await api.getAll("producers");
const producersByName = new Map();
producerSnap.forEach(({ id, data }) => {
  const key = normalize(data.name || "");
  if (key) producersByName.set(key, { id, data });
});

let created = 0;
let updated = 0;

for (const producer of producers) {
  const key = normalize(producer.name);
  const referentKey = normalize(producer.referentName || "");
  const referentId = referentKey ? referentIdByName.get(referentKey) : null;
  const payload = {
    name: producer.name,
    phone: producer.phone || "",
    productType: producer.productType || "",
    frequency: producer.frequency || "",
    notes: producer.notes || "",
    referentName: producer.referentName || "",
    referentId: referentId || null,
    referentPhone: referentKey ? referentsByName.get(referentKey)?.phone || "" : "",
  };

  const existing = producersByName.get(key);
  if (existing) {
    await api.setDoc("producers", existing.id, payload, { merge: true });
    updated += 1;
  } else {
    await api.addDoc("producers", payload);
    created += 1;
  }
}

console.log(`Referents: ${referentsByName.size}`);
console.log(`Producers created: ${created}, updated: ${updated}`);
