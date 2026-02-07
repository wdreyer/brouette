"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const PUBLIC_PREFIXES = ["/auth"];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace("/auth");
    }
  }, [loading, user, isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-6 py-16 text-sm text-ink/70">
        Chargement...
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
