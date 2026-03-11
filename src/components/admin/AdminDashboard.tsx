"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
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

type MemberProfile = {
  firstName?: string;
  lastName?: string;
};

type ProducerProfile = {
  name?: string;
};

type DistributionProducerRow = {
  producerId: string;
  referentId?: string | null;
  active?: boolean;
  validatedByReferent?: boolean;
};

type TrendPoint = {
  key: string;
  label: string;
  orders: number;
  orderingMembers: number;
  revenue: number;
};

type OrderDoc = {
  id: string;
  memberId?: string;
};

type OrderItemDoc = {
  saleDateKey?: string | null;
  lineTotal?: number;
  unitPrice?: number;
  quantity?: number;
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

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    const fn = (value as { toDate?: () => Date }).toDate;
    return typeof fn === "function" ? fn() : null;
  }
  return null;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function MetricBars({
  title,
  series,
  valueKey,
  totalValue,
}: {
  title: string;
  series: TrendPoint[];
  valueKey: "orders" | "orderingMembers" | "revenue";
  totalValue?: number;
}) {
  const values = series.map((point) => point[valueKey]);
  const maxValue = Math.max(...values, 1);
  const currentValue =
    typeof totalValue === "number" ? totalValue : values.reduce((sum, value) => sum + Number(value), 0);
  const displayValue =
    valueKey === "revenue"
      ? `${Number(currentValue).toFixed(2).replace(".", ",")} EUR`
      : String(currentValue);

  return (
    <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{displayValue}</p>
      <div className="mt-3 flex h-24 items-end gap-2">
        {series.map((point) => {
          const value = point[valueKey];
          const heightPx = value > 0 ? Math.max(10, Math.round((Number(value) / maxValue) * 84)) : 4;
          const pointValue =
            valueKey === "revenue"
              ? `${Number(value).toFixed(0)} €`
              : String(value);
          return (
            <div
              key={`${valueKey}-${point.key}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[10px] font-semibold text-ink/70">{pointValue}</span>
              <div
                className={`w-full rounded-sm ${value > 0 ? "bg-forest/65" : "bg-forest/20"}`}
                style={{ height: `${heightPx}px` }}
                title={`${point.label}: ${
                  valueKey === "revenue"
                    ? `${Number(value).toFixed(2).replace(".", ",")} EUR`
                    : value
                }`}
              />
              <span className="text-[10px] text-ink/55">{point.label}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function AdminDashboard({ children, focusMode = false }: AdminDashboardProps) {
  if (focusMode) return <div>{children}</div>;
  const { effectiveMemberId, effectiveRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<MemberProfile | null>(null);
  const [producerMap, setProducerMap] = useState<Record<string, ProducerProfile>>({});
  const [distributionProducerRows, setDistributionProducerRows] = useState<DistributionProducerRow[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
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
  const [trendTotals, setTrendTotals] = useState({
    orders: 0,
    orderingMembers: 0,
    revenue: 0,
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
      const nextProducerMap: Record<string, ProducerProfile> = {};
      producersSnap.docs.forEach((docSnap) => {
        nextProducerMap[docSnap.id] = docSnap.data() as ProducerProfile;
      });
      setProducerMap(nextProducerMap);
      if (effectiveMemberId) {
        const currentMemberDoc = membersSnap.docs.find((docSnap) => docSnap.id === effectiveMemberId);
        if (currentMemberDoc) {
          setViewer(currentMemberDoc.data() as MemberProfile);
        } else {
          setViewer(null);
        }
      } else {
        setViewer(null);
      }

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
        setDistributionProducerRows([]);
        setSaleSummary({
          activeProducerCount: 0,
          validatedProducerCount: 0,
          pendingProducerCount: 0,
          totalProducerRows: 0,
        });
        setTrendTotals({ orders: 0, orderingMembers: 0, revenue: 0 });
        setLoading(false);
        return;
      }

      const producerRowsSnap = await getDocs(
        collection(firebaseDb, "distributionDates", targetDistribution.id, "producers"),
      );
      const rows = producerRowsSnap.docs.map((docSnap) => {
        const data = docSnap.data() as DistributionProducerRow;
        return {
          producerId: String(data.producerId ?? docSnap.id),
          referentId: data.referentId ?? null,
          active: data.active !== false,
          validatedByReferent: data.validatedByReferent === true,
        } satisfies DistributionProducerRow;
      });
      setDistributionProducerRows(rows);

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

      const recentDistributions = [...distributions]
        .sort((a, b) => {
          const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
          const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
          return aDate.getTime() - bDate.getTime();
        })
        .slice(-9);

      const orders = ordersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<OrderDoc, "id">),
      })) as OrderDoc[];

      const orderItemsByOrder = new Map<string, OrderItemDoc[]>();
      await Promise.all(
        orders.map(async (order) => {
          const itemsSnap = await getDocs(collection(firebaseDb, "orders", order.id, "items"));
          orderItemsByOrder.set(
            order.id,
            itemsSnap.docs.map((docSnap) => docSnap.data() as OrderItemDoc),
          );
        }),
      );

      const totalsBySaleDate = new Map<string, { revenue: number }>();
      const membersBySaleDate = new Map<string, Set<string>>();
      orders.forEach((order) => {
        const items = orderItemsByOrder.get(order.id) ?? [];
        const revenueByDate = new Map<string, number>();
        items.forEach((item) => {
          const key = String(item.saleDateKey ?? "");
          if (!key) return;
          const lineTotal =
            Number(item.lineTotal ?? 0) ||
            Number(item.unitPrice ?? 0) * Number(item.quantity ?? 0);
          revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + lineTotal);
        });
        const memberKey = order.memberId ? String(order.memberId) : `order:${order.id}`;
        revenueByDate.forEach((_, key) => {
          const membersSet = membersBySaleDate.get(key) ?? new Set<string>();
          membersSet.add(memberKey);
          membersBySaleDate.set(key, membersSet);
        });
        revenueByDate.forEach((revenue, key) => {
          const current = totalsBySaleDate.get(key) ?? { revenue: 0 };
          current.revenue += revenue;
          totalsBySaleDate.set(key, current);
        });
      });

      const trendPoints: TrendPoint[] = [];
      recentDistributions.forEach((distribution) => {
        const dates = (distribution.dates ?? []).slice(0, 3).map((entry) => entry.toDate?.()).filter(Boolean) as Date[];
        dates.forEach((date, index) => {
          const key = dateKey(date);
          const totals = totalsBySaleDate.get(key);
          trendPoints.push({
            key: `${distribution.id}-${key}-${index}`,
            label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
            orders: membersBySaleDate.get(key)?.size ?? 0,
            orderingMembers: membersBySaleDate.get(key)?.size ?? 0,
            revenue: totals?.revenue ?? 0,
          });
        });
      });

      const totalRevenue = trendPoints.reduce((sum, point) => sum + point.revenue, 0);
      const globalOrderingMembers = new Set<string>();
      trendPoints.forEach((point) => {
        const parts = point.key.split("-");
        const dKey = `${parts[1]}-${parts[2]}-${parts[3]}`;
        const members = membersBySaleDate.get(dKey);
        members?.forEach((member) => globalOrderingMembers.add(member));
      });
      setTrendTotals({
        orders: trendPoints.reduce((sum, point) => sum + point.orders, 0),
        orderingMembers: globalOrderingMembers.size,
        revenue: totalRevenue,
      });
      setTrends(trendPoints);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [effectiveMemberId]);

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

  const roleLabel =
    effectiveRole === "admin" ? "Admin" : effectiveRole === "referent" ? "Referent" : "Membre";
  const fullName = `${viewer?.firstName ?? ""} ${viewer?.lastName ?? ""}`.trim();
  const referentProducerRows = useMemo(() => {
    if (effectiveRole !== "referent" || !effectiveMemberId) return [];
    return distributionProducerRows.filter((row) => row.referentId === effectiveMemberId);
  }, [distributionProducerRows, effectiveMemberId, effectiveRole]);
  const referentProducerIds = useMemo(
    () => referentProducerRows.map((row) => row.producerId).filter(Boolean),
    [referentProducerRows],
  );
  const referentManageAllHref = useMemo(() => {
    if (!activeDistribution?.id || !referentProducerIds.length) return "";
    return `/admin/vente/gerer?distributionId=${encodeURIComponent(activeDistribution.id)}&producerIds=${encodeURIComponent(
      referentProducerIds.join(","),
    )}&idx=0`;
  }, [activeDistribution?.id, referentProducerIds]);
  const trendSeries = useMemo(() => {
    if (trends.length) return trends;
    const fallbackDates = (activeDistribution?.dates ?? []).slice(0, 3).map((entry) => entry.toDate?.()).filter(Boolean) as Date[];
    return fallbackDates.map((date, index) => ({
      key: `${index}-${dateKey(date)}`,
      label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      orders: 0,
      orderingMembers: 0,
      revenue: 0,
    }));
  }, [trends, activeDistribution]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-4">
        <p className="text-sm text-ink/75">
          Bienvenue {fullName || "Utilisateur"}.
        </p>
        <p className="mt-1 text-sm font-semibold text-ink">Role : {roleLabel}</p>
      </section>

      {effectiveRole === "referent" ? (
        <section className="rounded-[10px] border border-forest/30 bg-forest/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
                Vente en cours
              </p>
              <p className="mt-1 text-sm text-ink/80">
                {activeDistribution
                  ? `${distributionLabel(activeDistribution)} - ${statusLabel(activeDistribution.status)}`
                  : "Aucune distribution planifiee."}
              </p>
            </div>
            {referentManageAllHref ? (
              <Link
                href={referentManageAllHref}
                className="rounded bg-forest px-4 py-2 text-sm font-semibold text-white"
              >
                Gerer tous mes producteurs
              </Link>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {referentProducerRows.length ? (
              referentProducerRows.map((row) => (
                <Link
                  key={row.producerId}
                  href={`/admin/vente/gerer?distributionId=${encodeURIComponent(activeDistribution?.id ?? "")}&producerIds=${encodeURIComponent(row.producerId)}&idx=0`}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    row.validatedByReferent
                      ? "border-forest/30 bg-forest/10 text-forest"
                      : "border-ember/30 bg-ember/10 text-ember"
                  }`}
                >
                  {producerMap[row.producerId]?.name ?? "Producteur"} · {row.validatedByReferent ? "Valide" : "A valider"}
                </Link>
              ))
            ) : (
              <span className="text-xs text-ink/65">Aucun producteur rattache pour cette distribution.</span>
            )}
          </div>
        </section>
      ) : null}

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

      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Evolutions
          </p>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <MetricBars
            title="Commandes"
            series={trendSeries}
            valueKey="orders"
            totalValue={trendTotals.orders}
          />
          <MetricBars
            title="Adherents ayant commande"
            series={trendSeries}
            valueKey="orderingMembers"
            totalValue={trendTotals.orderingMembers}
          />
          <MetricBars
            title="Chiffre d'affaires"
            series={trendSeries}
            valueKey="revenue"
            totalValue={trendTotals.revenue}
          />
        </div>
      </section>

      {children ? <div>{children}</div> : null}
      {loading ? <p className="text-sm text-ink/70">Chargement du resume...</p> : null}
    </div>
  );
}
