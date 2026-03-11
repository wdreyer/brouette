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

function normalizeRole(value: unknown): MemberRole {
  if (value === "admin") return "admin";
  if (value === "referent") return "referent";
  return "member";
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
