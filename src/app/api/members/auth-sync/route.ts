import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_MEMBER_PASSWORD,
  normalizeMemberEmails,
  normalizeMemberRole,
  type MemberRole,
} from "@/lib/memberAuthSync";

export const runtime = "nodejs";

type SyncPayload = {
  action?: "sync" | "delete" | "password";
  memberId?: string;
  email?: string;
  emails?: string[];
  role?: string;
  password?: string;
};

type RequesterContext = {
  uid: string;
  memberId: string;
  email?: string | null;
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
  const memberSnap = resolvedMemberId
    ? await db.collection("members").doc(resolvedMemberId).get()
    : null;
  const memberData = memberSnap?.exists ? memberSnap.data() ?? {} : {};

  const role = normalizeMemberRole((memberData.auth as { role?: unknown } | undefined)?.role ?? accessData.role);
  return {
    uid: decoded.uid,
    memberId: resolvedMemberId,
    email: decoded.email ?? null,
    role,
  };
}

async function ensureEmailAvailable(memberId: string, email: string) {
  const db = getAdminDb();
  const auth = getAdminAuth();

  const [byEmail, byAccessEmail] = await Promise.all([
    db.collection("members").where("email", "==", email).limit(5).get(),
    db.collection("members").where("accessEmails", "array-contains", email).limit(5).get(),
  ]);

  const conflictingMember = [...byEmail.docs, ...byAccessEmail.docs].find((docSnap) => docSnap.id !== memberId);
  if (conflictingMember) {
    return "Cet email est deja utilise par un autre adherent.";
  }

  try {
    const existingUser = await auth.getUserByEmail(email);
    if (existingUser.uid !== memberId) {
      const existingMember = await db.collection("members").doc(existingUser.uid).get();
      if (existingMember.exists) {
        return "Cet email est deja utilise par un autre compte de connexion.";
      }
    }
  } catch (error) {
    if (errorCode(error) !== "auth/user-not-found") throw error;
  }

  return null;
}

async function syncMember(payload: SyncPayload) {
  const memberId = String(payload.memberId ?? "").trim();
  const emails = normalizeMemberEmails(payload.emails, payload.email);
  const email = emails[0] ?? "";
  const role = normalizeMemberRole(payload.role);

  if (!memberId || !email) {
    return NextResponse.json({ ok: false, error: "Adherent ou email manquant." }, { status: 400 });
  }

  const conflict = await ensureEmailAvailable(memberId, email);
  if (conflict) {
    return NextResponse.json({ ok: false, error: conflict }, { status: 409 });
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  const existingData = memberSnap.exists ? memberSnap.data() ?? {} : {};
  const authData = existingData.auth as { uid?: unknown; mustChangePassword?: unknown } | undefined;
  const authUid = String(authData?.uid ?? memberId).trim() || memberId;
  const now = FieldValue.serverTimestamp();
  let createdAuthUser = false;

  try {
    await auth.updateUser(authUid, {
      email,
      disabled: false,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "auth/user-not-found") {
      await auth.createUser({
        uid: authUid,
        email,
        password: DEFAULT_MEMBER_PASSWORD,
        emailVerified: false,
        disabled: false,
      });
      createdAuthUser = true;
    } else if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { ok: false, error: "Cet email est deja utilise par un autre compte de connexion." },
        { status: 409 },
      );
    } else if (code === "auth/invalid-email") {
      return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 });
    } else {
      throw error;
    }
  }

  await memberRef.set(
    {
      email,
      emails,
      accessEmails: emails,
      auth: {
        uid: authUid,
        role,
        mustChangePassword: false,
      },
      updatedAt: now,
    },
    { merge: true },
  );

  await db.collection("memberAccess").doc(authUid).set(
    {
      uid: authUid,
      memberId,
      role,
      email,
      accessEmails: emails,
      updatedAt: now,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, createdAuthUser });
}

