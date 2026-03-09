"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel, pickOpenDistribution } from "@/lib/distributions";

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
};

type AdminDashboardProps = {
  children?: ReactNode;
  focusMode?: boolean;
};

type SaleSummary = {
  activeProducerCount: number;
  validatedProducerCount: number;
  pendingProducerCount: number;
  totalProducerRows: number;
};

function daysUntil(date?: Date | null) {
  if (!date) return null;
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function isPlannedStatus(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized !== "open" && normalized !== "finished" && normalized !== "fermee";
}

function statusLabel(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "open") return "Ouverte";
  if (normalized === "finished" || normalized === "fermee") return "Fermee";
  return "Planifiee";
}

export default function AdminDashboard({ children, focusMode = false }: AdminDashboardProps) {
  if (focusMode) return <div>{children}</div>;

  const [loading, setLoading] = useState(true);
  const [entityStats, setEntityStats] = useState({
    members: 0,
    producers: 0,
    products: 0,
    orders: 0,
  });
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);
  const [nextDistribution, setNextDistribution] = useState<Distribution | null>(null);
  const [saleSummary, setSaleSummary] = useState<SaleSummary>({
    activeProducerCount: 0,
    validatedProducerCount: 0,
    pendingProducerCount: 0,
    totalProducerRows: 0,
  });

  useEffect(() => {
    const load = async () => {
      const [membersSnap, producersSnap, productsSnap, ordersSnap, distSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "products")),
        getDocs(collection(firebaseDb, "orders")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      setEntityStats({
        members: membersSnap.size,
        producers: producersSnap.size,
        products: productsSnap.size,
        orders: ordersSnap.size,
      });

      const distributions = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Distribution, "id">),
      })) as Distribution[];
      distributions.sort((a, b) => {
        const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
        const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });

      const open = pickOpenDistribution(distributions);
      setOpenDistribution(open);

      const planned =
        distributions.find((dist) => {
          const firstDate = dist.dates?.[0]?.toDate?.() ?? new Date(0);
          return isPlannedStatus(dist.status) && firstDate >= new Date();
        }) ?? null;
      const firstFutureAnyStatus =
        distributions.find((dist) => {
          const firstDate = dist.dates?.[0]?.toDate?.() ?? new Date(0);
          return firstDate >= new Date();
        }) ?? null;
      const latestByDate = distributions[distributions.length - 1] ?? null;
      const fallbackDistribution = planned ?? firstFutureAnyStatus ?? latestByDate;
      setNextDistribution(fallbackDistribution);

      const targetDistribution = open ?? fallbackDistribution;
      if (!targetDistribution) {
        setSaleSummary({
          activeProducerCount: 0,
          validatedProducerCount: 0,
          pendingProducerCount: 0,
          totalProducerRows: 0,
        });
        setLoading(false);
        return;
      }

      const producerRowsSnap = await getDocs(
        collection(firebaseDb, "distributionDates", targetDistribution.id, "producers"),
      );
      const rows = producerRowsSnap.docs.map((docSnap) => {
        const data = docSnap.data() as { active?: boolean; validatedByReferent?: boolean };
        return {
          active: data.active !== false,
          validatedByReferent: data.validatedByReferent === true,
        };
      });

      const activeProducerCount = rows.filter((row) => row.active).length;
      const validatedProducerCount = rows.filter(
        (row) => row.active && row.validatedByReferent,
      ).length;

      setSaleSummary({
        activeProducerCount,
        validatedProducerCount,
        pendingProducerCount: Math.max(activeProducerCount - validatedProducerCount, 0),
        totalProducerRows: rows.length,
      });
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, []);

  const activeDistribution = openDistribution ?? nextDistribution;
  const saleDates = useMemo(
    () => (activeDistribution?.dates ?? []).slice(0, 3).map((d) => d.toDate?.()).filter(Boolean) as Date[],
    [activeDistribution],
  );
  const nextDate = saleDates[0] ?? null;
  const daysBefore = daysUntil(nextDate);

  const miniCards = [
    { label: "Adherents", value: entityStats.members },
    { label: "Producteurs", value: entityStats.producers },
    { label: "Produits", value: entityStats.products },
    { label: "Commandes", value: entityStats.orders },
  ];

  const summaryCards = [
    { label: "Producteurs a valider", value: saleSummary.pendingProducerCount },
    { label: "Producteurs valides", value: saleSummary.validatedProducerCount },
    { label: "Producteurs actifs", value: saleSummary.activeProducerCount },
    { label: "Total producteurs (vente)", value: saleSummary.totalProducerRows },
    { label: "Jours avant prochaine date", value: daysBefore ?? "-" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {miniCards.map((card) => (
          <article key={card.label} className="rounded-[10px] border border-clay/90 bg-stone p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">{card.label}</p>
            <p className="mt-2 font-serif text-4xl leading-none text-ink">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Resume vente
            </p>
            <h2 className="mt-1 font-serif text-3xl">
              {openDistribution ? "Vente ouverte" : "Aucune vente ouverte"}
            </h2>
            <p className="mt-2 text-sm text-ink/75">
              {activeDistribution
                ? `${distributionLabel(activeDistribution)} - ${statusLabel(activeDistribution.status)}`
                : "Aucune distribution planifiee."}
            </p>
          </div>
          <Link
            href="/admin/vente"
            className="rounded bg-forest px-4 py-2 text-sm font-semibold text-white"
          >
            Gerer la vente
          </Link>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(saleDates.length ? saleDates : [null, null, null]).map((date, index) => (
            <div key={date ? date.toISOString() : `date-${index}`} className="rounded-md border border-clay/70 bg-stone px-3 py-2 text-sm text-ink/80">
              {date
                ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
                : `Date ${index + 1} non definie`}
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-clay/70 pt-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {summaryCards.map((card) => (
              <article key={card.label} className="rounded-[10px] border border-clay/90 bg-stone p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/60">{card.label}</p>
                <p className="mt-1 text-xl font-semibold text-ink">{card.value}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {children ? <div>{children}</div> : null}
      {loading ? <p className="text-sm text-ink/70">Chargement du resume...</p> : null}
    </div>
  );
}
