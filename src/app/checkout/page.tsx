"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { CartItem, clearCart, getCart, removeFromCart, updateCartItem } from "@/lib/cart";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";
import { useAuth } from "@/components/auth/AuthProvider";
import { findMemberByUser } from "@/lib/members";
import { readBalanceTrackingEnabled } from "@/lib/balanceTracking";
import { reconcileCartWithOpenSale } from "@/lib/cartReconcile";
import { checkCartAgainstLimits } from "@/lib/orderLimits";
import { reportError } from "@/lib/reportError";
import { estimatedUnitPrice, estimateWeightedItemsTotal, hasWeightedEstimate } from "@/lib/orderEstimates";

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

function formatEstimatedPrice(min?: number | null, max?: number | null) {
  const estimate = estimatedUnitPrice(min, max);
  if (estimate === null) return "Prix final au retrait";
  return `Prix estime : ~${formatMoney(estimate)} EUR`;
}

function estimatedLineTotal(item: CartItem) {
  const estimate = estimatedUnitPrice(item.estimatedPriceMin, item.estimatedPriceMax);
  return estimate === null ? null : estimate * item.quantity;
}

function groupByDateThenProducer(
  items: CartItem[],
  producerLabelById: Record<string, string>,
): DateGroup[] {
  const byDate = new Map<string, { label: string; byProducer: Map<string, CartItem[]> }>();

  items.forEach((item) => {
    const dateKey = item.saleDateKey ?? "no-date";
    const dateLabel = item.saleDateLabel ?? "Date non définie";
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

export default function CheckoutPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [producerLabelById, setProducerLabelById] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const { user, memberId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      await reconcileCartWithOpenSale().catch((error) =>
        reportError("Echec de la synchronisation du panier", error, { silent: true }),
      );
      if (cancelled) return;
      setItems(getCart());
    };
    const onStorage = () => {
      refresh().catch(() => undefined);
    };
    refresh().catch(() => undefined);
    window.addEventListener("cart:updated", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("cart:updated", onStorage);
      window.removeEventListener("storage", onStorage);
    };
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
    loadProducers().catch((error) => reportError("Echec du chargement des producteurs", error, { silent: true }));
  }, []);

  const grouped = useMemo(
    () => groupByDateThenProducer(items, producerLabelById),
    [items, producerLabelById],
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );
  const weightedEstimateTotal = useMemo(() => estimateWeightedItemsTotal(items), [items]);
  const hasWeightEstimate = useMemo(() => hasWeightedEstimate(items), [items]);

  const submitOrder = async () => {
    if (!user) return;
    setSubmitting(true);
    setMessage("");
    try {
      await reconcileCartWithOpenSale();
      const freshItems = getCart();
      setItems(freshItems);
      if (freshItems.length === 0) {
        setMessage("Panier vide ou vente fermée. Ajoute de nouveaux produits.");
        return;
      }

      const memberMatch = memberId ? { id: memberId } : await findMemberByUser(firebaseDb, user);
      const orderMemberId = memberMatch?.id ?? user.uid;

      const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      const distItems = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Record<string, unknown>),
      }));
      const resolvedOpenDist = pickOpenDistribution(
        distItems as {
          id: string;
          status?: string;
          dates?: { toDate?: () => Date }[];
          openedAt?: { toDate?: () => Date };
          closeAt?: { toDate?: () => Date };
        }[],
      );
      if (!resolvedOpenDist) {
        setMessage("Aucune vente ouverte. Impossible de valider la commande.");
        return;
      }

      const distributionId = resolvedOpenDist.id;

      const limitCheck = await checkCartAgainstLimits(firebaseDb, distributionId, freshItems);
      if (!limitCheck.ok) {
        setMessage(limitCheck.message);
        return;
      }

      const itemCount = freshItems.reduce((sum, item) => sum + item.quantity, 0);
      const freshTotal = freshItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const freshWeightedEstimateTotal = estimateWeightedItemsTotal(freshItems);

      const orderRef = await addDoc(collection(firebaseDb, "orders"), {
        distributionId,
        memberId: orderMemberId,
        memberUid: user.uid,
        status: "validated",
        totals: {
          totalAmount: freshTotal,
          itemCount,
          weightedEstimatedAmount: freshWeightedEstimateTotal,
          estimatedTotalAmount: freshTotal + freshWeightedEstimateTotal,
        },
        memberSnapshot: {
          email: user.email ?? null,
        },
        createdAt: serverTimestamp(),
        validatedAt: serverTimestamp(),
      });

      const itemsCollection = collection(firebaseDb, "orders", orderRef.id, "items");
      await Promise.all(
        freshItems.map((item) =>
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
            isSoldByWeight: Boolean(item.isSoldByWeight),
            estimatedPriceMin: item.isSoldByWeight ? item.estimatedPriceMin ?? null : null,
            estimatedPriceMax: item.isSoldByWeight ? item.estimatedPriceMax ?? null : null,
          }),
        ),
      );

      await fetch("/api/orders/confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderRef.id }),
      }).catch((error) =>
        reportError("Echec de l'envoi de l'email de confirmation", error, { silent: true }),
      );

      const balanceTrackingEnabled = await readBalanceTrackingEnabled(firebaseDb);
      if (balanceTrackingEnabled) {
        await addDoc(collection(firebaseDb, "members", orderMemberId, "ledger"), {
          type: "order",
          amount: -freshTotal,
          label: "Commande",
          orderId: orderRef.id,
          memberUid: user.uid,
          memberId: orderMemberId,
          createdAt: serverTimestamp(),
          occurredAt: serverTimestamp(),
        });
      }

      clearCart();
      router.replace("/profil");
    } catch (error) {
      console.error("submitOrder failed", error);
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
          Vérifie les dates, les producteurs et les quantités avant de valider.
        </p>
      </section>

      {items.length === 0 ? (
        <div className="rounded-xl border border-clay/70 bg-white/90 p-6 shadow-card">
          <p className="text-sm text-ink/70">Ton panier est vide.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
          <div className="flex flex-col gap-5">
            {grouped.map((dateGroup) => (
              <section
                key={dateGroup.key}
                className="rounded-xl border border-forest/35 bg-white/95 p-5 shadow-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-forest">
                      Date de retrait
                    </p>
                    <h2 className="font-serif text-3xl text-ink">{dateGroup.label}</h2>
                  </div>
                  <span className="text-sm font-semibold text-ink">
                    {formatMoney(dateGroup.total)} EUR
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-4">
                  {dateGroup.producers.map((producerGroup) => (
                    <div
                      key={`${dateGroup.key}-${producerGroup.producerId}`}
                      className="overflow-hidden rounded-lg border border-clay/70"
                    >
                      <div className="flex items-center justify-between border-b border-clay/70 bg-stone px-4 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/70">
                          {producerGroup.producerLabel}
                        </p>
                        <span className="text-xs font-semibold text-ink">
                          {formatMoney(producerGroup.total)} EUR
                        </span>
                      </div>

                      <div className="hidden grid-cols-[1.5fr_0.6fr_0.6fr_0.6fr_0.3fr] gap-3 border-b border-clay/70 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60 md:grid">
                        <span>Produit</span>
                        <span>PU</span>
                        <span>Qt</span>
                        <span>Total</span>
                        <span />
                      </div>

                      <div className="divide-y divide-clay/70">
                        {producerGroup.items.map((item) => (
                          <div
                            key={item.id}
                            className="grid gap-3 px-4 py-3 md:grid-cols-[1.5fr_0.6fr_0.6fr_0.6fr_0.3fr]"
                          >
                            <div>
                              <p className="text-sm font-semibold text-ink">{item.name}</p>
                              <span className="mt-1 inline-flex rounded-full bg-forest/10 px-2 py-0.5 text-[10px] font-semibold text-forest">
                                Retrait : {dateGroup.label}
                              </span>
                              <p className="text-xs text-ink/60">{item.variantLabel}</p>
                              {item.isSoldByWeight ? (
                                <p className="text-xs text-ink/55">
                                  Produit au poids - {formatEstimatedPrice(item.estimatedPriceMin, item.estimatedPriceMax)}
                                </p>
                              ) : null}
                              {item.maxQuantity ? (
                                <p className="text-xs font-semibold text-ink/55">Maximum : {item.maxQuantity}</p>
                              ) : null}
                            </div>
                            <div className={`text-sm font-semibold ${item.isSoldByWeight ? "text-ink/60" : "text-ink"}`}>
                              {item.isSoldByWeight ? "0,00 EUR" : `${formatMoney(item.unitPrice)} EUR`}
                            </div>
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
                                disabled={Boolean(item.maxQuantity && item.quantity >= item.maxQuantity)}
                              >
                                +
                              </button>
                            </div>
                            <div className="text-sm font-semibold">
                              {item.isSoldByWeight
                                ? estimatedLineTotal(item) === null
                                  ? "Au retrait"
                                  : `~${formatMoney(estimatedLineTotal(item)!)} EUR`
                                : `${formatMoney(item.unitPrice * item.quantity)} EUR`}
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
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="h-fit rounded-xl border border-clay/70 bg-white/95 p-5 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">Total</p>
            <div className="mt-2 flex items-center justify-between text-lg font-semibold text-ink">
              <span>Commande</span>
              <span>{formatMoney(total)} EUR</span>
            </div>
            {hasWeightEstimate ? (
              <div className="mt-2 rounded-lg border border-forest/25 bg-forest/5 px-3 py-2 text-sm text-ink/75">
                <div className="flex items-center justify-between gap-3">
                  <span>Produits au poids</span>
                  <span className="font-semibold">~{formatMoney(weightedEstimateTotal)} EUR</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 font-semibold text-ink">
                  <span>Total estime</span>
                  <span>~{formatMoney(total + weightedEstimateTotal)} EUR</span>
                </div>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-ink/60">
              Paiement sur place lors du retrait.
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
