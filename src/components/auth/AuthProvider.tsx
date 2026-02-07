"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { setCartUser } from "@/lib/cart";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  role: "admin" | "member" | null;
  memberId: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  role: null,
  memberId: null,
});

async function findMemberByUser(user: User) {
  const uidQuery = query(collection(firebaseDb, "members"), where("auth.uid", "==", user.uid));
  const uidSnap = await getDocs(uidQuery);
  if (!uidSnap.empty) {
    const docSnap = uidSnap.docs[0];
    return { id: docSnap.id, data: docSnap.data() };
  }
  if (user.email) {
    const emailQuery = query(collection(firebaseDb, "members"), where("email", "==", user.email));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      const docSnap = emailSnap.docs[0];
      return { id: docSnap.id, data: docSnap.data() };
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setRole(null);
      setMemberId(null);
      setCartUser(nextUser?.uid ?? null);
      if (!nextUser) {
        setLoading(false);
        return;
      }
      try {
        const member = await findMemberByUser(nextUser);
        if (member) {
          setMemberId(member.id);
          const auth = member.data?.auth as { role?: string } | undefined;
          setRole(auth?.role === "admin" ? "admin" : "member");
        } else {
          setRole("member");
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const value = useMemo(() => ({ user, loading, role, memberId }), [user, loading, role, memberId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
