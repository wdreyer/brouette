"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

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

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

export default function OrdersEditor() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [producers, setProducers] = useState<Record<string, Producer>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ordersSnap, membersSnap, producersSnap] = await Promise.all([
        getDocs(query(collection(firebaseDb, "orders"), orderBy("createdAt", "desc"))),
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">Commandes</h2>
        <p className="mt-2 text-sm text-ink/70">Toutes les commandes passees par les adherents.</p>
      </div>

      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
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
            <p className="text-sm font-semibold text-ink/70">Recap par date & producteur</p>
            <div className="mt-3 flex flex-col gap-4">
              {Object.entries(recapByDateProducer).map(([dateLabel, producersMap]) => (
                <div key={dateLabel} className="rounded-xl border border-clay/70 bg-stone p-3">
                  <p className="text-xs font-semibold text-ink/70">{dateLabel}</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {Object.entries(producersMap).map(([producerId, total]) => (
                      <div key={producerId} className="flex items-center justify-between text-xs text-ink/70">
                        <span>{producers[producerId]?.name ?? producerId}</span>
                        <span className="font-semibold text-ink">{formatMoney(total)} EUR</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-clay/70 bg-white/80 shadow-card">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-clay/70 bg-stone/80">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-ink">Date</th>
                    <th className="px-4 py-3 font-semibold text-ink">Adherent</th>
                    <th className="px-4 py-3 font-semibold text-ink">Email</th>
                    <th className="px-4 py-3 font-semibold text-ink">Total</th>
                    <th className="px-4 py-3 font-semibold text-ink">Articles</th>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
