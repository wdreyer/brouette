"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";

type Order = {
  id: string;
  memberId?: string;
  distributionId?: string | null;
  totals?: { totalAmount?: number; itemCount?: number };
  createdAt?: { toDate: () => Date };
};

type OrderItem = {
  id: string;
  saleDateKey?: string | null;
  saleDateLabel?: string | null;
  producerId?: string;
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  label?: string;
  variantLabel?: string;
};

type Member = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type Producer = {
  id: string;
  name?: string;
};

type TrendPoint = {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  items: number;
};

type Distribution = {
  id: string;
  dates?: { toDate: () => Date }[];
};

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function ChartCard({
  title,
  series,
  valueKey,
}: {
  title: string;
  series: TrendPoint[];
  valueKey: "orders" | "revenue" | "items";
}) {
  const values = series.map((point) => point[valueKey]);
  const maxValue = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + Number(value), 0);
  const displayValue = valueKey === "revenue" ? `${formatMoney(total)} EUR` : String(total);

  return (
    <article className="rounded-xl border border-clay/70 bg-stone p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{displayValue}</p>
      <div className="mt-3 flex h-24 items-end gap-2">
        {series.map((point) => {
          const value = Number(point[valueKey]);
          const heightPx = value > 0 ? Math.max(10, Math.round((value / maxValue) * 84)) : 4;
          return (
            <div
              key={`${valueKey}-${point.key}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[10px] font-semibold text-ink/70">
                {valueKey === "revenue" ? `${Math.round(value)}€` : value}
              </span>
              <div
                className={`w-full rounded-sm ${value > 0 ? "bg-forest/70" : "bg-forest/20"}`}
                style={{ height: `${heightPx}px` }}
                title={`${point.label}: ${valueKey === "revenue" ? `${formatMoney(value)} EUR` : value}`}
              />
              <span className="text-[10px] text-ink/60">{point.label}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function OrdersEditor() {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === "admin";
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [producers, setProducers] = useState<Record<string, Producer>>({});
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [openedOrderId, setOpenedOrderId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ordersSnap, membersSnap, producersSnap, distSnap] = await Promise.all([
        getDocs(query(collection(firebaseDb, "orders"), orderBy("createdAt", "desc"))),
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      const entries = ordersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Order, "id">),
      }));
      setOrders(entries);

      const memberMap: Record<string, Member> = {};
      membersSnap.docs.forEach((docSnap) => {
        memberMap[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Member, "id">) };
      });
      setMembers(memberMap);

      const producerMap: Record<string, Producer> = {};
      producersSnap.docs.forEach((docSnap) => {
        producerMap[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Producer, "id">) };
      });
      setProducers(producerMap);

      const distributionItems = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Distribution, "id">),
      }));
      distributionItems.sort((a, b) => {
        const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
        const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });
      setDistributions(distributionItems);

      const itemsMap: Record<string, OrderItem[]> = {};
      await Promise.all(
        entries.map(async (order) => {
          const itemsSnap = await getDocs(collection(firebaseDb, "orders", order.id, "items"));
          itemsMap[order.id] = itemsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<OrderItem, "id">),
          }));
        }),
      );
      setOrderItems(itemsMap);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, []);

  const recapByDate = useMemo(() => {
    const map: Record<string, { total: number; members: Set<string> }> = {};
    Object.entries(orderItems).forEach(([orderId, items]) => {
      const memberId = orders.find((order) => order.id === orderId)?.memberId ?? "unknown";
      items.forEach((item) => {
        const key = item.saleDateLabel ?? item.saleDateKey ?? "Date";
        if (!map[key]) map[key] = { total: 0, members: new Set() };
        map[key].total += item.lineTotal ?? 0;
        map[key].members.add(memberId);
      });
    });
    return Object.entries(map).map(([label, data]) => ({
      label,
      total: data.total,
      members: data.members.size,
    }));
  }, [orderItems, orders]);

  const recapByDateProducer = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    Object.values(orderItems).forEach((items) => {
      items.forEach((item) => {
        const dateKey = item.saleDateLabel ?? item.saleDateKey ?? "Date";
        const producerId = item.producerId ?? "unknown";
        map[dateKey] = map[dateKey] ?? {};
        map[dateKey][producerId] = (map[dateKey][producerId] ?? 0) + (item.lineTotal ?? 0);
      });
    });
    return map;
  }, [orderItems]);

  const trends = useMemo(() => {
    const recentDistributions = [...distributions].slice(-9);
    const totalsByDate = new Map<string, { members: Set<string>; revenue: number; items: number }>();

    orders.forEach((order) => {
      const lines = orderItems[order.id] ?? [];
      const byDate = new Map<string, { revenue: number; items: number }>();
      lines.forEach((line) => {
        const key = String(line.saleDateKey ?? "");
        if (!key) return;
        const current = byDate.get(key) ?? { revenue: 0, items: 0 };
        current.revenue += Number(line.lineTotal ?? 0);
        current.items += Number(line.quantity ?? 0);
        byDate.set(key, current);
      });
      const memberKey = order.memberId ? String(order.memberId) : `order:${order.id}`;
      byDate.forEach((dateTotals, key) => {
        const current = totalsByDate.get(key) ?? { members: new Set<string>(), revenue: 0, items: 0 };
        current.members.add(memberKey);
        current.revenue += dateTotals.revenue;
        current.items += dateTotals.items;
        totalsByDate.set(key, current);
      });
    });

    const points: TrendPoint[] = [];
    recentDistributions.forEach((distribution) => {
      const dates = (distribution.dates ?? []).slice(0, 3).map((d) => d.toDate()).filter(Boolean);
      dates.forEach((date, index) => {
        const key = dateKey(date);
        const totals = totalsByDate.get(key);
        points.push({
          key: `${distribution.id}-${key}-${index}`,
          label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
          orders: totals?.members.size ?? 0,
          revenue: totals?.revenue ?? 0,
          items: totals?.items ?? 0,
        });
      });
    });
    return points;
  }, [orders, orderItems, distributions]);

  const openedOrder = useMemo(
    () => orders.find((order) => order.id === openedOrderId) ?? null,
    [orders, openedOrderId],
  );
  const openedItems = useMemo(
    () => (openedOrderId ? orderItems[openedOrderId] ?? [] : []),
    [orderItems, openedOrderId],
  );
  const openedGroupedItems = useMemo(() => {
    const byDate = new Map<string, { dateLabel: string; byProducer: Map<string, OrderItem[]> }>();
    openedItems.forEach((item) => {
      const dateKey = item.saleDateKey ?? "no-date";
      const dateLabel = item.saleDateLabel ?? item.saleDateKey ?? "Date";
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { dateLabel, byProducer: new Map<string, OrderItem[]>() });
      }
      const dateGroup = byDate.get(dateKey)!;
      const producerId = item.producerId ?? "unknown";
      const producerItems = dateGroup.byProducer.get(producerId) ?? [];
      producerItems.push(item);
      dateGroup.byProducer.set(producerId, producerItems);
    });

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, dateGroup]) => {
        const producersGroups = Array.from(dateGroup.byProducer.entries())
          .map(([producerId, items]) => {
            const producerLabel =
              producerId === "unknown"
                ? "Producteur"
                : producers[producerId]?.name ?? producerId;
            const total = items.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
            return { producerId, producerLabel, items, total };
          })
          .sort((a, b) => a.producerLabel.localeCompare(b.producerLabel, "fr", { sensitivity: "base" }));

        return {
          dateKey,
          dateLabel: dateGroup.dateLabel,
          producersGroups,
          total: producersGroups.reduce((sum, producerGroup) => sum + producerGroup.total, 0),
        };
      });
  }, [openedItems, producers]);

  const deleteOrderEverywhere = async (order: Order) => {
    if (!isAdmin) return;
    const confirmDelete =
      typeof window === "undefined"
        ? true
        : window.confirm(
            "Supprimer cette commande ? Cette action efface la commande, ses lignes et les écritures de solde liées.",
          );
    if (!confirmDelete) return;

    setDeletingOrderId(order.id);
    setDeleteMessage("");
    try {
      const itemsSnap = await getDocs(collection(firebaseDb, "orders", order.id, "items"));
      let ledgerRefs: Array<ReturnType<typeof doc>> = [];
      let ledgerWarning = "";
      if (order.memberId) {
        try {
          const memberLedgerSnap = await getDocs(
            query(
              collection(firebaseDb, "members", order.memberId, "ledger"),
              where("orderId", "==", order.id),
            ),
          );
          ledgerRefs = memberLedgerSnap.docs.map((docSnap) => docSnap.ref);
        } catch {
          ledgerWarning =
            " (ecritures de solde non supprimees: droits insuffisants sur members/{id}/ledger)";
        }
      }

      const refsToDelete = [
        ...itemsSnap.docs.map((docSnap) => docSnap.ref),
        ...ledgerRefs,
        doc(firebaseDb, "orders", order.id),
      ];

      const chunkSize = 400;
      for (let index = 0; index < refsToDelete.length; index += chunkSize) {
        const batch = writeBatch(firebaseDb);
        refsToDelete.slice(index, index + chunkSize).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      setOrders((prev) => prev.filter((entry) => entry.id !== order.id));
      setOrderItems((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      if (openedOrderId === order.id) setOpenedOrderId(null);
      setDeleteMessage(`Commande supprimee (commande + lignes)${ledgerWarning}.`);
    } catch {
      setDeleteMessage("Erreur lors de la suppression de la commande.");
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">Commandes</h2>
        <p className="mt-2 text-sm text-ink/70">Toutes les commandes passees par les adherents.</p>
        {deleteMessage ? <p className="mt-2 text-xs text-ink/70">{deleteMessage}</p> : null}
      </div>

      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
          <div className="rounded-2xl border border-clay/70 bg-white/90 p-4 shadow-card">
            <p className="text-sm font-semibold text-ink/70">Evolutions par date de distribution</p>
            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              <ChartCard title="Commandes" series={trends} valueKey="orders" />
              <ChartCard title="Chiffre d'affaires" series={trends} valueKey="revenue" />
              <ChartCard title="Articles commandes" series={trends} valueKey="items" />
            </div>
          </div>

          <div className="rounded-2xl border border-clay/70 bg-white/90 p-4 shadow-card">
            <p className="text-sm font-semibold text-ink/70">Recap par date</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {recapByDate.map((item) => (
                <div key={item.label} className="rounded-xl border border-clay/70 bg-stone p-3">
                  <p className="text-xs font-semibold text-ink/70">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{formatMoney(item.total)} EUR</p>
                  <p className="text-[11px] text-ink/60">{item.members} membres</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-clay/70 bg-white/90 p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink/70">Recap par date & producteur</p>
              <p className="text-xs font-semibold text-ink">
                Total global:{" "}
                {formatMoney(
                  Object.values(recapByDateProducer).reduce(
                    (sum, producersMap) =>
                      sum +
                      Object.values(producersMap).reduce((localSum, value) => localSum + value, 0),
                    0,
                  ),
                )}{" "}
                EUR
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-4">
              {Object.entries(recapByDateProducer).map(([dateLabel, producersMap]) => {
                const dateTotal = Object.values(producersMap).reduce((sum, value) => sum + value, 0);
                return (
                <div key={dateLabel} className="rounded-xl border border-clay/70 bg-stone p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-ink/70">{dateLabel}</p>
                    <p className="text-xs font-semibold text-ink">{formatMoney(dateTotal)} EUR</p>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {Object.entries(producersMap)
                      .sort((a, b) => {
                        const aName = producers[a[0]]?.name ?? a[0];
                        const bName = producers[b[0]]?.name ?? b[0];
                        return aName.localeCompare(bName);
                      })
                      .map(([producerId, total]) => (
                        <div
                          key={producerId}
                          className="flex items-center justify-between rounded-md border border-clay/60 bg-white/70 px-3 py-2 text-xs text-ink/80"
                        >
                          <span className="truncate pr-2">{producers[producerId]?.name ?? producerId}</span>
                          <span className="shrink-0 font-semibold text-ink">{formatMoney(total)} EUR</span>
                        </div>
                      ))}
                  </div>
                </div>
              )})}
            </div>
          </div>

          <div className="rounded-2xl border border-clay/70 bg-white/80 shadow-card">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-clay/70 bg-stone/80">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-ink">Date</th>
                    <th className="px-4 py-3 font-semibold text-ink">Adhérent</th>
                    <th className="px-4 py-3 font-semibold text-ink">Email</th>
                    <th className="px-4 py-3 font-semibold text-ink">Total</th>
                    <th className="px-4 py-3 font-semibold text-ink">Articles</th>
                    <th className="px-4 py-3 font-semibold text-ink">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const member = order.memberId ? members[order.memberId] : undefined;
                    return (
                      <tr key={order.id} className="border-b border-clay/50">
                        <td className="px-4 py-3">
                          {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString("fr-FR") : "-"}
                        </td>
                        <td className="px-4 py-3">
                          {member ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() : "-"}
                        </td>
                        <td className="px-4 py-3">{member?.email ?? "-"}</td>
                        <td className="px-4 py-3">
                          {formatMoney(order.totals?.totalAmount ?? 0)} EUR
                        </td>
                        <td className="px-4 py-3">{order.totals?.itemCount ?? 0}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label="Voir la commande"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-clay/80 bg-white text-ink transition hover:border-forest/60 hover:text-forest"
                              onClick={() => setOpenedOrderId(order.id)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                              >
                                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            {isAdmin ? (
                              <button
                                type="button"
                                aria-label="Supprimer la commande"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ember/40 bg-white text-ember transition hover:bg-ember/10 disabled:opacity-50"
                                onClick={() => deleteOrderEverywhere(order)}
                                disabled={deletingOrderId === order.id}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="h-4 w-4"
                                >
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M19 6l-1 14H6L5 6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {openedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-clay/80 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-clay/70 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">Detail commande</p>
                <h3 className="mt-1 font-serif text-2xl text-ink">
                  {openedOrder.createdAt?.toDate
                    ? openedOrder.createdAt.toDate().toLocaleDateString("fr-FR")
                    : "Sans date"}
                </h3>
              </div>
              <button
                type="button"
                className="rounded-full border border-clay/80 px-3 py-1 text-sm font-semibold text-ink hover:border-ink/40"
                onClick={() => setOpenedOrderId(null)}
              >
                Fermer
              </button>
            </div>
            <div className="grid gap-3 border-b border-clay/70 px-5 py-3 text-sm text-ink/80 md:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Adhérent</p>
                <p className="font-semibold">
                  {openedOrder.memberId
                    ? `${members[openedOrder.memberId]?.firstName ?? ""} ${members[openedOrder.memberId]?.lastName ?? ""}`.trim() || "-"
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Email</p>
                <p className="font-semibold">
                  {openedOrder.memberId ? members[openedOrder.memberId]?.email ?? "-" : "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Total</p>
                <p className="font-semibold">{formatMoney(openedOrder.totals?.totalAmount ?? 0)} EUR</p>
              </div>
            </div>
            <div className="max-h-[56vh] overflow-auto">
              <div className="space-y-3 px-4 py-4">
                {openedGroupedItems.map((dateGroup) => (
                  <div key={dateGroup.dateKey} className="rounded-lg border border-clay/70 bg-stone p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-ink/70">{dateGroup.dateLabel}</p>
                      <p className="text-xs font-semibold text-ink">
                        Sous-total: {formatMoney(dateGroup.total)} EUR
                      </p>
                    </div>
                    <div className="mt-2 space-y-2">
                      {dateGroup.producersGroups.map((producerGroup) => (
                        <div
                          key={`${dateGroup.dateKey}-${producerGroup.producerId}`}
                          className="rounded-md border border-clay/60 bg-white px-3 py-2"
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/60">
                              {producerGroup.producerLabel}
                            </p>
                            <p className="text-xs font-semibold text-ink">
                              {formatMoney(producerGroup.total)} EUR
                            </p>
                          </div>
                          <div className="space-y-2">
                            {producerGroup.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-start justify-between gap-3 rounded-md border border-clay/40 bg-white px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-ink">{item.label ?? "-"}</p>
                                  <p className="text-xs text-ink/60">{item.variantLabel ?? "-"}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-xs text-ink/60">
                                    {item.quantity ?? 0} × {formatMoney(item.unitPrice ?? 0)} EUR
                                  </p>
                                  <p className="font-semibold text-ink">
                                    {formatMoney(item.lineTotal ?? 0)} EUR
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-clay/70 bg-white/85 px-5 py-3 text-right">
                <p className="text-sm font-semibold text-ink">
                  Total commande: {formatMoney(openedOrder.totals?.totalAmount ?? 0)} EUR
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
