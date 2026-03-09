"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { useAuth } from "@/components/auth/AuthProvider";

export default function AdminHome() {
  const { effectiveRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (effectiveRole === "referent") {
      router.replace("/admin/vente");
    }
  }, [effectiveRole, router]);

  if (effectiveRole === "referent") {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminDashboard />
    </div>
  );
}
