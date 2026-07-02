"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { reportError } from "@/lib/reportError";

type OrderDoc = {
  id: string;
  createdAt?: { toDate?: () => Date };
  distributionId?: string | null;
  memberId?: string | null;
  memberUid?: string | null;
  memberSnapshot?: { email?: string | null };
  status?: string | null;
  totals?: { totalAmount?: number; itemCount?: number };
};

type OrderItemDoc = {
  productId?: string;
  producerId?: string;
  quantity?: number;
  lineTotal?: number;
  unitPrice?: number;
};

type DistributionDoc = {
  id: string;
  dates?: { toDate?: () => Date }[];
};

type ProductDoc = {
  name?: string;
  imageUrl?: string;
};

type ProducerDoc = {
  name?: string;
};

type MemberDoc = {
  membershipStatus?: string;
};

type CompareChartProps = {
  labels: string[];
  current: number[];
  previous: number[];
  currentLabel: string;
  previousLabel: string;
  valueFormatter?: (value: number) => string;
};

function toDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  if ("toDate" in value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function isCancelled(status?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  return ["annulee", "annule", "cancelled", "canceled"].includes(normalized);
}

function formatMoney(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function linePath(values: number[], max: number, width: number, height: number, pad = 14) {
  if (values.length === 0) return "";
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return values
    .map((value, index) => {
      const x = pad + (index * innerW) / Math.max(values.length - 1, 1);
      const y = pad + innerH - ((max > 0 ? value / max : 0) * innerH);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function CompareLineChart({
  labels,
  current,
  previous,
  currentLabel,
  previousLabel,
  valueFormatter = (value) => formatNumber(value),
}: CompareChartProps) {
  const width = 520;
  const height = 190;
  const max = Math.max(...current, ...previous, 1);
  const currentPath = linePath(current, max, width, height);
  const previousPath = linePath(previous, max, width, height);

  return (
    <div className="rounded-[10px] border border-clay/80 bg-stone p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full">
        <line x1="14" y1={height - 14} x2={width - 14} y2={height - 14} className="stroke-clay/80" strokeWidth="1" />
        <path d={previousPath} className="fill-none stroke-ink/35" strokeWidth="2.2" strokeLinecap="round" />
        <path d={currentPath} className="fill-none stroke-forest" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <div className="mt-2 flex items-center justify-between text-xs text-ink/70">
        <div className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-forest" />
          {currentLabel}
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
          {previousLabel}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-6 gap-2 text-[10px] text-ink/60 md:grid-cols-12">
        {labels.map((label, index) => (
          <div key={`${label}-${index}`} className="text-center">
            <p>{label}</p>
            <p className="font-semibold text-ink/70">{valueFormatter(current[index] ?? 0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionBars({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}) {
  const max = Math.max(...values, 1);
  return (
    <div className="rounded-[10px] border border-clay/80 bg-stone p-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-9">
        {values.map((value, index) => {
          const h = Math.max(8, Math.round((value / max) * 80));
          return (
            <div key={`${labels[index]}-${index}`} className="flex flex-col items-center gap-1">
              <div className="text-[10px] font-semibold text-ink/70">{Math.round(value)}</div>
              <div className="flex h-[84px] items-end">
                <div className="w-5 rounded-sm bg-forest/75" style={{ height: `${h}px` }} />
              </div>
              <div className="text-[10px] text-ink/60">{labels[index]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminStatsDashboard() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "history" | "tops">("overview");
  const [summary, setSummary] = useState({
    members: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    producers: 0,
    products: 0,
    orders: 0,
    revenue: 0,
    items: 0,
    avgBasket: 0,
  });
  const [monthly, setMonthly] = useState({
    labels: [] as string[],
    yearCurrent: String(new Date().getFullYear()),
    yearPrevious: String(new Date().getFullYear() - 1),
    ordersCurrent: Array(12).fill(0) as number[],
    ordersPrevious: Array(12).fill(0) as number[],
    revenueCurrent: Array(12).fill(0) as number[],
    revenuePrevious: Array(12).fill(0) as number[],
  });
  const [distributionHistory, setDistributionHistory] = useState<
    { label: string; orders: number; revenue: number; members: number; items: number }[]
  >([]);
  const [topProducts, setTopProducts] = useState<
    { productId: string; name: string; imageUrl?: string; qty: number; revenue: number }[]
  >([]);
  const [topProducers, setTopProducers] = useState<{ producerId: string; name: string; revenue: number; qty: number }[]>(
    [],
  );

  useEffect(() => {
    const load = async () => {
      const [membersSnap, producersSnap, productsSnap, ordersSnap, distSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "products")),
        getDocs(collection(firebaseDb, "orders")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      const productMap = new Map<string, ProductDoc>(
        productsSnap.docs.map((docSnap) => [docSnap.id, docSnap.data() as ProductDoc]),
      );
      const producerMap = new Map<string, ProducerDoc>(
        producersSnap.docs.map((docSnap) => [docSnap.id, docSnap.data() as ProducerDoc]),
      );

      const members = membersSnap.docs.map((docSnap) => docSnap.data() as MemberDoc);
      const orders = ordersSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<OrderDoc, "id">) }))
        .filter((order) => !isCancelled(order.status));
      const distributions = distSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<DistributionDoc, "id">) }))
        .sort((a, b) => (toDate(a.dates?.[0])?.getTime() ?? 0) - (toDate(b.dates?.[0])?.getTime() ?? 0));

      const now = new Date();
      const currentYear = now.getFullYear();
      const previousYear = currentYear - 1;
      const monthLabels = ["Jan", "Fev", "Mar", "Avr", "Mai", "Juin", "Juil", "Aou", "Sep", "Oct", "Nov", "Dec"];
      const ordersCurrent = Array(12).fill(0) as number[];
      const ordersPrevious = Array(12).fill(0) as number[];
      const revenueCurrent = Array(12).fill(0) as number[];
      const revenuePrevious = Array(12).fill(0) as number[];

      let totalRevenue = 0;
      let totalItems = 0;
      const itemsByOrder = new Map<string, OrderItemDoc[]>();
      const itemsByProduct = new Map<string, { qty: number; revenue: number }>();
      const itemsByProducer = new Map<string, { qty: number; revenue: number }>();

      const itemSnaps = await Promise.all(orders.map((order) => getDocs(collection(firebaseDb, "orders", order.id, "items"))));
      itemSnaps.forEach((snap, index) => {
        const order = orders[index];
        const items = snap.docs.map((docSnap) => docSnap.data() as OrderItemDoc);
        itemsByOrder.set(order.id, items);
        items.forEach((item) => {
          const qty = Number(item.quantity ?? 0);
          const lineTotal = Number(item.lineTotal ?? Number(item.unitPrice ?? 0) * qty);
          totalItems += Number.isFinite(qty) ? qty : 0;

          const productId = String(item.productId ?? "").trim();
          if (productId) {
            const prev = itemsByProduct.get(productId) ?? { qty: 0, revenue: 0 };
            itemsByProduct.set(productId, { qty: prev.qty + qty, revenue: prev.revenue + lineTotal });
          }

          const producerId = String(item.producerId ?? "").trim();
          if (producerId) {
            const prev = itemsByProducer.get(producerId) ?? { qty: 0, revenue: 0 };
            itemsByProducer.set(producerId, { qty: prev.qty + qty, revenue: prev.revenue + lineTotal });
          }
        });
      });

      orders.forEach((order) => {
        const created = toDate(order.createdAt);
        if (!created) return;
        const month = created.getMonth();
        const year = created.getFullYear();
        const amount = Number(order.totals?.totalAmount ?? 0);
        totalRevenue += amount;
        if (year === currentYear) {
          ordersCurrent[month] += 1;
          revenueCurrent[month] += amount;
        } else if (year === previousYear) {
          ordersPrevious[month] += 1;
          revenuePrevious[month] += amount;
        }
      });

      const distHistory = distributions
        .slice(-9)
        .map((distribution) => {
          const relatedOrders = orders.filter((order) => order.distributionId === distribution.id);
          const membersSet = new Set<string>();
          let revenue = 0;
          let items = 0;
          relatedOrders.forEach((order) => {
            const memberKey =
              String(order.memberId ?? "").trim() ||
              String(order.memberUid ?? "").trim() ||
              String(order.memberSnapshot?.email ?? "").trim().toLowerCase();
            if (memberKey) membersSet.add(memberKey);
            revenue += Number(order.totals?.totalAmount ?? 0);
            const lines = itemsByOrder.get(order.id) ?? [];
            lines.forEach((line) => {
              items += Number(line.quantity ?? 0);
            });
          });
          const firstDate = toDate(distribution.dates?.[0]);
          const label = firstDate
            ? firstDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
            : distribution.id.slice(0, 6);
          return { label, orders: relatedOrders.length, revenue, members: membersSet.size, items };
        });

      const topProductsRows = Array.from(itemsByProduct.entries())
        .map(([productId, values]) => ({
          productId,
          name: productMap.get(productId)?.name ?? "Produit",
          imageUrl: productMap.get(productId)?.imageUrl,
          qty: values.qty,
          revenue: values.revenue,
        }))
        .sort((a, b) => (b.qty === a.qty ? b.revenue - a.revenue : b.qty - a.qty))
        .slice(0, 12);

      const topProducersRows = Array.from(itemsByProducer.entries())
        .map(([producerId, values]) => ({
          producerId,
          name: producerMap.get(producerId)?.name ?? "Producteur",
          qty: values.qty,
          revenue: values.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 12);

      const activeMembers = members.filter((member) => String(member.membershipStatus ?? "active") !== "inactive").length;
      const inactiveMembers = Math.max(members.length - activeMembers, 0);

      setSummary({
        members: members.length,
        activeMembers,
        inactiveMembers,
        producers: producersSnap.size,
        products: productsSnap.size,
        orders: orders.length,
        revenue: totalRevenue,
        items: totalItems,
        avgBasket: orders.length ? totalRevenue / orders.length : 0,
      });
      setMonthly({
        labels: monthLabels,
        yearCurrent: String(currentYear),
        yearPrevious: String(previousYear),
        ordersCurrent,
        ordersPrevious,
        revenueCurrent,
        revenuePrevious,
      });
      setDistributionHistory(distHistory);
      setTopProducts(topProductsRows);
      setTopProducers(topProducersRows);
      setLoading(false);
    };

    load().catch((error) => {
      reportError("Echec du chargement des statistiques", error);
      setLoading(false);
    });
  }, []);

  const distributionRevenueBars = useMemo(
    () => ({
      labels: distributionHistory.map((item) => item.label),
      values: distributionHistory.map((item) => item.revenue),
    }),
    [distributionHistory],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[10px] border border-clay/90 bg-clay/25 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Statistiques</p>
        <h1 className="mt-1 font-serif text-4xl text-ink">Performance</h1>
        <p className="mt-2 text-sm text-ink/75">Indicateurs historiques, comparatifs annuels et classements.</p>
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-stone p-2">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "overview", label: "Vue globale" },
            { id: "history", label: "Historique" },
            { id: "tops", label: "Classements" },
          ].map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id as "overview" | "history" | "tops")}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                tab === entry.id ? "bg-forest text-white" : "bg-white text-ink hover:bg-forest/10 hover:text-forest"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? <p className="text-sm text-ink/70">Chargement des statistiques...</p> : null}

      {!loading && tab === "overview" ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Adhérents actifs</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(summary.activeMembers)}</p>
            </article>
            <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Commandes</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(summary.orders)}</p>
            </article>
            <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">CA total</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatMoney(summary.revenue)} EUR</p>
            </article>
            <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Panier moyen</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatMoney(summary.avgBasket)} EUR</p>
            </article>
            <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">Articles vendus</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(summary.items)}</p>
            </article>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <article className="rounded-[10px] border border-clay/80 bg-clay/20 p-4">
              <p className="text-sm font-semibold text-ink">Commandes par mois</p>
              <CompareLineChart
                labels={monthly.labels}
                current={monthly.ordersCurrent}
                previous={monthly.ordersPrevious}
                currentLabel={monthly.yearCurrent}
                previousLabel={monthly.yearPrevious}
              />
            </article>
            <article className="rounded-[10px] border border-clay/80 bg-clay/20 p-4">
              <p className="text-sm font-semibold text-ink">CA par mois</p>
              <CompareLineChart
                labels={monthly.labels}
                current={monthly.revenueCurrent}
                previous={monthly.revenuePrevious}
                currentLabel={monthly.yearCurrent}
                previousLabel={monthly.yearPrevious}
                valueFormatter={(value) => `${Math.round(value)}€`}
              />
            </article>
          </section>
        </>
      ) : null}

      {!loading && tab === "history" ? (
        <>
          <section className="rounded-[10px] border border-clay/80 bg-clay/20 p-4">
            <p className="text-sm font-semibold text-ink">CA des 9 dernieres distributions</p>
            <DistributionBars labels={distributionRevenueBars.labels} values={distributionRevenueBars.values} />
          </section>
          <section className="rounded-[10px] border border-clay/80 bg-stone p-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-clay/70 bg-clay/20">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Distribution</th>
                    <th className="px-3 py-2 font-semibold">Commandes</th>
                    <th className="px-3 py-2 font-semibold">Adhérents</th>
                    <th className="px-3 py-2 font-semibold">Articles</th>
                    <th className="px-3 py-2 font-semibold">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {distributionHistory.map((row, index) => (
                    <tr key={`${row.label}-${index}`} className="border-b border-clay/60">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2">{formatNumber(row.orders)}</td>
                      <td className="px-3 py-2">{formatNumber(row.members)}</td>
                      <td className="px-3 py-2">{formatNumber(row.items)}</td>
                      <td className="px-3 py-2">{formatMoney(row.revenue)} EUR</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {!loading && tab === "tops" ? (
        <section className="grid gap-3 xl:grid-cols-2">
          <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
            <p className="text-sm font-semibold text-ink">Top produits (quantite)</p>
            <div className="mt-3 grid gap-2">
              {topProducts.slice(0, 10).map((row, index) => (
                <div key={`${row.productId}-${index}`} className="grid grid-cols-[34px_48px_1fr_90px_90px] items-center gap-2 rounded-md border border-clay/70 bg-white/80 px-2 py-2 text-xs">
                  <span className="font-semibold text-ink/65">#{index + 1}</span>
                  <div className="h-10 w-10 overflow-hidden rounded border border-clay/70 bg-stone">
                    {row.imageUrl ? <img src={row.imageUrl} alt={row.name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <span className="truncate font-semibold text-ink">{row.name}</span>
                  <span className="text-right text-ink/75">{formatNumber(row.qty)}</span>
                  <span className="text-right font-semibold text-ink">{formatMoney(row.revenue)} EUR</span>
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-[10px] border border-clay/80 bg-stone p-4">
            <p className="text-sm font-semibold text-ink">Top producteurs (CA)</p>
            <div className="mt-3 grid gap-2">
              {topProducers.slice(0, 10).map((row, index) => (
                <div key={`${row.producerId}-${index}`} className="grid grid-cols-[34px_1fr_90px_100px] items-center gap-2 rounded-md border border-clay/70 bg-white/80 px-2 py-2 text-xs">
                  <span className="font-semibold text-ink/65">#{index + 1}</span>
                  <span className="truncate font-semibold text-ink">{row.name}</span>
                  <span className="text-right text-ink/75">{formatNumber(row.qty)}</span>
                  <span className="text-right font-semibold text-ink">{formatMoney(row.revenue)} EUR</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
