"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, addDoc, doc, getDocs, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { CartItem, clearCart, getCart, removeFromCart, updateCartItem } from "@/lib/cart";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";
import { useAuth } from "@/components/auth/AuthProvider";

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

export default function CheckoutPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setItems(getCart());
    const onStorage = () => setItems(getCart());
    window.addEventListener("cart:updated", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("cart:updated", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const grouped = useMemo(() => groupByDate(items), [items]);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );

  const submitOrder = async () => {
    if (!user) return;
    if (items.length === 0) return;
    setSubmitting(true);
    setMessage("");
    try {
      const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      const distItems = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Record<string, unknown>),
      }));
      const openDist = pickOpenDistribution(
        distItems as {
          id: string;
          status?: string;
          dates?: { toDate?: () => Date }[];
          openedAt?: { toDate?: () => Date };
        }[],
      );
      const distributionId = openDist?.id ?? null;
      const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

      const orderRef = await addDoc(collection(firebaseDb, "orders"), {
        distributionId,
        memberId: user.uid,
        status: "validated",
        totals: { totalAmount: total, itemCount },
        createdAt: serverTimestamp(),
        validatedAt: serverTimestamp(),
      });

      const itemsCollection = collection(firebaseDb, "orders", orderRef.id, "items");
      await Promise.all(
        items.map((item) =>
          addDoc(itemsCollection, {
            offerItemId: item.offerItemId ?? null,
            producerId: item.producerId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.unitPrice * item.quantity,
            label: item.name,
            variantLabel: item.variantLabel,
            saleDateKey: item.saleDateKey ?? null,
            saleDateLabel: item.saleDateLabel ?? null,
          }),
        ),
      );

      clearCart();
      router.replace("/profil");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <section className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Panier</p>
        <h1 className="font-serif text-4xl">Relecture de la commande</h1>
        <p className="text-sm text-ink/70">
          Verifie les dates et les quantites avant de valider. Paiement sur place.
        </p>
      </section>

      {items.length === 0 ? (
        <div className="rounded-xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-sm text-ink/70">Ton panier est vide.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
          <div className="flex flex-col gap-5">
            {grouped.map(([key, groupItems]) => {
              const label = groupItems[0]?.saleDateLabel ?? "Date non definie";
              const groupTotal = groupItems.reduce(
                (sum, item) => sum + item.unitPrice * item.quantity,
                0,
              );
              return (
                <section
                  key={key}
                  className="rounded-xl border border-clay/70 bg-white/95 p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-serif text-2xl">{label}</h2>
                    <span className="text-sm font-semibold text-ink">
                      {formatMoney(groupTotal)} EUR
                    </span>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-lg border border-clay/70">
                    <div className="hidden grid-cols-[1.5fr_0.6fr_0.6fr_0.6fr_0.3fr] gap-3 border-b border-clay/70 bg-stone px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60 md:grid">
                      <span>Produit</span>
                      <span>PU</span>
                      <span>Qt</span>
                      <span>Total</span>
                      <span />
                    </div>
                    <div className="divide-y divide-clay/70">
                      {groupItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-3 px-4 py-3 md:grid-cols-[1.5fr_0.6fr_0.6fr_0.6fr_0.3fr]"
                        >
                          <div>
                            <p className="text-sm font-semibold text-ink">{item.name}</p>
                            <p className="text-xs text-ink/60">{item.variantLabel}</p>
                          </div>
                          <div className="text-sm font-semibold">{formatMoney(item.unitPrice)} EUR</div>
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
                          <div className="text-sm font-semibold">
                            {formatMoney(item.unitPrice * item.quantity)} EUR
                          </div>
                          <button
                            className="text-xs text-ink/50 underline"
                            onClick={() => removeFromCart(item.id)}
                          >
                            Retirer
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="h-fit rounded-xl border border-clay/70 bg-white/95 p-5 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">Total</p>
            <div className="mt-2 flex items-center justify-between text-lg font-semibold text-ink">
              <span>Commande</span>
              <span>{formatMoney(total)} EUR</span>
            </div>
            <p className="mt-2 text-xs text-ink/60">
              Paiement sur place lors du retrait. Tu peux modifier les quantites avant validation.
            </p>
            {message ? <p className="mt-2 text-xs text-ember">{message}</p> : null}
            <button
              className="mt-4 w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-stone shadow-sm"
              onClick={submitOrder}
              disabled={submitting || !user}
            >
              {submitting ? "Validation..." : "Valider la commande"}
            </button>
            <button
              className="mt-2 w-full rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink"
              onClick={() => clearCart()}
            >
              Vider le panier
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
