"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import ProfileForm from "@/components/profile/ProfileForm";
import { firebaseDb } from "@/lib/firebase/client";
import { findMemberByUser } from "@/lib/members";

type Order = {
  id: string;
  distributionId?: string | null;
  memberId?: string | null;
  memberUid?: string | null;
  memberSnapshot?: { email?: string | null };
  totals?: { totalAmount?: number; itemCount?: number };
  createdAt?: { toDate: () => Date };
};

type OrderItem = {
  id: string;
  label?: string;
  variantLabel?: string;
  quantity?: number;
  unitPrice?: number;
  saleDateLabel?: string;
  saleDateKey?: string;
};

type LedgerEntry = {
  id: string;
  type?: string;
  amount?: number;
  label?: string;
  orderId?: string;
  memberId?: string;
  memberUid?: string;
  note?: string;
  occurredAt?: { toDate?: () => Date };
  createdAt?: { toDate?: () => Date };
};

type HistoryRow = {
  id: string;
  kind: string;
  label: string;
  amount: number;
  date: Date;
  note?: string;
};

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function entryDate(entry: LedgerEntry) {
  return entry.occurredAt?.toDate?.() ?? entry.createdAt?.toDate?.() ?? new Date(0);
}

export default function ProfilePage() {
  const { user, memberId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [resolvedMemberId, setResolvedMemberId] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="text-sm text-ink/70">Connecte-toi pour acceder a ton profil.</p>
      </div>
    );
  }

  useEffect(() => {
    const load = async () => {
      setLoadingOrders(true);
      const resolved = memberId ? { id: memberId } : await findMemberByUser(firebaseDb, user);
      const nextMemberId = resolved?.id ?? user.uid;
      setResolvedMemberId(nextMemberId);
      const candidateMemberIds = Array.from(new Set([nextMemberId, user.uid].filter(Boolean)));
      const userEmail = String(user.email ?? "").toLowerCase().trim();

      const ordersSnap = await getDocs(collection(firebaseDb, "orders"));
      const entries = ordersSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Order, "id">) }))
        .filter((order) => {
          const orderMemberId = String(order.memberId ?? "");
          const orderMemberUid = String(order.memberUid ?? "");
          const snapshotEmail = String(order.memberSnapshot?.email ?? "").toLowerCase().trim();
          return (
            candidateMemberIds.includes(orderMemberId) ||
            (orderMemberUid && orderMemberUid === user.uid) ||
            (userEmail && snapshotEmail === userEmail)
          );
        });
      entries.sort((a, b) => {
        const aDate = a.createdAt?.toDate?.() ?? new Date(0);
        const bDate = b.createdAt?.toDate?.() ?? new Date(0);
        return bDate.getTime() - aDate.getTime();
      });
      setOrders(entries);

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

      const ledgerEntries: LedgerEntry[] = [];
      await Promise.all(
        candidateMemberIds.map(async (candidateId) => {
          const ledgerSnap = await getDocs(collection(firebaseDb, "members", candidateId, "ledger"));
          ledgerSnap.docs.forEach((docSnap) => {
            ledgerEntries.push({
              id: `${candidateId}-${docSnap.id}`,
              ...(docSnap.data() as Omit<LedgerEntry, "id">),
            });
          });
        }),
      );
      ledgerEntries.sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime());
      setLedger(ledgerEntries);

      setLoadingOrders(false);
    };

    load().catch(() => setLoadingOrders(false));
  }, [user, memberId]);

  const groupedItems = useMemo(() => {
    const map: Record<string, Record<string, OrderItem[]>> = {};
    orders.forEach((order) => {
      const items = orderItems[order.id] ?? [];
      const groups: Record<string, OrderItem[]> = {};
      items.forEach((item) => {
        const key = item.saleDateLabel ?? item.saleDateKey ?? "Date";
        groups[key] = groups[key] ?? [];
        groups[key].push(item);
      });
      map[order.id] = groups;
    });
    return map;
  }, [orders, orderItems]);

  const historyRows = useMemo(() => {
    const rows: HistoryRow[] = [];
    const ledgerByOrderId = new Set(
      ledger
        .map((entry) => String(entry.orderId ?? ""))
        .filter(Boolean),
    );

    ledger.forEach((entry) => {
      rows.push({
        id: `ledger-${entry.id}`,
        kind: String(entry.type ?? "entry"),
        label: String(entry.label ?? "Mouvement"),
        amount: Number(entry.amount ?? 0),
        date: entryDate(entry),
        note: entry.note,
      });
    });

    orders.forEach((order) => {
      if (ledgerByOrderId.has(order.id)) return;
      rows.push({
        id: `order-${order.id}`,
        kind: "order",
        label: "Commande",
        amount: -Number(order.totals?.totalAmount ?? 0),
        date: order.createdAt?.toDate?.() ?? new Date(0),
      });
    });

    rows.sort((a, b) => b.date.getTime() - a.date.getTime());
    return rows;
  }, [ledger, orders]);

  const balance = useMemo(
    () => historyRows.reduce((sum, row) => sum + row.amount, 0),
    [historyRows],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Profil</p>
        <h1 className="mt-2 font-serif text-3xl">Mes informations</h1>
        <p className="mt-2 text-sm text-ink/70">
          Ces informations sont utilisees pour les commandes et les documents.
        </p>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <ProfileForm userId={resolvedMemberId ?? user.uid} requireEditToggle canEditStatus={false} />
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Mon solde</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <h2 className="font-serif text-3xl">
            {balance >= 0 ? "+" : "-"} {formatMoney(Math.abs(balance))} EUR
          </h2>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-clay/70">
          <div className="grid grid-cols-[130px_1fr_120px] border-b border-clay/70 bg-stone px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            <span>Date</span>
            <span>Mouvement</span>
            <span className="text-right">Montant</span>
          </div>
          <div className="divide-y divide-clay/70">
            {historyRows.length ? (
              historyRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[130px_1fr_120px] items-center px-3 py-2 text-sm">
                  <span className="text-ink/70">{row.date.toLocaleDateString("fr-FR")}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{row.label}</p>
                    {row.note ? <p className="truncate text-xs text-ink/60">{row.note}</p> : null}
                  </div>
                  <span
                    className={`text-right font-semibold ${row.amount >= 0 ? "text-forest" : "text-ember"}`}
                  >
                    {row.amount >= 0 ? "+" : "-"}
                    {formatMoney(Math.abs(row.amount))} EUR
                  </span>
                </div>
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-ink/70">Aucun mouvement.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Historique</p>
        <h2 className="mt-2 font-serif text-2xl">Mes commandes</h2>
        {loadingOrders ? (
          <p className="mt-4 text-sm text-ink/70">Chargement...</p>
        ) : orders.length === 0 ? (
          <p className="mt-4 text-sm text-ink/70">Aucune commande pour le moment.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {orders.map((order) => (
              <div key={order.id} className="rounded-xl border border-clay/70 bg-stone p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-ink/70">
                      Commande{" "}
                      {order.createdAt?.toDate
                        ? order.createdAt.toDate().toLocaleDateString("fr-FR")
                        : ""}
                    </p>
                    <p className="text-[11px] text-ink/60">{order.totals?.itemCount ?? 0} articles</p>
                  </div>
                  <span className="text-sm font-semibold text-ink">
                    {formatMoney(order.totals?.totalAmount ?? 0)} EUR
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {Object.entries(groupedItems[order.id] ?? {}).map(([label, items]) => (
                    <div key={label} className="rounded-lg border border-clay/70 bg-white p-3">
                      <p className="text-xs font-semibold text-ink/70">{label}</p>
                      <div className="mt-2 flex flex-col gap-1 text-xs text-ink/70">
                        {items.map((item) => (
                          <span key={item.id}>
                            {item.quantity} x {item.label} {item.variantLabel ? `(${item.variantLabel})` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
