import fs from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const DEFAULT_PASSWORD = process.env.DEFAULT_MEMBER_PASSWORD || "brouette2026";

function getServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineJson) return JSON.parse(inlineJson);

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && fs.existsSync(credentialPath)) {
    return JSON.parse(fs.readFileSync(credentialPath, "utf8"));
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKeyRaw) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKeyRaw.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

function ensureAdminApp() {
  if (getApps().length) return;
  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueNonEmpty(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "admin" || role === "administrateur" || role === "administrator") return "admin";
  if (role === "referent" || role === "referent(e)" || role === "referente") return "referent";
  return "member";
}

function displayName(firstName, lastName) {
  return `${String(firstName ?? "").trim()} ${String(lastName ?? "").trim()}`.replace(/\s+/g, " ").trim();
}

async function main() {
  ensureAdminApp();
  const db = getFirestore();
  const adminAuth = getAuth();

  const membersSnap = await db.collection("members").get();
  const targets = membersSnap.docs
    .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
    .filter(({ data }) => {
      const role = normalizeRole(data?.auth?.role);
      return role === "member";
    });

  if (!targets.length) {
    console.log("Aucun adherent (role member) trouve.");
    return;
  }

  const emailOwner = new Map();
  const duplicates = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let authLinked = 0;

  console.log(`Adherents a traiter: ${targets.length}`);
  console.log(`Mot de passe utilise: ${DEFAULT_PASSWORD}`);
  console.log("");

  for (const { id, data } of targets) {
    const allEmails = uniqueNonEmpty([
      data?.email,
      ...(Array.isArray(data?.emails) ? data.emails : []),
    ]);
    const primaryEmail = normalizeEmail(allEmails[0] || "");

    if (!primaryEmail) {
      skipped += 1;
      console.log(`SKIP ${id}: aucun email.`);
      continue;
    }

    if (emailOwner.has(primaryEmail) && emailOwner.get(primaryEmail) !== id) {
      duplicates.push({ email: primaryEmail, memberA: emailOwner.get(primaryEmail), memberB: id });
      skipped += 1;
      console.log(`SKIP ${id}: email duplique (${primaryEmail}).`);
      continue;
    }
    emailOwner.set(primaryEmail, id);

    const name = displayName(data?.firstName, data?.lastName);
    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(primaryEmail);
      await adminAuth.updateUser(userRecord.uid, {
        email: primaryEmail,
        password: DEFAULT_PASSWORD,
        displayName: name || undefined,
        disabled: false,
      });
      updated += 1;
    } catch (error) {
      const code = error?.code || "";
      if (code !== "auth/user-not-found") {
        throw error;
      }
      userRecord = await adminAuth.createUser({
        email: primaryEmail,
        password: DEFAULT_PASSWORD,
        displayName: name || undefined,
        disabled: false,
      });
      created += 1;
    }

    authLinked += 1;

    const lowerEmails = uniqueNonEmpty(allEmails.map((email) => normalizeEmail(email)));
    const nextAuth = {
      ...(data?.auth || {}),
      uid: userRecord.uid,
      role: "member",
      mustChangePassword: true,
      passwordSeededAt: FieldValue.serverTimestamp(),
    };

    await db.collection("members").doc(id).set(
      {
        email: primaryEmail,
        emails: allEmails.length ? allEmails : [primaryEmail],
        accessEmails: lowerEmails.length ? lowerEmails : [primaryEmail],
        auth: nextAuth,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await db
      .collection("memberAccess")
      .doc(userRecord.uid)
      .set(
        {
          uid: userRecord.uid,
          memberId: id,
          role: "member",
          email: primaryEmail,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    console.log(`OK MEMBER ${id} -> ${primaryEmail}`);
  }

  console.log("");
  console.log("Resume:");
  console.log(`- Crees: ${created}`);
  console.log(`- MAJ mot de passe: ${updated}`);
  console.log(`- Liens auth/member: ${authLinked}`);
  console.log(`- Ignores: ${skipped}`);
  if (duplicates.length) {
    console.log("- Doublons email detectes:");
    duplicates.forEach((entry) => {
      console.log(`  ${entry.email} => ${entry.memberA} / ${entry.memberB}`);
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erreur: ${message}`);
  process.exit(1);
});
