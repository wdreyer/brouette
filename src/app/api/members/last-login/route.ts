import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { normalizeMemberRole, type MemberRole } from "@/lib/memberAuthSync";

export const runtime = "nodejs";

type RequesterContext = {
  uid: string;
  memberId: string;
  role: MemberRole;
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: string }).code ?? "")
    : "";
}

async function readRequesterContext(request: Request): Promise<RequesterContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const auth = getAdminAuth();
  const db = getAdminDb();
  const decoded = await auth.verifyIdToken(match[1]);
  const accessSnap = await db.collection("memberAccess").doc(decoded.uid).get();
  const accessData = accessSnap.exists ? accessSnap.data() ?? {} : {};
  const resolvedMemberId = String(accessData.memberId ?? decoded.uid).trim();
  const memberSnap = resolvedMemberId ? await db.collection("members").doc(resolvedMemberId).get() : null;
  const memberData = memberSnap?.exists ? memberSnap.data() ?? {} : {};

  return {
    uid: decoded.uid,
    memberId: resolvedMemberId,
    role: normalizeMemberRole((memberData.auth as { role?: unknown } | undefined)?.role ?? accessData.role),
  };
}

function toIsoDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function GET(request: Request) {
  try {
    const requester = await readRequesterContext(request);
    if (!requester) {
      return NextResponse.json({ ok: false, error: "Session admin invalide." }, { status: 401 });
    }
    if (requester.role !== "admin" && requester.role !== "referent") {
      return NextResponse.json({ ok: false, error: "Action reservee aux admins." }, { status: 403 });
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const membersSnap = await db.collection("members").get();

    const entries = await Promise.all(
      membersSnap.docs.map(async (docSnap) => {
        const data = docSnap.data() ?? {};
        const authUid = String((data.auth as { uid?: unknown } | undefined)?.uid ?? docSnap.id).trim();
        const email = String(data.email ?? "").trim();

        if (!authUid && !email) {
          return [
            docSnap.id,
            {
              authUid: null,
              lastLoginAt: null,
            },
          ] as const;
        }

        try {
          const user = authUid ? await auth.getUser(authUid) : await auth.getUserByEmail(email);
          return [
            docSnap.id,
            {
              authUid: user.uid,
              lastLoginAt: toIsoDate(user.metadata.lastSignInTime),
            },
          ] as const;
        } catch (error) {
          if (errorCode(error) !== "auth/user-not-found" || !email) throw error;
          try {
            const user = await auth.getUserByEmail(email);
            return [
              docSnap.id,
              {
                authUid: user.uid,
                lastLoginAt: toIsoDate(user.metadata.lastSignInTime),
              },
            ] as const;
          } catch (emailError) {
            if (errorCode(emailError) !== "auth/user-not-found") throw emailError;
            return [
              docSnap.id,
              {
                authUid: authUid || null,
                lastLoginAt: null,
              },
            ] as const;
          }
        }
      }),
    );

    return NextResponse.json({ ok: true, lastLoginByMemberId: Object.fromEntries(entries) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
