"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CartItem, clearCart, getCart, removeFromCart, subscribeCart, updateCartItem } from "@/lib/cart";

type CartDrawerProps = {
  open: boolean;
  onClose: () => void;
};

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function groupByDate(items: CartItem[]) {
  const groups = new Map<string, CartItem[]>();
  items.forEach((item) => {
    const key = item.saleDateKey ?? "no-date";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function CartDrawer({ open, onClose }: CartDrawerProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setItems(getCart());
    const unsubscribe = subscribeCart(() => setItems(getCart()));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const grouped = useMemo(() => groupByDate(items), [items]);
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
            {grouped.map(([key, groupItems]) => {
              const label = groupItems[0]?.saleDateLabel ?? "Date non definie";
              const groupTotal = groupItems.reduce(
                (sum, item) => sum + item.unitPrice * item.quantity,
                0,
              );
              return (
                <div key={key} className="rounded-2xl border border-clay/80 bg-stone p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">{label}</p>
                    <span className="text-xs font-semibold text-ink/70">
                      {formatMoney(groupTotal)} EUR
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    {groupItems.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{item.name}</p>
                          <p className="text-xs text-ink/60">{item.variantLabel}</p>
                          <p className="text-xs text-ink/60">
                            {formatMoney(item.unitPrice)} EUR / unite
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
              );
            })}
          </div>
        )}

        <div className="border-t border-clay/70 pt-4">
          <div className="flex items-center justify-between text-sm font-semibold text-ink">
            <span>Total</span>
            <span>{formatMoney(total)} EUR</span>
          </div>
          <p className="mt-2 text-xs text-ink/60">
            Paiement sur place. Pense a valider ta commande avant la fermeture de la vente.
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
