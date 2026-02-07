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
    <div className="rounded-2xl border border-clay/70 bg-white/90 px-5 py-4 shadow-card">
      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : openDistribution ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-moss/15 px-3 py-1 text-xs font-semibold text-moss">
              Vente ouverte
            </span>
            {openedAt ? (
              <span className="text-xs text-ink/70">
                Ouverte le{" "}
                {openedAt.toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink/70">
            {dates.map((date, index) => (
              <span
                key={index}
                className="rounded-full border border-clay/80 bg-stone px-3 py-1 font-semibold"
              >
                {date.toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                })}
                {` · J-${daysUntil(date)}`}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink/70">
          <span className="rounded-full border border-clay/80 bg-stone px-3 py-1 text-xs font-semibold text-ink/70">
            Aucune vente ouverte
          </span>
          <span>Les prochaines dates seront annoncees bientot.</span>
        </div>
      )}
    </div>
  );
}
