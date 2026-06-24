import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = normalizeEmail(body.email);
    if (!email) {
      return NextResponse.json({ ok: false, error: "Email manquant." }, { status: 400 });
    }

    const db = getAdminDb();
    const accessSnap = await db.collection("members").where("accessEmails", "array-contains", email).limit(1).get();
    const emailSnap = accessSnap.empty
      ? await db.collection("members").where("email", "==", email).limit(1).get()
      : null;
    const docSnap = accessSnap.docs[0] ?? emailSnap?.docs[0] ?? null;

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
