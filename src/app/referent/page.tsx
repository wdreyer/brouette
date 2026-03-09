"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReferentPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/vente");
  }, [router]);

  return null;
}
