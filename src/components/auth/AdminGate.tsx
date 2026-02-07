"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) {
      router.replace("/");
    }
  }, [loading, user, role, router]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-6 py-16 text-sm text-ink/70">
        Chargement...
      </div>
    );
  }
  if (!user || role !== "admin") return null;
  return <>{children}</>;
}
