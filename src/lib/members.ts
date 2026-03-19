import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";

type MemberRole = "admin" | "referent" | "member";

type MemberMatch = {
  id: string;
  data: Record<string, unknown>;
  role: MemberRole;
};

type EmailMatchType = "primary" | "secondary" | "unknown";

function normalizeRole(value: unknown): MemberRole {
  if (value === "admin") return "admin";
  if (value === "referent") return "referent";
  return "member";
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function memberPrimaryEmail(data: Record<string, unknown>) {
  const main = normalizeEmail(data.email);
  if (main) return main;
  const emails = Array.isArray(data.emails)
    ? data.emails.map((item) => normalizeEmail(item)).filter(Boolean)
    : [];
  return emails[0] ?? "";
}

export function classifyMemberEmail(data: Record<string, unknown>, email: string): EmailMatchType {
  const target = normalizeEmail(email);
  if (!target) return "unknown";

  const primary = memberPrimaryEmail(data);
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

export async function findMemberByEmail(db: Firestore, email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const accessQuery = query(collection(db, "members"), where("accessEmails", "array-contains", normalized));
  const accessSnap = await getDocs(accessQuery);
  if (!accessSnap.empty) {
    const docSnap = accessSnap.docs[0];
    const data = docSnap.data() as Record<string, unknown>;
    return {
      id: docSnap.id,
      data,
      role: normalizeRole((data.auth as { role?: string } | undefined)?.role),
      emailMatch: classifyMemberEmail(data, normalized),
    };
  }

  const emailQuery = query(collection(db, "members"), where("email", "==", email));
  const emailSnap = await getDocs(emailQuery);
  if (!emailSnap.empty) {
    const docSnap = emailSnap.docs[0];
    const data = docSnap.data() as Record<string, unknown>;
    return {
      id: docSnap.id,
      data,
      role: normalizeRole((data.auth as { role?: string } | undefined)?.role),
      emailMatch: classifyMemberEmail(data, normalized),
    };
  }

  return null;
}

export async function upsertMemberAccess(
  db: Firestore,
  params: { uid: string; memberId: string; role: MemberRole; email?: string | null },
) {
  try {
    await setDoc(
      doc(db, "memberAccess", params.uid),
      {
        uid: params.uid,
        memberId: params.memberId,
        role: params.role,
        email: params.email ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    // Keep legacy flow working when memberAccess rules are not deployed yet.
  }
}

export async function findMemberByUser(db: Firestore, user: User) {
  try {
    const accessSnap = await getDoc(doc(db, "memberAccess", user.uid));
    if (accessSnap.exists()) {
      const access = accessSnap.data() as { memberId?: string; role?: string };
      const memberId = String(access.memberId ?? "");
      if (memberId) {
        const memberSnap = await getDoc(doc(db, "members", memberId));
        if (memberSnap.exists()) {
          const data = memberSnap.data() as Record<string, unknown>;
          return {
            id: memberSnap.id,
            data,
            role: normalizeRole(access.role ?? (data.auth as { role?: string } | undefined)?.role),
          } satisfies MemberMatch;
        }
      }
    }
  } catch {
    // Ignore and continue with legacy member lookup.
  }

  const uidQuery = query(collection(db, "members"), where("auth.uid", "==", user.uid));
  const uidSnap = await getDocs(uidQuery);
  if (!uidSnap.empty) {
    const docSnap = uidSnap.docs[0];
    const data = docSnap.data() as Record<string, unknown>;
    const role = normalizeRole((data.auth as { role?: string } | undefined)?.role);
    await upsertMemberAccess(db, {
      uid: user.uid,
      memberId: docSnap.id,
      role,
      email: user.email ?? null,
    });
    return { id: docSnap.id, data, role } satisfies MemberMatch;
  }

  if (user.email) {
    const emailQuery = query(collection(db, "members"), where("email", "==", user.email));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      const docSnap = emailSnap.docs[0];
      const data = docSnap.data() as Record<string, unknown>;
      const role = normalizeRole((data.auth as { role?: string } | undefined)?.role);
      await upsertMemberAccess(db, {
        uid: user.uid,
        memberId: docSnap.id,
        role,
        email: user.email ?? null,
      });
      return { id: docSnap.id, data, role } satisfies MemberMatch;
    }

    const accessQuery = query(
      collection(db, "members"),
      where("accessEmails", "array-contains", user.email.toLowerCase()),
    );
    const accessSnap = await getDocs(accessQuery);
    if (!accessSnap.empty) {
      const docSnap = accessSnap.docs[0];
      const data = docSnap.data() as Record<string, unknown>;
      const role = normalizeRole((data.auth as { role?: string } | undefined)?.role);
      await upsertMemberAccess(db, {
        uid: user.uid,
        memberId: docSnap.id,
        role,
        email: user.email ?? null,
      });
      return { id: docSnap.id, data, role } satisfies MemberMatch;
    }
  }

  return null;
}
