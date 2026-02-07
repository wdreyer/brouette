"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import ProfileForm from "@/components/profile/ProfileForm";
import { firebaseDb } from "@/lib/firebase/client";

type Order = {
  id: string;
  distributionId?: string | null;
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

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({});
  const [loadingOrders, setLoadingOrders] = useState(true);

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
      const ordersSnap = await getDocs(
        query(collection(firebaseDb, "orders"), where("memberId", "==", user.uid)),
      );
      const entries = ordersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Order, "id">),
      }));
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
      setLoadingOrders(false);
    };

    load().catch(() => setLoadingOrders(false));
  }, [user.uid]);

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Profil</p>
        <h1 className="mt-2 font-serif text-3xl">Mes informations</h1>
        <p className="mt-2 text-sm text-ink/70">
          Ces informations seront utilisees pour les commandes et les documents.
        </p>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <ProfileForm userId={user.uid} />
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
          Historique
        </p>
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
                    <p className="text-[11px] text-ink/60">
                      {order.totals?.itemCount ?? 0} articles
                    </p>
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
                            {item.quantity} × {item.label} {item.variantLabel ? `(${item.variantLabel})` : ""}
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
