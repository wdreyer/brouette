"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { setCartUser } from "@/lib/cart";
import { classifyMemberEmail, findMemberByUser } from "@/lib/members";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  role: "admin" | "member" | "referent" | null;
  memberId: string | null;
  effectiveRole: "admin" | "member" | "referent" | null;
  effectiveMemberId: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  role: null,
  memberId: null,
  effectiveRole: null,
  effectiveMemberId: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"admin" | "member" | "referent" | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setRole(null);
      setMemberId(null);
      if (!nextUser) {
        setCartUser(null);
        setLoading(false);
        return;
      }
      try {
        const member = await findMemberByUser(firebaseDb, nextUser);
        if (member) {
          const emailMatch = classifyMemberEmail(member.data, String(nextUser.email ?? ""));
          if (emailMatch === "secondary") {
            setCartUser(null);
            await signOut(firebaseAuth);
            setRole(null);
            setMemberId(null);
            setLoading(false);
            return;
          }
          setMemberId(member.id);
          setCartUser(member.id);
          if (member.role === "admin") {
            setRole("admin");
          } else if (member.role === "referent") {
            setRole("referent");
          } else {
            setRole("member");
          }
        } else {
          setCartUser(nextUser.uid);
          setRole("member");
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const effectiveRole = role;
  const effectiveMemberId = memberId;

  const value = useMemo(
    () => ({
      user,
      loading,
      role,
      memberId,
      effectiveRole,
      effectiveMemberId,
    }),
    [user, loading, role, memberId, effectiveRole, effectiveMemberId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
