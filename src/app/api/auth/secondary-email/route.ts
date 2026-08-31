import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function primaryEmailFromMember(data: FirebaseFirestore.DocumentData) {
  const direct = String(data.email ?? "").trim();
  if (direct) return direct;
  const emails = Array.isArray(data.emails)
    ? data.emails.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return emails[0] ?? "";
}

function classifyMemberEmail(data: FirebaseFirestore.DocumentData, email: string) {
  const target = normalizeEmail(email);
  const primary = normalizeEmail(primaryEmailFromMember(data));
  if (primary && primary === target) return "primary";

  const emails = Array.isArray(data.emails)
    ? data.emails.map((item) => normalizeEmail(item)).filter(Boolean)
    : [];
  if (emails.includes(target)) return "secondary";

  const accessEmails = Array.isArray(data.accessEmails)
    ? data.accessEmails.map((item) => normalizeEmail(item)).filter(Boolean)
    : [];
  if (accessEmails.includes(target)) return "secondary";

  return "unknown";
}

function normalizedEmailList(data: FirebaseFirestore.DocumentData, primaryEmail: string) {
  const values = Array.isArray(data.emails)
    ? data.emails.map((item) => normalizeEmail(item)).filter(Boolean)
    : [];
  const out: string[] = [];
  const seen = new Set<string>();

  [primaryEmail, ...values].forEach((value) => {
    const normalized = normalizeEmail(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });

  return out;
}

async function findMemberLinkedToAuthEmail(email: string) {
  const auth = getAdminAuth();
  const db = getAdminDb();

  try {
    const authUser = await auth.getUserByEmail(email);
    const accessSnap = await db.collection("memberAccess").doc(authUser.uid).get();
    const memberId = String(accessSnap.data()?.memberId ?? "").trim();
    if (memberId) {
      const memberSnap = await db.collection("members").doc(memberId).get();
      if (memberSnap.exists) return { authUid: authUser.uid, docSnap: memberSnap };
    }

    const uidSnap = await db.collection("members").where("auth.uid", "==", authUser.uid).limit(1).get();
    if (!uidSnap.empty) return { authUid: authUser.uid, docSnap: uidSnap.docs[0] };

    const directMemberSnap = await db.collection("members").doc(authUser.uid).get();
    if (directMemberSnap.exists) return { authUid: authUser.uid, docSnap: directMemberSnap };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
    if (code !== "auth/user-not-found") throw error;
  }

  return null;
}

async function repairPrimaryEmailFromAuth(params: {
  authUid: string;
  memberId: string;
  data: FirebaseFirestore.DocumentData;
  email: string;
}) {
  const db = getAdminDb();
  const role = String((params.data.auth as { role?: unknown } | undefined)?.role ?? "member").trim() || "member";
  const emails = normalizedEmailList(params.data, params.email);
  const now = FieldValue.serverTimestamp();

  await Promise.all([
    db.collection("members").doc(params.memberId).set(
      {
        email: params.email,
        emails,
        accessEmails: emails,
        auth: { uid: params.authUid },
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("memberAccess").doc(params.authUid).set(
      {
        uid: params.authUid,
        memberId: params.memberId,
        role,
        email: params.email,
        accessEmails: emails,
        updatedAt: now,
      },
      { merge: true },
    ),
  ]);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = normalizeEmail(body.email);
    if (!email) {
      return NextResponse.json({ ok: false, error: "Email manquant." }, { status: 400 });
    }

    const db = getAdminDb();
    const authLinkedMember = await findMemberLinkedToAuthEmail(email);
    const accessSnap = await db.collection("members").where("accessEmails", "array-contains", email).limit(1).get();
    const emailSnap = accessSnap.empty
      ? await db.collection("members").where("email", "==", email).limit(1).get()
      : null;
    const docSnap = accessSnap.docs[0] ?? emailSnap?.docs[0] ?? null;

    if (authLinkedMember && (!docSnap || docSnap.id === authLinkedMember.docSnap.id)) {
      await repairPrimaryEmailFromAuth({
        authUid: authLinkedMember.authUid,
        memberId: authLinkedMember.docSnap.id,
        data: authLinkedMember.docSnap.data() ?? {},
        email,
      });
      return NextResponse.json({ ok: true, emailMatch: "primary", primaryEmail: "" });
    }

    if (!docSnap) {
      return NextResponse.json({ ok: true, emailMatch: "unknown", primaryEmail: "" });
    }

    const data = docSnap.data();
    const emailMatch = classifyMemberEmail(data, email);
    return NextResponse.json({
      ok: true,
      emailMatch,
      primaryEmail: emailMatch === "secondary" ? primaryEmailFromMember(data) : "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
