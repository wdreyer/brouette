"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseDb } from "@/lib/firebase/client";
import {
  distributionStatusLabel,
  distributionLabel,
  isOpenStatus,
  isPlannedStatus,
  pickOpenDistribution,
  resolveDistributionStatus,
  type DistributionStatusKey,
} from "@/lib/distributions";

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
};

type MemberProfile = {
  id: string;
  firstName?: string;
  lastName?: string;
  createdAt?: { toDate?: () => Date };
};

type ProducerProfile = {
  name?: string;
};

type DistributionProducerRow = {
  producerId: string;
  referentId?: string | null;
  active?: boolean;
  activeDateKeys?: string[];
  validatedByReferent?: boolean;
};

type OrderDoc = {
  id: string;
  distributionId?: string | null;
  memberId?: string | null;
  memberUid?: string | null;
  memberSnapshot?: { email?: string | null };
  status?: string | null;
  totals?: { totalAmount?: number; itemCount?: number };
  createdAt?: { toDate?: () => Date };
};

type InviteDoc = {
  used?: boolean;
};

type LoginAttemptDoc = {
  success?: boolean;
  createdAt?: { toDate?: () => Date };
};

type AdminDashboardProps = {
  children?: ReactNode;
  focusMode?: boolean;
  showExtendedStats?: boolean;
};

type CalendarRow = {
  id: string;
  label: string;
  status: string;
  statusKey: DistributionStatusKey;
  dates: Date[];
  activeProducers: number;
  validatedProducers: number;
  producerNames: string[];
};

type TopProductRow = {
  productId: string;
  title: string;
  imageUrl?: string;
  producerName?: string;
  quantity: number;
  revenue: number;
};

function toDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  if ("toDate" in value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function deltaInfo(current: number, previous: number) {
  const diff = current - previous;
  if (previous <= 0) {
    return {
      pctLabel: "0%",
      previousLabel: "Base année précédente: 0",
      toneClass: "border-honey/40 bg-honey/15 text-ink",
    };
  }
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  if (diff > 0) {
    return {
      pctLabel: `+${pct}%`,
      previousLabel: `Année précédente: ${formatNumber(previous)}`,
      toneClass: "border-forest/40 bg-forest/15 text-forest",
    };
  }
  if (diff < 0) {
    return {
      pctLabel: `-${pct}%`,
      previousLabel: `Année précédente: ${formatNumber(previous)}`,
      toneClass: "border-ember/40 bg-ember/15 text-ember",
    };
  }
  return {
    pctLabel: "0%",
    previousLabel: `Année précédente: ${formatNumber(previous)}`,
    toneClass: "border-ink/20 bg-ink/5 text-ink/70",
  };
}

function seasonRanges(now: Date) {
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(year, 8, 1, 0, 0, 0, 0);
  const end = new Date(year + 1, 6, 31, 23, 59, 59, 999);
  const prevStart = new Date(year - 1, 8, 1, 0, 0, 0, 0);
  const prevEnd = new Date(year, 6, 31, 23, 59, 59, 999);
  return { start, end, prevStart, prevEnd, label: `${year}/${year + 1}` };
}

function inRange(date: Date | null, start: Date, end: Date) {
  if (!date) return false;
  return date >= start && date <= end;
}

function daysUntil(date?: Date | null) {
  if (!date) return null;
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function isCancelledOrder(status?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  return ["annulee", "annule", "cancelled", "canceled"].includes(normalized);
}

function compareCurvePath(value: number, max: number) {
  const x0 = 10;
  const y0 = 62;
  const x1 = 98;
  const x2 = 206;
  const ratio = max > 0 ? value / max : 0;
  const y2 = Math.round(62 - ratio * 46);
  const y1 = Math.round(62 - ratio * 24);
  return {
    path: `M ${x0} ${y0} Q ${x1} ${y1} ${x2} ${y2}`,
    endX: x2,
    endY: y2,
  };
}

function CompareSpark({
  current,
  previous,
  currentYearLabel,
  previousYearLabel,
}: {
  current: number;
  previous: number;
  currentYearLabel: string;
  previousYearLabel: string;
}) {
  const max = Math.max(current, previous, 1);
  const currentCurve = compareCurvePath(current, max);
  const previousCurve = compareCurvePath(previous, max);
  const previousValueLabel = Number.isFinite(previous) ? formatNumber(previous) : "0";
  const currentValueLabel = Number.isFinite(current) ? formatNumber(current) : "0";

  return (
    <div className="mt-3">
      <svg viewBox="0 0 220 72" className="h-16 w-full">
        <line x1="10" y1="62" x2="210" y2="62" className="stroke-clay/70" strokeWidth="1" />
        <path d={previousCurve.path} className="fill-none stroke-ink/30" strokeWidth="2.5" strokeLinecap="round" />
        <path d={currentCurve.path} className="fill-none stroke-forest" strokeWidth="3" strokeLinecap="round" />
        <circle cx={previousCurve.endX} cy={previousCurve.endY} r="3" className="fill-ink/35" />
        <circle cx={currentCurve.endX} cy={currentCurve.endY} r="3.5" className="fill-forest" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink/65">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-forest" />
          {currentYearLabel}: {currentValueLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-ink/35" />
          {previousYearLabel}: {previousValueLabel}
        </span>
      </div>
    </div>
  );
}

export default function AdminDashboard({
  children,
  focusMode = false,
  showExtendedStats = false,
}: AdminDashboardProps) {
  if (focusMode) return <div>{children}</div>;
  const { effectiveMemberId, effectiveRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<MemberProfile | null>(null);
  const [producerMap, setProducerMap] = useState<Record<string, ProducerProfile>>({});
  const [distributionRows, setDistributionRows] = useState<DistributionProducerRow[]>([]);
  const [entities, setEntities] = useState({ members: 0, producers: 0, products: 0, orders: 0 });
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);
  const [nextDistribution, setNextDistribution] = useState<Distribution | null>(null);
  const [saleStats, setSaleStats] = useState({
    productsCount: 0,
    offersProducerCount: 0,
    orderCount: 0,
    orderingMembers: 0,
    revenue: 0,
  });
  const [calendarRows, setCalendarRows] = useState<CalendarRow[]>([]);
  const [seasonSummary, setSeasonSummary] = useState({
    label: "",
    membersCurrent: 0,
    membersPrevious: 0,
    activeMembersCurrent: 0,
    activeMembersPrevious: 0,
    ordersCurrent: 0,
    ordersPrevious: 0,
    revenueCurrent: 0,
    revenuePrevious: 0,
    itemsCurrent: 0,
    itemsPrevious: 0,
    pendingInvites: 0,
    failedLoginAttempts: 0,
    distributionsTotal: 0,
    distributionsPast: 0,
    distributionsUpcoming: 0,
  });
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [topProductsDistributionLabel, setTopProductsDistributionLabel] = useState("");
  const [calendarModal, setCalendarModal] = useState<CalendarRow | null>(null);

  useEffect(() => {
    const load = async () => {
      const now = new Date();
      const season = seasonRanges(now);

      const [membersSnap, producersSnap, productsSnap, ordersSnap, distSnap, invitesSnap, attemptsSnap] =
        await Promise.all([
          getDocs(collection(firebaseDb, "members")),
          getDocs(collection(firebaseDb, "producers")),
          getDocs(collection(firebaseDb, "products")),
          getDocs(collection(firebaseDb, "orders")),
          getDocs(collection(firebaseDb, "distributionDates")),
          getDocs(collection(firebaseDb, "invites")),
          getDocs(collection(firebaseDb, "authLoginAttempts")),
        ]);

      setEntities({
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

      const productMap = new Map(
        productsSnap.docs.map((docSnap) => [
          docSnap.id,
          docSnap.data() as { name?: string; imageUrl?: string; producerId?: string },
        ]),
      );

      const members = membersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<MemberProfile, "id">),
      }));
      setViewer(effectiveMemberId ? members.find((entry) => entry.id === effectiveMemberId) ?? null : null);

      const distributions = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Distribution, "id">),
      })) as Distribution[];
      const distributionById = new Map(distributions.map((distribution) => [distribution.id, distribution]));
      distributions.sort((a, b) => {
        const aDate = toDate(a.dates?.[0]) ?? new Date(0);
        const bDate = toDate(b.dates?.[0]) ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });

      const open = pickOpenDistribution(distributions);
      setOpenDistribution(open);
      const nextPlanned = distributions.find((item) => isPlannedStatus(item.status)) ?? null;
      setNextDistribution(nextPlanned);
      const targetDistribution = open ?? nextPlanned;

      const allOrders = ordersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<OrderDoc, "id">),
      })) as OrderDoc[];
      const activeOrders = allOrders.filter((order) => !isCancelledOrder(order.status));

      const seasonOrders = allOrders.filter((order) => inRange(toDate(order.createdAt), season.start, season.end));
      const previousSeasonOrders = allOrders.filter((order) => inRange(toDate(order.createdAt), season.prevStart, season.prevEnd));
      const seasonMembersCreated = members.filter((member) => inRange(toDate(member.createdAt), season.start, season.end)).length;
      const previousMembersCreated = members.filter((member) => inRange(toDate(member.createdAt), season.prevStart, season.prevEnd)).length;
      const seasonOrderingMembers = new Set(seasonOrders.map((order) => String(order.memberId ?? "")).filter(Boolean)).size;
      const previousSeasonOrderingMembers = new Set(
        previousSeasonOrders.map((order) => String(order.memberId ?? "")).filter(Boolean),
      ).size;
      const seasonRevenue = seasonOrders.reduce((sum, order) => sum + Number(order.totals?.totalAmount ?? 0), 0);
      const previousSeasonRevenue = previousSeasonOrders.reduce((sum, order) => sum + Number(order.totals?.totalAmount ?? 0), 0);
      const seasonItems = seasonOrders.reduce((sum, order) => sum + Number(order.totals?.itemCount ?? 0), 0);
      const previousSeasonItems = previousSeasonOrders.reduce((sum, order) => sum + Number(order.totals?.itemCount ?? 0), 0);

      const seasonDistributions = distributions.filter((distribution) => inRange(toDate(distribution.dates?.[0]), season.start, season.end));
      const distributionsPast = seasonDistributions.filter((distribution) => {
        const firstDate = toDate(distribution.dates?.[0]);
        return Boolean(firstDate && firstDate < now);
      }).length;
      const distributionsUpcoming = seasonDistributions.filter((distribution) => {
        const firstDate = toDate(distribution.dates?.[0]);
        return Boolean(firstDate && firstDate >= now);
      }).length;

      const pendingInvites = invitesSnap.docs.filter((docSnap) => !(docSnap.data() as InviteDoc).used).length;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const failedAttempts = attemptsSnap.docs.filter((docSnap) => {
        const data = docSnap.data() as LoginAttemptDoc;
        const created = toDate(data.createdAt);
        return data.success !== true && (!created || created >= thirtyDaysAgo);
      }).length;

      setSeasonSummary({
        label: season.label,
        membersCurrent: seasonMembersCreated,
        membersPrevious: previousMembersCreated,
        activeMembersCurrent: seasonOrderingMembers,
        activeMembersPrevious: previousSeasonOrderingMembers,
        ordersCurrent: seasonOrders.length,
        ordersPrevious: previousSeasonOrders.length,
        revenueCurrent: seasonRevenue,
        revenuePrevious: previousSeasonRevenue,
        itemsCurrent: seasonItems,
        itemsPrevious: previousSeasonItems,
        pendingInvites,
        failedLoginAttempts: failedAttempts,
        distributionsTotal: seasonDistributions.length,
        distributionsPast,
        distributionsUpcoming,
      });

      if (targetDistribution) {
        const [producerRowsSnap, offerSnap] = await Promise.all([
          getDocs(collection(firebaseDb, "distributionDates", targetDistribution.id, "producers")),
          getDocs(collection(firebaseDb, "distributionDates", targetDistribution.id, "offerItems")),
        ]);

        const rows = producerRowsSnap.docs.map((docSnap) => {
          const data = docSnap.data() as DistributionProducerRow;
          return {
            producerId: String(data.producerId ?? docSnap.id),
            referentId: data.referentId ?? null,
            active: data.active !== false,
            validatedByReferent: data.validatedByReferent === true,
          } as DistributionProducerRow;
        });
        setDistributionRows(rows);

        const distributionOrders = allOrders.filter(
          (order) => order.distributionId === targetDistribution.id && !isCancelledOrder(order.status),
        );
        const orderMembers = new Set(
          distributionOrders
            .map((order) => {
              const memberId = String(order.memberId ?? "").trim();
              if (memberId) return memberId;
              const memberUid = String(order.memberUid ?? "").trim();
              if (memberUid) return memberUid;
              return String(order.memberSnapshot?.email ?? "").trim().toLowerCase();
            })
            .filter(Boolean),
        );
        const revenue = distributionOrders.reduce((sum, order) => sum + Number(order.totals?.totalAmount ?? 0), 0);

        const activeOffers = offerSnap.docs
          .map((docSnap) => docSnap.data() as { producerId?: string; productId?: string; active?: boolean })
          .filter((offer) => offer.active !== false);
        const offerProducerIds = new Set(activeOffers.map((offer) => String(offer.producerId ?? "").trim()).filter(Boolean));
        const offerProductIds = new Set(activeOffers.map((offer) => String(offer.productId ?? "").trim()).filter(Boolean));

        setSaleStats({
          productsCount: offerProductIds.size,
          offersProducerCount: offerProducerIds.size,
          orderCount: distributionOrders.length,
          orderingMembers: orderMembers.size,
          revenue,
        });
      } else {
        setDistributionRows([]);
        setSaleStats({
          productsCount: 0,
          offersProducerCount: 0,
          orderCount: 0,
          orderingMembers: 0,
          revenue: 0,
        });
      }

      const orderDistributionIds = Array.from(
        new Set(
          activeOrders
            .map((order) => String(order.distributionId ?? "").trim())
            .filter(Boolean),
        ),
      );
      const latestDistributionId = orderDistributionIds
        .map((id) => ({
          id,
          firstDate: toDate(distributionById.get(id)?.dates?.[0]),
        }))
        .sort((a, b) => (b.firstDate?.getTime() ?? 0) - (a.firstDate?.getTime() ?? 0))[0]?.id;
      const topSourceDistributionId = latestDistributionId ?? targetDistribution?.id ?? "";
      const topSourceDistribution = topSourceDistributionId ? distributionById.get(topSourceDistributionId) : null;
      setTopProductsDistributionLabel(topSourceDistribution ? distributionLabel(topSourceDistribution) : "");

      if (topSourceDistributionId) {
        const sourceOrders = activeOrders.filter((order) => order.distributionId === topSourceDistributionId);
        const itemsByProduct = new Map<string, { quantity: number; revenue: number }>();
        const itemSnaps = await Promise.all(
          sourceOrders.map((order) => getDocs(collection(firebaseDb, "orders", order.id, "items"))),
        );
        itemSnaps.forEach((snapshot) => {
          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data() as {
              productId?: string;
              quantity?: number;
              lineTotal?: number;
              unitPrice?: number;
            };
            const productId = String(data.productId ?? "").trim();
            if (!productId) return;
            const quantity = Number(data.quantity ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            const computedRevenue = Number(data.lineTotal ?? Number(data.unitPrice ?? 0) * quantity);
            const previous = itemsByProduct.get(productId) ?? { quantity: 0, revenue: 0 };
            itemsByProduct.set(productId, {
              quantity: previous.quantity + quantity,
              revenue: previous.revenue + (Number.isFinite(computedRevenue) ? computedRevenue : 0),
            });
          });
        });

        const topRows = Array.from(itemsByProduct.entries())
          .map(([productId, values]) => {
            const product = productMap.get(productId);
            const producerId = String(product?.producerId ?? "");
            return {
              productId,
              title: String(product?.name ?? "Produit"),
              imageUrl: product?.imageUrl,
              producerName: nextProducerMap[producerId]?.name ?? undefined,
              quantity: values.quantity,
              revenue: values.revenue,
            } as TopProductRow;
          })
          .sort((a, b) => (b.quantity === a.quantity ? b.revenue - a.revenue : b.quantity - a.quantity))
          .slice(0, 5);
        setTopProducts(topRows);
      } else {
        setTopProducts([]);
      }

      const nextCalendarRows = await Promise.all(
        distributions.map(async (distribution) => {
          const [producerRowsSnap, calendarRowsSnap] = await Promise.all([
            getDocs(collection(firebaseDb, "distributionDates", distribution.id, "producers")),
            getDocs(collection(firebaseDb, "distributionDates", distribution.id, "calendarProducers")),
          ]);
          const producerRows = producerRowsSnap.docs.map(
            (docSnap) => docSnap.data() as DistributionProducerRow,
          );
          const calendarRows = calendarRowsSnap.docs.map(
            (docSnap) => docSnap.data() as DistributionProducerRow,
          );
          const distributionDateKeys = (distribution.dates ?? [])
            .slice(0, 3)
            .map((date) => toDate(date))
            .filter(Boolean)
            .map((date) => dateKey(date as Date));
          const sourceRows = calendarRows.length > 0 ? calendarRows : producerRows;
          const activeRows = sourceRows.filter((row) => {
            if (row.active === false) return false;
            const keys = Array.isArray(row.activeDateKeys) ? row.activeDateKeys : [];
            if (keys.length === 0) return true;
            return keys.some((key) => distributionDateKeys.includes(String(key)));
          });
          const producerNames = activeRows
            .map((row) => nextProducerMap[String(row.producerId ?? "")]?.name ?? String(row.producerId ?? "").trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

          return {
            id: distribution.id,
            label: distributionLabel(distribution),
            status: distributionStatusLabel(distribution.status),
            statusKey: resolveDistributionStatus(distribution.status),
            dates: (distribution.dates ?? []).slice(0, 3).map((date) => toDate(date)).filter(Boolean) as Date[],
            activeProducers: activeRows.length,
            validatedProducers: producerRows.filter((row) => row.validatedByReferent).length,
            producerNames,
          } as CalendarRow;
        }),
      );
      setCalendarRows(nextCalendarRows);

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [effectiveMemberId]);

  const roleLabel = effectiveRole === "admin" ? "Admin" : effectiveRole === "referent" ? "Référent" : "Membre";
  const fullName = `${viewer?.firstName ?? ""} ${viewer?.lastName ?? ""}`.trim();
  const activeDistribution = openDistribution ?? nextDistribution;
  const saleDates = useMemo(
    () => (activeDistribution?.dates ?? []).slice(0, 3).map((date) => toDate(date)).filter(Boolean) as Date[],
    [activeDistribution],
  );
  const nextDate = saleDates[0] ?? null;
  const daysBefore = daysUntil(nextDate);

  const referentRows = useMemo(() => {
    if (effectiveRole !== "referent" || !effectiveMemberId) return [];
    return distributionRows.filter((row) => row.referentId === effectiveMemberId);
  }, [distributionRows, effectiveRole, effectiveMemberId]);

  const referentManageHref = useMemo(() => {
    if (!activeDistribution?.id || !referentRows.length) return "";
    const producerIds = referentRows.map((row) => row.producerId).join(",");
    return `/admin/vente/gerer?distributionId=${encodeURIComponent(activeDistribution.id)}&producerIds=${encodeURIComponent(
      producerIds,
    )}&idx=0`;
  }, [activeDistribution?.id, referentRows]);

  const visualCalendarRows = useMemo(() => {
    return [...calendarRows]
      .filter((row) => row.statusKey === "planned")
      .sort((a, b) => {
        const aDate = a.dates[0] ?? new Date(0);
        const bDate = b.dates[0] ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });
  }, [calendarRows]);

  const membersDelta = deltaInfo(seasonSummary.membersCurrent, seasonSummary.membersPrevious);
  const activeMembersDelta = deltaInfo(seasonSummary.activeMembersCurrent, seasonSummary.activeMembersPrevious);
  const ordersDelta = deltaInfo(seasonSummary.ordersCurrent, seasonSummary.ordersPrevious);
  const revenueDelta = deltaInfo(seasonSummary.revenueCurrent, seasonSummary.revenuePrevious);
  const itemsDelta = deltaInfo(seasonSummary.itemsCurrent, seasonSummary.itemsPrevious);
  const seasonYears = useMemo(() => {
    const [previous, current] = String(seasonSummary.label ?? "").split("/");
    return {
      current: current?.trim() || String(new Date().getFullYear()),
      previous: previous?.trim() || String(new Date().getFullYear() - 1),
    };
  }, [seasonSummary.label]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-4">
        <p className="text-sm text-ink/75">Bienvenue {fullName || "Utilisateur"}.</p>
        <p className="mt-1 text-sm font-semibold text-ink">Rôle : {roleLabel}</p>
      </section>

      {effectiveRole === "referent" ? (
        <section className="rounded-[10px] border border-forest/30 bg-forest/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Mes producteurs</p>
              <p className="mt-1 text-sm text-ink/80">
                {activeDistribution
                  ? `${distributionLabel(activeDistribution)} - ${distributionStatusLabel(activeDistribution.status)}`
                  : "Aucune distribution planifiée."}
              </p>
            </div>
            {referentManageHref ? (
              <Link href={referentManageHref} className="rounded bg-forest px-4 py-2 text-sm font-semibold text-white">
                Gerer mes producteurs
              </Link>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {referentRows.length ? (
              referentRows.map((row) => (
                <span
                  key={row.producerId}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    row.validatedByReferent
                      ? "border-forest/30 bg-forest/10 text-forest"
                      : "border-ember/30 bg-ember/10 text-ember"
                  }`}
                >
                  {producerMap[row.producerId]?.name ?? "Producteur"}
                </span>
              ))
            ) : (
              <span className="text-xs text-ink/65">Aucun producteur rattache sur cette vente.</span>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Adhérents actifs</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.activeMembersCurrent)}</p>
          <p className="mt-2 text-xs text-ink/65">Saison {seasonSummary.label}</p>
        </article>
        <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Commandes saison</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.ordersCurrent)}</p>
          <p className="mt-2 text-xs text-ink/65">Saison {seasonSummary.label}</p>
        </article>
        <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">CA cumule saison</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{formatMoney(seasonSummary.revenueCurrent)} EUR</p>
          <p className="mt-2 text-xs text-ink/65">Saison {seasonSummary.label}</p>
        </article>
        <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Distributions exercice</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.distributionsTotal)}</p>
          <p className="mt-2 text-xs text-ink/65">
            Passees: {seasonSummary.distributionsPast} - A venir: {seasonSummary.distributionsUpcoming}
          </p>
        </article>
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">🛒 Menu vente</p>
            <h2 className="mt-1 font-serif text-3xl">{openDistribution ? "Vente ouverte" : "Vente fermée"}</h2>
            <p className="mt-2 text-sm text-ink/75">
              {activeDistribution
                ? `${distributionLabel(activeDistribution)} - ${distributionStatusLabel(activeDistribution.status)}`
                : "Aucune distribution planifiée."}
            </p>
            {openDistribution ? (
              <p className="mt-1 text-sm text-ink/75">
                Vente en cours pour les dates {" "}
                {saleDates.map((date) => date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })).join(" ; ")}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink/75">Preparation en cours. Merci de valider les producteurs.</p>
            )}
          </div>
          <Link href="/admin/vente" className="rounded bg-forest px-4 py-2 text-sm font-semibold text-white">
            Gerer la vente
          </Link>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-md border border-clay/70 bg-stone px-3 py-2 text-sm">
            📦 Produits en ligne : <span className="font-semibold">{saleStats.productsCount}</span>
          </article>
          <article className="rounded-md border border-clay/70 bg-stone px-3 py-2 text-sm">
            🧑‍🌾 Producteurs : <span className="font-semibold">{saleStats.offersProducerCount}</span>
          </article>
          <article className="rounded-md border border-clay/70 bg-stone px-3 py-2 text-sm">
            🧾 Commandes : <span className="font-semibold">{saleStats.orderCount}</span>
          </article>
          <article className="rounded-md border border-clay/70 bg-stone px-3 py-2 text-sm">
            💶 Montant total : <span className="font-semibold">{formatMoney(saleStats.revenue)} EUR</span>
          </article>
        </div>
        <p className="mt-3 text-xs text-ink/65">
          Prochaine date:{" "}
          {nextDate
            ? `${nextDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (${daysBefore} jours)`
            : "-"}
        </p>
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">🏆 Top produits commandés</p>
            <p className="mt-1 text-sm text-ink/75">
              {topProductsDistributionLabel
                ? `Dernière distribution : ${topProductsDistributionLabel}`
                : "Aucune distribution avec commandes"}
            </p>
          </div>
        </div>
        {topProducts.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {topProducts.map((row, index) => (
              <article key={row.productId} className="overflow-hidden rounded-md border border-clay/70 bg-stone">
                <div className="h-28 w-full overflow-hidden border-b border-clay/60 bg-white/70">
                  {row.imageUrl ? (
                    <img src={row.imageUrl} alt={row.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-ink/45">Image</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Top {index + 1}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{row.title}</p>
                  {row.producerName ? <p className="mt-1 text-xs text-ink/65">{row.producerName}</p> : null}
                  <div className="mt-2 flex items-center justify-between text-xs font-semibold text-ink/80">
                    <span>{formatNumber(row.quantity)} quantités</span>
                    <span>{formatMoney(row.revenue)} EUR</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink/70">Aucun produit commande pour le moment.</p>
        )}
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">🗓️ Calendrier des distributions planifiées</p>
          <p className="text-xs text-ink/60">{entities.producers} producteurs / {entities.products} produits</p>
        </div>
        {visualCalendarRows.length ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {visualCalendarRows.map((row) => (
              <article key={row.id} className="rounded-[10px] border border-clay/80 bg-stone p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">📦 {row.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-ink/65">{row.activeProducers} producteurs affectés</p>
                      <button
                        type="button"
                        onClick={() => setCalendarModal(row)}
                        className="rounded-full border border-clay/80 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink/80 transition hover:border-forest/40 hover:text-forest"
                      >
                        👀 Détails
                      </button>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      row.statusKey === "open"
                        ? "bg-forest/15 text-forest"
                        : row.statusKey === "finished"
                          ? "bg-ink/10 text-ink/70"
                          : row.statusKey === "archived"
                            ? "bg-ink/10 text-ink/55"
                          : "bg-honey/20 text-ink"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {row.dates.map((date, index) => (
                    <div key={`${row.id}-date-${index}`} className="rounded-md border border-clay/70 bg-white/70 px-2 py-2 text-center">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">📅 Date {index + 1}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink/70">Aucune distribution planifiée.</p>
        )}
      </section>

      {showExtendedStats ? (
        <>
          <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Comparatif {seasonYears.current} / {seasonYears.previous}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Adhérents actifs</p>
                <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(seasonSummary.activeMembersCurrent)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${activeMembersDelta.toneClass}`}>
                    {activeMembersDelta.pctLabel}
                  </span>
                  <span className="text-xs text-ink/65">
                    {seasonYears.previous}: {formatNumber(seasonSummary.activeMembersPrevious)}
                  </span>
                </div>
                <CompareSpark
                  current={seasonSummary.activeMembersCurrent}
                  previous={seasonSummary.activeMembersPrevious}
                  currentYearLabel={seasonYears.current}
                  previousYearLabel={seasonYears.previous}
                />
              </article>
              <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Commandes</p>
                <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(seasonSummary.ordersCurrent)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${ordersDelta.toneClass}`}>
                    {ordersDelta.pctLabel}
                  </span>
                  <span className="text-xs text-ink/65">
                    {seasonYears.previous}: {formatNumber(seasonSummary.ordersPrevious)}
                  </span>
                </div>
                <CompareSpark
                  current={seasonSummary.ordersCurrent}
                  previous={seasonSummary.ordersPrevious}
                  currentYearLabel={seasonYears.current}
                  previousYearLabel={seasonYears.previous}
                />
              </article>
              <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">CA cumule</p>
                <p className="mt-2 text-xl font-semibold text-ink">{formatMoney(seasonSummary.revenueCurrent)} EUR</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${revenueDelta.toneClass}`}>
                    {revenueDelta.pctLabel}
                  </span>
                  <span className="text-xs text-ink/65">
                    {seasonYears.previous}: {formatMoney(seasonSummary.revenuePrevious)} EUR
                  </span>
                </div>
                <CompareSpark
                  current={seasonSummary.revenueCurrent}
                  previous={seasonSummary.revenuePrevious}
                  currentYearLabel={seasonYears.current}
                  previousYearLabel={seasonYears.previous}
                />
              </article>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Adhérents saison</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.membersCurrent)}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${membersDelta.toneClass}`}>
                  {membersDelta.pctLabel}
                </span>
                <span className="text-xs text-ink/65">
                  {seasonYears.previous}: {formatNumber(seasonSummary.membersPrevious)}
                </span>
              </div>
            </article>
            <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Articles commandes</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.itemsCurrent)}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${itemsDelta.toneClass}`}>
                  {itemsDelta.pctLabel}
                </span>
                <span className="text-xs text-ink/65">
                  {seasonYears.previous}: {formatNumber(seasonSummary.itemsPrevious)}
                </span>
              </div>
            </article>
            <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Producteurs</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(entities.producers)}</p>
              <p className="mt-2 text-xs text-ink/65">Total en base</p>
            </article>
            <article className="rounded-[10px] border border-clay/90 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Tentatives login KO (30j)</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(seasonSummary.failedLoginAttempts)}</p>
              <p className="mt-2 text-xs text-ink/65">Securite acces</p>
            </article>
          </section>
        </>
      ) : null}

      {calendarModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCalendarModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-[10px] border border-clay bg-white p-5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">👥 Producteurs affectés</p>
                <h3 className="mt-1 font-serif text-3xl text-ink">{calendarModal.label}</h3>
                <p className="mt-1 text-sm text-ink/70">
                  {calendarModal.activeProducers} producteurs sur cette distribution
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCalendarModal(null)}
                className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs font-semibold text-ink/80 transition hover:border-ink/40"
              >
                Fermer
              </button>
            </div>
            <div className="mt-4 max-h-[55vh] overflow-auto rounded-md border border-clay/80 bg-stone p-3">
              {calendarModal.producerNames.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {calendarModal.producerNames.map((name) => (
                    <div key={`${calendarModal.id}-${name}`} className="rounded-md border border-clay/70 bg-white/80 px-3 py-2 text-sm text-ink">
                      🧺 {name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink/65">Aucun producteur affecté.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {children ? <div>{children}</div> : null}
      {loading ? <p className="text-sm text-ink/70">Chargement du resume...</p> : null}
    </div>
  );
}
