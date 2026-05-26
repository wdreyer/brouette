"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { collection, getDocs } from "firebase/firestore";
import { CartItem, clearCart, getCart, removeFromCart, subscribeCart, updateCartItem } from "@/lib/cart";
import { firebaseDb } from "@/lib/firebase/client";
import { reconcileCartWithOpenSale } from "@/lib/cartReconcile";

type CartDrawerProps = {
  open: boolean;
  onClose: () => void;
};

type ProducerGroup = {
  producerId: string;
  producerLabel: string;
  items: CartItem[];
  total: number;
};

type DateGroup = {
  key: string;
  label: string;
  producers: ProducerGroup[];
  total: number;
};

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function formatEstimatedRange(min?: number | null, max?: number | null) {
  const hasMin = typeof min === "number" && min >= 0;
  const hasMax = typeof max === "number" && max >= 0;
  if (!hasMin && !hasMax) return "Prix final au retrait";
  if (hasMin && hasMax) {
    return min === max
      ? `Estimatif: ${min.toFixed(2)} EUR`
      : `Estimatif: ${min.toFixed(2)} EUR - ${max.toFixed(2)} EUR`;
  }
  if (hasMin) return `Estimatif : à partir de ${min!.toFixed(2)} EUR`;
  return `Estimatif : jusqu'à ${max!.toFixed(2)} EUR`;
}

function groupByDateThenProducer(
  items: CartItem[],
  producerLabelById: Record<string, string>,
): DateGroup[] {
  const byDate = new Map<string, { label: string; byProducer: Map<string, CartItem[]> }>();

  items.forEach((item) => {
    const dateKey = item.saleDateKey ?? "no-date";
    const dateLabel = item.saleDateLabel ?? "Date non definie";
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { label: dateLabel, byProducer: new Map<string, CartItem[]>() });
    }
    const dateGroup = byDate.get(dateKey)!;
    const producerId = item.producerId || "unknown";
    const producerItems = dateGroup.byProducer.get(producerId) ?? [];
    producerItems.push(item);
    dateGroup.byProducer.set(producerId, producerItems);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, dateGroup]) => {
      const producers = Array.from(dateGroup.byProducer.entries())
        .map(([producerId, producerItems]) => {
          const producerLabel =
            producerLabelById[producerId] ?? (producerId === "unknown" ? "Producteur" : producerId);
          const total = producerItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
          return { producerId, producerLabel, items: producerItems, total };
        })
        .sort((a, b) => a.producerLabel.localeCompare(b.producerLabel, "fr", { sensitivity: "base" }));

      return {
        key,
        label: dateGroup.label,
        producers,
        total: producers.reduce((sum, producer) => sum + producer.total, 0),
      };
    });
}

export default function CartDrawer({ open, onClose }: CartDrawerProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const [producerLabelById, setProducerLabelById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      await reconcileCartWithOpenSale().catch(() => undefined);
      if (cancelled) return;
      setItems(getCart());
    };
    refresh().catch(() => undefined);
    const unsubscribe = subscribeCart(() => {
      refresh().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    reconcileCartWithOpenSale()
      .then(() => setItems(getCart()))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const loadProducers = async () => {
      const snap = await getDocs(collection(firebaseDb, "producers"));
      const map: Record<string, string> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as { name?: string };
        map[docSnap.id] = String(data.name ?? docSnap.id);
      });
      setProducerLabelById(map);
    };
    loadProducers().catch(() => undefined);
  }, []);

  const grouped = useMemo(
    () => groupByDateThenProducer(items, producerLabelById),
    [items, producerLabelById],
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col gap-6 border-l border-clay/80 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Panier</p>
            <h2 className="font-serif text-2xl">Commande en cours</h2>
          </div>
          <button
            className="rounded-full border border-ink/20 bg-stone px-3 py-1 text-xs font-semibold"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-ink/70">Ton panier est vide.</p>
        ) : (
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto pr-1">
            {grouped.map((dateGroup) => (
              <div key={dateGroup.key} className="rounded-2xl border border-clay/80 bg-stone p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">{dateGroup.label}</p>
                  <span className="text-xs font-semibold text-ink/70">
                    {formatMoney(dateGroup.total)} EUR
                  </span>
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  {dateGroup.producers.map((producerGroup) => (
                    <div
                      key={`${dateGroup.key}-${producerGroup.producerId}`}
                      className="rounded-xl border border-clay/70 bg-white/70 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/60">
                          {producerGroup.producerLabel}
                        </p>
                        <span className="text-[11px] font-semibold text-ink">
                          {formatMoney(producerGroup.total)} EUR
                        </span>
                      </div>

                      <div className="mt-2 flex flex-col gap-2">
                        {producerGroup.items.map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-ink">{item.name}</p>
                              <p className="text-xs text-ink/60">{item.variantLabel}</p>
                              {item.isSoldByWeight ? (
                                <p className="text-xs text-ink/55">
                                  Produit au poids - {formatEstimatedRange(item.estimatedPriceMin, item.estimatedPriceMax)}
                                </p>
                              ) : null}
                              <p className={`text-xs ${item.isSoldByWeight ? "text-ink/50" : "text-ink/60"}`}>
                                {item.isSoldByWeight ? "0,00 EUR / unité" : `${formatMoney(item.unitPrice)} EUR / unité`}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center gap-2">
                                <button
                                  className="h-7 w-7 rounded-full border border-ink/20 bg-white text-xs font-semibold"
                                  onClick={() => updateCartItem(item.id, item.quantity - 1)}
                                  disabled={item.quantity <= 1}
                                >
                                  -
                                </button>
                                <span className="w-6 text-center text-xs font-semibold text-ink">
                                  {item.quantity}
                                </span>
                                <button
                                  className="h-7 w-7 rounded-full border border-ink/20 bg-white text-xs font-semibold"
                                  onClick={() => updateCartItem(item.id, item.quantity + 1)}
                                >
                                  +
                                </button>
                              </div>
                              <p className="text-xs font-semibold text-ink">
                                {formatMoney(item.unitPrice * item.quantity)} EUR
                              </p>
                              <button
                                className="text-xs text-ink/50 underline"
                                onClick={() => removeFromCart(item.id)}
                              >
                                Retirer
                              </button>
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
        )}

        <div className="border-t border-clay/70 pt-4">
          <div className="flex items-center justify-between text-sm font-semibold text-ink">
            <span>Total</span>
            <span>{formatMoney(total)} EUR</span>
          </div>
          <p className="mt-2 text-xs text-ink/60">
            Paiement sur place. Pense à valider ta commande avant la fermeture de la vente.
          </p>
          <a
            href="/checkout"
            className="mt-3 block w-full rounded-full bg-ink px-4 py-3 text-center text-sm font-semibold text-stone shadow-sm"
          >
            Récapitulatif de la commande
          </a>
          <button
            className="mt-2 w-full rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink"
            onClick={() => clearCart()}
          >
            Vider le panier
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
