"use client";

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

type Order = {
  distributionId?: string | null;
  totals?: { totalAmount?: number };
  validatedAt?: { toDate?: () => Date };
};

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

type AdminDashboardProps = {
  children?: ReactNode;
  focusMode?: boolean;
};

export default function AdminDashboard({ children, focusMode = false }: AdminDashboardProps) {
  if (focusMode) {
    return <div>{children}</div>;
  }
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    members: 0,
    products: 0,
    orders: 0,
    producers: 0,
    revenueTotal: 0,
    revenueRecent: 0,
    recentDistributions: [] as { id: string; label: string; total: number }[],
  });
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);
  const [nextDistribution, setNextDistribution] = useState<Distribution | null>(null);
  const [nextDistributions, setNextDistributions] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const [membersSnap, productsSnap, ordersSnap, producersSnap, distSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "products")),
        getDocs(collection(firebaseDb, "orders")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      const distItems = distSnap.docs.map(
        (docSnap) =>
          ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
      );
      distItems.sort((a, b) => {
        const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
        const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });

      const openDist = pickOpenDistribution(distItems);
      setOpenDistribution(openDist);

      const today = new Date();
      const nextDist =
        distItems.find((dist) => {
          const firstDate = dist.dates?.[0]?.toDate?.() ?? new Date(0);
          return dist.status !== "open" && firstDate >= today;
        }) ?? null;
      setNextDistribution(nextDist);

      const upcoming = distItems
        .filter((dist) => dist.dates?.[0]?.toDate?.() && dist.dates![0]!.toDate!() > today)
        .slice(0, 3)
        .map((dist) =>
          (dist.dates ?? [])
            .slice(0, 3)
            .map((date) => date.toDate?.()?.toLocaleDateString("fr-FR"))
            .join(" · "),
        );
      setNextDistributions(upcoming);

      const orders = ordersSnap.docs.map((docSnap) => docSnap.data() as Order);
      const revenueTotal = orders.reduce((sum, order) => sum + Number(order.totals?.totalAmount ?? 0), 0);

      const totalsByDistribution = new Map<string, number>();
      orders.forEach((order) => {
        if (!order.distributionId) return;
        const current = totalsByDistribution.get(order.distributionId) ?? 0;
        totalsByDistribution.set(order.distributionId, current + Number(order.totals?.totalAmount ?? 0));
      });

      const recentDist = distItems
        .filter((dist) => dist.status === "finished" || dist.status === "closed")
        .sort((a, b) => {
          const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
          const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
          return bDate.getTime() - aDate.getTime();
        })
        .slice(0, 3)
        .map((dist) => {
          const label =
            dist.dates && dist.dates.length
              ? dist.dates
                  .slice(0, 3)
                  .map((d) => d.toDate?.()?.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))
                  .join(" · ")
              : dist.id;
          return {
            id: dist.id,
            label,
            total: totalsByDistribution.get(dist.id) ?? 0,
          };
        });

      const revenueRecent = recentDist.reduce((sum, item) => sum + item.total, 0);

      setStats({
        members: membersSnap.size,
        products: productsSnap.size,
        orders: ordersSnap.size,
        producers: producersSnap.size,
        revenueTotal,
        revenueRecent,
        recentDistributions: recentDist,
      });
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, []);

  const openDates = useMemo(() => {
    if (!openDistribution?.dates) return [];
    return openDistribution.dates.slice(0, 3).map((date) => date.toDate?.()).filter(Boolean) as Date[];
  }, [openDistribution]);

  const nextDates = useMemo(() => {
    if (!nextDistribution?.dates) return [];
    return nextDistribution.dates.slice(0, 3).map((date) => date.toDate?.()).filter(Boolean) as Date[];
  }, [nextDistribution]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Adherents", value: stats.members },
          { label: "Producteurs", value: stats.producers },
          { label: "Produits", value: stats.products },
          { label: "Commandes", value: stats.orders },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-clay/70 bg-white/90 p-5 shadow-card"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
              {card.label}
            </p>
            <p className="mt-2 font-serif text-3xl">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">Vente</p>
        {openDistribution ? (
          <>
            <p className="mt-2 text-sm text-ink/70">{distributionLabel(openDistribution)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {openDates.map((date) => (
                <span
                  key={dateKey(date)}
                  className="rounded-full border border-clay/70 bg-white px-3 py-1 text-xs font-semibold text-ink/70"
                >
                  {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink/60">Vente en cours.</p>
          </>
        ) : nextDistribution ? (
          <>
            <p className="mt-2 text-sm text-ink/70">{distributionLabel(nextDistribution)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {nextDates.map((date) => (
                <span
                  key={dateKey(date)}
                  className="rounded-full border border-clay/70 bg-white px-3 py-1 text-xs font-semibold text-ink/70"
                >
                  {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink/60">Prochaine vente a preparer.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink/70">Aucune distribution planifiee.</p>
        )}
        <a
          className="mt-4 inline-flex rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          href="/admin/vente"
        >
          {openDistribution ? "Voir la vente" : "Ouvrir la vente"}
        </a>
      </div>

      {children ? <div>{children}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
            Vente ouverte
          </p>
          {openDistribution ? (
            <div className="mt-3">
              <p className="text-sm text-ink/70">{distributionLabel(openDistribution)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {openDates.map((date) => (
                  <span
                    key={dateKey(date)}
                    className="rounded-full border border-clay/70 bg-white px-3 py-1 text-xs font-semibold text-ink/70"
                  >
                    {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink/70">Aucune vente ouverte.</p>
          )}
        </div>

        <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
            Prochaines ventes
          </p>
          {nextDistributions.length ? (
            <ul className="mt-3 space-y-2 text-sm text-ink/70">
              {nextDistributions.map((label, index) => (
                <li key={`${label}-${index}`}>{label}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink/70">Aucune distribution planifiee.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
            Chiffre d&apos;affaires
          </p>
          <p className="mt-2 font-serif text-3xl">{formatMoney(stats.revenueTotal)} EUR</p>
          <p className="mt-2 text-xs text-ink/60">Total cumule</p>
          <p className="mt-4 text-sm text-ink/70">
            Dernieres ventes: {formatMoney(stats.revenueRecent)} EUR
          </p>
          <div className="mt-3 space-y-2 text-xs text-ink/60">
            {stats.recentDistributions.map((item) => (
              <div key={item.id} className="flex items-center justify-between">
                <span>{item.label}</span>
                <span className="font-semibold text-ink">{formatMoney(item.total)} EUR</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">Apercu</p>
          <p className="mt-2 text-sm text-ink/70">
            Garde un oeil sur la prochaine vente, les produits disponibles et la charge des commandes.
          </p>
          <div className="mt-4 grid gap-2 text-xs text-ink/60">
            <span>Produits actifs: {stats.products}</span>
            <span>Adherents actifs: {stats.members}</span>
            <span>Commandes recentes: {stats.orders}</span>
          </div>
        </div>
      </div>

      {loading ? <p className="text-sm text-ink/70">Chargement des stats...</p> : null}
    </div>
  );
}
