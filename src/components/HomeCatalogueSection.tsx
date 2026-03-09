"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";
import CatalogueGrid from "@/components/CatalogueGrid";

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
};

export default function HomeCatalogueSection() {
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      const distItems = distSnap.docs.map(
        (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
      );
      setOpenDistribution(pickOpenDistribution(distItems));
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, []);

  if (loading || !openDistribution) {
    return null;
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
          Produits de la vente
        </p>
        <h2 className="font-serif text-3xl">Catalogue</h2>
      </div>
      <CatalogueGrid hideWhenClosed />
    </section>
  );
}
