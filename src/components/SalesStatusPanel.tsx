"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate: () => Date }[];
  openedAt?: { toDate: () => Date };
};

function daysUntil(date: Date) {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function SalesStatusPanel() {
  const [loading, setLoading] = useState(true);
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);

  useEffect(() => {
    const load = async () => {
      const snapshot = await getDocs(collection(firebaseDb, "distributionDates"));
      const items = snapshot.docs.map(
        (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
      );
      setOpenDistribution(pickOpenDistribution(items));
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, []);

  const dates = useMemo(
    () => (openDistribution?.dates ?? []).map((d) => d.toDate()),
    [openDistribution],
  );
  const openedAt = openDistribution?.openedAt?.toDate?.();

  return (
    <div className="rounded-[26px] border border-clay/70 bg-white/95 px-6 py-5 shadow-card">
      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : openDistribution ? (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-moss px-4 py-1.5 text-xs font-semibold text-white shadow-sm">
              Vente ouverte
            </span>
            {openedAt ? (
              <span className="text-sm text-ink/72">
                Ouverte le{" "}
                {openedAt.toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink/80">
            {dates.map((date, index) => (
              <button
                key={index}
                className="rounded-full border border-clay/70 bg-stone px-3 py-1.5 font-semibold transition hover:border-ink/40 hover:bg-ink hover:text-stone"
                type="button"
              >
                {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                {` · J-${daysUntil(date)}`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink/72">
          <span className="rounded-full border border-ember/30 bg-ember/10 px-3 py-1 text-xs font-semibold text-ember">
            Vente fermee
          </span>
          <span>Aucune vente ouverte pour le moment.</span>
        </div>
      )}
    </div>
  );
}
