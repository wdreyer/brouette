"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const REFERENT_ALLOWED_PREFIXES = [
  "/admin/vente",
  "/admin/stats",
  "/admin/orders",
  "/admin/products",
  "/admin/producers",
  "/admin/members",
  "/admin/adherents",
  "/admin/membres-coop",
  "/admin/invites",
  "/admin/invite",
  "/admin/invitations",
  "/admin/messages",
  "/admin/generations-pdf",
];

function isReferentPathAllowed(pathname: string) {
  if (pathname === "/admin") return true;
  return REFERENT_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading, role, effectiveRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowReferent = isReferentPathAllowed(pathname);
  const isAllowed =
    Boolean(user) && (role === "admin" || (effectiveRole === "referent" && allowReferent));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (role === "admin") {
      return;
    }
    if (effectiveRole === "referent") {
      if (!allowReferent) {
        router.replace("/admin");
      }
      return;
    }
    router.replace("/");
  }, [loading, user, role, effectiveRole, pathname, allowReferent, router]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-6 py-16 text-sm text-ink/70">
        Chargement...
      </div>
    );
  }
  if (!isAllowed) return null;
  return <>{children}</>;
}