async function setMemberPassword(payload: SyncPayload) {
  const memberId = String(payload.memberId ?? "").trim();
  const password = String(payload.password ?? "");
  const emails = normalizeMemberEmails(payload.emails, payload.email);
  const email = emails[0] ?? "";
  const role = normalizeMemberRole(payload.role);

  if (!memberId) {
    return NextResponse.json({ ok: false, error: "Adherent manquant." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Le mot de passe doit contenir au moins 6 caracteres." },
      { status: 400 },
    );
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "Email principal manquant." }, { status: 400 });
  }

  const conflict = await ensureEmailAvailable(memberId, email);
  if (conflict) {
    return NextResponse.json({ ok: false, error: conflict }, { status: 409 });
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  const existingData = memberSnap.exists ? memberSnap.data() ?? {} : {};
  const authData = existingData.auth as { uid?: unknown } | undefined;
  const authUid = String(authData?.uid ?? memberId).trim() || memberId;
  const now = FieldValue.serverTimestamp();
  let createdAuthUser = false;

  try {
    await auth.updateUser(authUid, {
      email,
      password,
      disabled: false,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "auth/user-not-found") {
      await auth.createUser({
        uid: authUid,
        email,
        password,
        emailVerified: false,
        disabled: false,
      });
      createdAuthUser = true;
    } else if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { ok: false, error: "Cet email est deja utilise par un autre compte de connexion." },
        { status: 409 },
      );
    } else if (code === "auth/invalid-email") {
      return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 });
    } else if (code === "auth/invalid-password") {
      return NextResponse.json({ ok: false, error: "Mot de passe invalide." }, { status: 400 });
    } else {
      throw error;
    }
  }

  await Promise.all([
    memberRef.set(
      {
        email,
        emails,
        accessEmails: emails,
        auth: {
          uid: authUid,
          role,
          mustChangePassword: false,
          passwordUpdatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("memberAccess").doc(authUid).set(
      {
        uid: authUid,
        memberId,
        role,
        email,
        accessEmails: emails,
        updatedAt: now,
      },
      { merge: true },
    ),
  ]);

  return NextResponse.json({ ok: true, createdAuthUser });
}

async function deleteMember(payload: SyncPayload, requester: RequesterContext) {
  const memberId = String(payload.memberId ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ ok: false, error: "Adherent manquant." }, { status: 400 });
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  const memberRef = db.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  const memberData = memberSnap.exists ? memberSnap.data() ?? {} : {};
  const authUid = String((memberData.auth as { uid?: unknown } | undefined)?.uid ?? memberId).trim() || memberId;
  const memberEmail = String(memberData.email ?? "").trim();
  const memberEmails = Array.isArray(memberData.emails)
    ? memberData.emails.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];

  try {
    await auth.deleteUser(authUid);
  } catch (error) {
    if (errorCode(error) !== "auth/user-not-found") throw error;
  }

  await db.collection("adminAuditLogs").add({
    action: "member.delete",
    requester,
    target: {
      collection: "members",
      memberId,
      authUid,
      firstName: memberData.firstName ?? null,
      lastName: memberData.lastName ?? null,
      email: memberEmail || null,
      emails: memberEmails,
      role: (memberData.auth as { role?: unknown } | undefined)?.role ?? null,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  await Promise.all([
    db.collection("memberAccess").doc(authUid).delete(),
    memberRef.delete(),
  ]);

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    const requester = await readRequesterContext(request);
    if (!requester) {
      return NextResponse.json({ ok: false, error: "Session admin invalide." }, { status: 401 });
    }

    const body = (await request.json()) as SyncPayload;
    const action = body.action === "delete" || body.action === "password" ? body.action : "sync";

    if (action === "delete") {
      if (requester.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Action reservee aux admins." }, { status: 403 });
      }
      return await deleteMember(body, requester);
    }

    if (action === "password") {
      if (requester.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Action reservee aux admins." }, { status: 403 });
      }
      return await setMemberPassword(body);
    }

    if (requester.role !== "admin" && requester.role !== "referent") {
      return NextResponse.json({ ok: false, error: "Action reservee aux admins." }, { status: 403 });
    }

    return await syncMember(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
