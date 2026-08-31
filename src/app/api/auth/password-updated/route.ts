import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

async function findMemberIdForUid(uid: string) {
  const db = getAdminDb();
  const accessSnap = await db.collection("memberAccess").doc(uid).get();
  const accessMemberId = String(accessSnap.data()?.memberId ?? "").trim();
  if (accessMemberId) return accessMemberId;

  const uidSnap = await db.collection("members").where("auth.uid", "==", uid).limit(1).get();
  if (!uidSnap.empty) return uidSnap.docs[0].id;

  const memberSnap = await db.collection("members").doc(uid).get();
  if (memberSnap.exists) return memberSnap.id;

  return "";
}

export async function POST(request: Request) {
  try {
    const token = bearerToken(request);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Session invalide." }, { status: 401 });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();
    const decoded = await auth.verifyIdToken(token);
    const memberId = await findMemberIdForUid(decoded.uid);
    if (!memberId) {
      return NextResponse.json({ ok: false, error: "Fiche adherent introuvable." }, { status: 404 });
    }

    const now = FieldValue.serverTimestamp();
    await Promise.all([
      db.collection("members").doc(memberId).set(
        {
          auth: {
            uid: decoded.uid,
            mustChangePassword: false,
            passwordUpdatedAt: now,
          },
          updatedAt: now,
        },
        { merge: true },
      ),
      db.collection("memberAccess").doc(decoded.uid).set(
        {
          uid: decoded.uid,
          memberId,
          updatedAt: now,
        },
        { merge: true },
      ),
    ]);

    return NextResponse.json({ ok: true, memberId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
