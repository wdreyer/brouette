"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type Distribution = {
  id: string;
  title?: string;
  status?: string;
  dates?: { toDate: () => Date }[];
  openedAt?: { toDate: () => Date };
};

type Producer = {
  id: string;
  name?: string;
};

type Product = {
  id: string;
  producerId: string;
  name: string;
  imageUrl?: string;
  isOrganic?: boolean;
  categoryId?: string;
};

type Variant = {
  id: string;
  productId: string;
  label: string;
  price: number;
};

type OfferItem = {
  id: string;
  productId: string;
  variantId: string;
  producerId: string;
  dateIndex: number;
  limitTotal?: number;
  price?: number;
};

type OfferDraft = {
  enabled: boolean;
  limitTotal: string;
};

type QuickAddDraft = {
  productName: string;
  variantLabel: string;
  variantPrice: string;
};

type VariantAddDraft = {
  label: string;
  price: string;
};

function daysUntil(date: Date) {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function dateLabel(date?: Date) {
  if (!date) return "-";
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function OpenSalesPanel() {
  const [loading, setLoading] = useState(true);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedProducerIds, setSelectedProducerIds] = useState<string[]>([]);
  const [offerDraft, setOfferDraft] = useState<Record<string, OfferDraft>>({});
  const [quickAddByProducer, setQuickAddByProducer] = useState<Record<string, QuickAddDraft>>({});
  const [variantDraftByProduct, setVariantDraftByProduct] = useState<Record<string, VariantAddDraft>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "opening" | "closing" | "error">("idle");
  const [message, setMessage] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  const selected = useMemo(
    () => distributions.find((dist) => dist.id === selectedId),
    [distributions, selectedId],
  );
  const openDistribution = useMemo(
    () => distributions.find((dist) => dist.status === "open"),
    [distributions],
  );
  const plannedDistributions = useMemo(
    () => distributions.filter((dist) => dist.status === "planned"),
    [distributions],
  );

  const dates = useMemo(
    () => (selected?.dates ?? []).slice(0, 3).map((d) => d.toDate()),
    [selected],
  );

  const variantsByProduct = useMemo(() => {
    const map: Record<string, Variant[]> = {};
    variants.forEach((variant) => {
      if (!map[variant.productId]) map[variant.productId] = [];
      map[variant.productId].push(variant);
    });
    return map;
  }, [variants]);

  const productsByProducer = useMemo(() => {
    const map: Record<string, Product[]> = {};
    products.forEach((product) => {
      if (!map[product.producerId]) map[product.producerId] = [];
      map[product.producerId].push(product);
    });
    return map;
  }, [products]);

  const selectedProducers = useMemo(
    () => producers.filter((producer) => selectedProducerIds.includes(producer.id)),
    [producers, selectedProducerIds],
  );

  const load = async () => {
    setLoading(true);
    const [distSnap, producersSnap, productsSnap] = await Promise.all([
      getDocs(query(collection(firebaseDb, "distributionDates"))),
      getDocs(collection(firebaseDb, "producers")),
      getDocs(collection(firebaseDb, "products")),
    ]);

    const items = distSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Distribution, "id">),
    }));
    items.sort((a, b) => {
      const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
      const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
      return aDate.getTime() - bDate.getTime();
    });
    setDistributions(items);

    const producerItems = producersSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Producer, "id">),
    }));
    setProducers(producerItems);

    const productItems = productsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Product, "id">),
    }));
    setProducts(productItems);

    const variantSnaps = await Promise.all(
      productItems.map((product) => getDocs(collection(firebaseDb, "products", product.id, "variants"))),
    );
    const variantItems: Variant[] = [];
    variantSnaps.forEach((snap, index) => {
      snap.docs.forEach((docSnap) => {
        variantItems.push({
          id: docSnap.id,
          productId: productItems[index].id,
          ...(docSnap.data() as Omit<Variant, "id" | "productId">),
        });
      });
    });
    setVariants(variantItems);

    if (!selectedId && items.length > 0) {
      const openDist = items.find((dist) => dist.status === "open");
      if (openDist) {
        setSelectedId(openDist.id);
        setShowConfig(true);
      } else {
        const firstPlanned = items.find((dist) => dist.status === "planned");
        if (firstPlanned) {
          setSelectedId(firstPlanned.id);
          setShowConfig(true);
        }
      }
    }

    if (producerItems.length > 0) {
      setSelectedProducerIds((prev) => (prev.length ? prev : producerItems.map((p) => p.id)));
    }

    setLoading(false);
  };

  const loadOfferConfig = async () => {
    if (!selectedId) return;
    const [offerSnap, producerSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates", selectedId, "offerItems")),
      getDocs(collection(firebaseDb, "distributionDates", selectedId, "producers")),
    ]);

    const offerItems = offerSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<OfferItem, "id">),
    }));

    const nextDraft: Record<string, OfferDraft> = {};
    offerItems.forEach((offer) => {
      const key = `${offer.variantId}:${offer.dateIndex}`;
      nextDraft[key] = {
        enabled: true,
        limitTotal: offer.limitTotal !== undefined ? String(offer.limitTotal) : "",
      };
    });
    setOfferDraft(nextDraft);

    if (!producerSnap.empty) {
      const producerIds = producerSnap.docs.map((docSnap) => docSnap.id);
      setSelectedProducerIds(producerIds);
    } else if (producers.length) {
      setSelectedProducerIds(producers.map((producer) => producer.id));
    }
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadOfferConfig().catch(() => {});
  }, [selectedId]);

  const toggleProducer = (id: string) => {
    setSelectedProducerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const updateOfferDraft = (variantId: string, dateIndex: number, patch: Partial<OfferDraft>) => {
    const key = `${variantId}:${dateIndex}`;
    setOfferDraft((prev) => {
      const current = prev[key] ?? { enabled: false, limitTotal: "" };
      return {
        ...prev,
        [key]: { ...current, ...patch },
      };
    });
  };

  const enableAllDatesForVariant = (variantId: string) => {
    dates.forEach((_, index) => {
      updateOfferDraft(variantId, index, { enabled: true });
    });
  };

  const enableAllDatesForProduct = (productId: string) => {
    const productVariants = variantsByProduct[productId] ?? [];
    productVariants.forEach((variant) => enableAllDatesForVariant(variant.id));
  };

  const updateQuickAdd = (producerId: string, patch: Partial<QuickAddDraft>) => {
    setQuickAddByProducer((prev) => {
      const current = prev[producerId] ?? { productName: "", variantLabel: "", variantPrice: "" };
      return { ...prev, [producerId]: { ...current, ...patch } };
    });
  };

  const updateVariantDraft = (productId: string, patch: Partial<VariantAddDraft>) => {
    setVariantDraftByProduct((prev) => {
      const current = prev[productId] ?? { label: "", price: "" };
      return { ...prev, [productId]: { ...current, ...patch } };
    });
  };

  const createProductWithVariant = async (producerId: string) => {
    const draft = quickAddByProducer[producerId];
    if (!draft?.productName?.trim() || !draft?.variantLabel?.trim()) {
      setMessage("Renseigne le nom du produit et la variante.");
      return;
    }
    try {
      setStatus("saving");
      setMessage("");
      const productRef = await addDoc(collection(firebaseDb, "products"), {
        producerId,
        name: draft.productName.trim(),
        description: "",
        isOrganic: false,
      });
      const price = Number(draft.variantPrice || 0);
      const variantRef = await addDoc(collection(firebaseDb, "products", productRef.id, "variants"), {
        label: draft.variantLabel.trim(),
        price,
      });

      setProducts((prev) => [
        ...prev,
        { id: productRef.id, producerId, name: draft.productName.trim(), isOrganic: false },
      ]);
      setVariants((prev) => [
        ...prev,
        { id: variantRef.id, productId: productRef.id, label: draft.variantLabel.trim(), price },
      ]);
      dates.forEach((_, index) => enableAllDatesForVariant(variantRef.id));

      setQuickAddByProducer((prev) => ({ ...prev, [producerId]: { productName: "", variantLabel: "", variantPrice: "" } }));
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const addVariantToProduct = async (productId: string) => {
    const draft = variantDraftByProduct[productId];
    if (!draft?.label?.trim()) {
      setMessage("Renseigne le nom de la variante.");
      return;
    }
    try {
      setStatus("saving");
      setMessage("");
      const price = Number(draft.price || 0);
      const variantRef = await addDoc(collection(firebaseDb, "products", productId, "variants"), {
        label: draft.label.trim(),
        price,
      });
      setVariants((prev) => [
        ...prev,
        { id: variantRef.id, productId, label: draft.label.trim(), price },
      ]);
      dates.forEach((_, index) => enableAllDatesForVariant(variantRef.id));
      setVariantDraftByProduct((prev) => ({ ...prev, [productId]: { label: "", price: "" } }));
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const handleSave = async (openAfter: boolean) => {
    if (!selectedId) {
      setMessage("Choisis une distribution.");
      return;
    }
    try {
      setStatus(openAfter ? "opening" : "saving");
      setMessage("");

      const distRef = doc(firebaseDb, "distributionDates", selectedId);
      const offersSnap = await getDocs(collection(distRef, "offerItems"));
      const producersSnap = await getDocs(collection(distRef, "producers"));

      const batch = writeBatch(firebaseDb);
      offersSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      producersSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));

      selectedProducerIds.forEach((producerId) => {
        batch.set(doc(collection(distRef, "producers"), producerId), {
          producerId,
          active: true,
        });
      });

      const productMap: Record<string, Product> = {};
      products.forEach((product) => {
        productMap[product.id] = product;
      });
      const variantMap: Record<string, Variant> = {};
      variants.forEach((variant) => {
        variantMap[variant.id] = variant;
      });

      Object.entries(offerDraft).forEach(([key, draft]) => {
        if (!draft.enabled) return;
        const [variantId, dateIndexRaw] = key.split(":");
        const dateIndex = Number(dateIndexRaw);
        const variant = variantMap[variantId];
        if (!variant) return;
        const product = productMap[variant.productId];
        if (!product) return;
        if (!selectedProducerIds.includes(product.producerId)) return;

        const limitTotal = draft.limitTotal ? Number(draft.limitTotal) : 0;

        const ref = doc(collection(distRef, "offerItems"));
        batch.set(ref, {
          producerId: product.producerId,
          productId: product.id,
          variantId: variant.id,
          dateIndex,
          limitTotal,
          price: variant.price,
          title: product.name,
          variantLabel: variant.label,
          imageUrl: product.imageUrl ?? null,
          isOrganic: Boolean(product.isOrganic),
          categoryId: product.categoryId ?? null,
        });
      });

      if (openAfter) {
        const openSnap = await getDocs(query(collection(firebaseDb, "distributionDates")));
        openSnap.docs.forEach((docSnap) => {
          if (docSnap.id !== selectedId && docSnap.data().status === "open") {
            batch.update(docSnap.ref, { status: "finished" });
          }
        });
        batch.update(distRef, { status: "open", openedAt: Timestamp.now() });
      }

      await batch.commit();
      setMessage(openAfter ? "Vente ouverte." : "Configuration enregistree.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setStatus("error");
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const handleClose = async () => {
    if (!openDistribution) return;
    try {
      setStatus("closing");
      setMessage("");
      await updateDoc(doc(firebaseDb, "distributionDates", openDistribution.id), { status: "finished" });
      await load();
      setMessage("Vente fermee.");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setStatus("error");
      setMessage(err);
    }
  };

  const openedAt = openDistribution?.openedAt?.toDate?.();

  return (
    <div className="rounded-3xl border border-clay/70 bg-white/80 p-8 shadow-card">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-moss">Ventes</p>
        <h2 className="font-serif text-3xl">Configurer et ouvrir la vente</h2>
        <p className="text-sm text-ink/70">
          Selectionne une distribution planifiee, coche les producteurs et complete les offres en un seul ecran.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {loading ? <p className="text-sm text-ink/70">Chargement...</p> : null}

        {openDistribution ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-moss/15 px-4 py-2 text-sm font-semibold text-moss">
              Vente ouverte
            </span>
            {openedAt ? (
              <span className="text-sm text-ink/70">
                Ouverte le{" "}
                {openedAt.toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            ) : null}
            <button
              className="ml-auto rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold text-ink"
              onClick={handleClose}
              disabled={status === "closing" || loading}
            >
              {status === "closing" ? "Fermeture..." : "Fermer la vente"}
            </button>
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={() => setShowConfig((prev) => !prev)}
            >
              {showConfig ? "Masquer la configuration" : "Configurer la vente"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-ink/10 px-4 py-2 text-sm font-semibold text-ink">
              Aucune vente ouverte
            </span>
          </div>
        )}

        {message ? <p className="text-sm text-ink/70">{message}</p> : null}
      </div>

      {!openDistribution || showConfig ? (
        <div className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-clay/70 bg-white/90 p-4">
            <select
              className="w-full max-w-sm rounded-full border border-ink/20 bg-white px-4 py-2 text-sm"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">Choisir une distribution planifiee</option>
              {plannedDistributions.map((dist, index) => (
                <option key={dist.id} value={dist.id}>
                  {`Periode ${index + 1}  planifiee`}
                </option>
              ))}
              {openDistribution ? (
                <option value={openDistribution.id}>Distribution ouverte</option>
              ) : null}
            </select>
            <div className="flex flex-wrap gap-2 text-xs text-ink/60">
              {dates.map((date, index) => (
                <span key={index} className="rounded-full border border-clay/70 bg-white px-3 py-1">
                  {dateLabel(date)}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-clay/70 bg-white/90 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteurs presents</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {producers.map((producer) => (
                <label key={producer.id} className="flex items-center gap-2 rounded-full border border-ink/20 px-3 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedProducerIds.includes(producer.id)}
                    onChange={() => toggleProducer(producer.id)}
                  />
                  {producer.name ?? producer.id}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-5">
            {selectedProducers.map((producer) => {
              const producerProducts = productsByProducer[producer.id] ?? [];
              if (producerProducts.length === 0) return null;
              return (
                <div key={producer.id} className="rounded-2xl border border-clay/70 bg-white/95 p-5 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteur</p>
                      <h3 className="font-serif text-2xl">{producer.name ?? producer.id}</h3>
                    </div>
                    <a
                      className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold"
                      href="/admin/products"
                    >
                      Ajouter un produit
                    </a>
                  </div>
                  <div className="mt-3 rounded-xl border border-clay/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
                      Ajout rapide
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1.2fr_1fr_0.6fr_auto]">
                      <input
                        className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm"
                        placeholder="Nom du produit"
                        value={quickAddByProducer[producer.id]?.productName ?? ""}
                        onChange={(event) => updateQuickAdd(producer.id, { productName: event.target.value })}
                      />
                      <input
                        className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm"
                        placeholder="Variante (ex: 1kg)"
                        value={quickAddByProducer[producer.id]?.variantLabel ?? ""}
                        onChange={(event) => updateQuickAdd(producer.id, { variantLabel: event.target.value })}
                      />
                      <input
                        className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm"
                        placeholder="Prix"
                        type="number"
                        min={0}
                        step="0.1"
                        value={quickAddByProducer[producer.id]?.variantPrice ?? ""}
                        onChange={(event) => updateQuickAdd(producer.id, { variantPrice: event.target.value })}
                      />
                      <button
                        className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-stone"
                        onClick={() => createProductWithVariant(producer.id)}
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-4">
                    {producerProducts.map((product) => {
                      const productVariants = variantsByProduct[product.id] ?? [];
                      if (productVariants.length === 0) return null;
                      return (
                        <div key={product.id} className="rounded-xl border border-clay/70 bg-stone/60 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produit</p>
                              <h4 className="font-serif text-xl">{product.name}</h4>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-ink/60">
                                {product.isOrganic ? "Bio" : "Conventionnel"}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 overflow-x-auto rounded-lg border border-clay/70 bg-white">
                            <div
                              className="min-w-[720px] border-b border-clay/70 bg-stone px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60"
                              style={{
                                display: "grid",
                                gridTemplateColumns: `1.2fr 0.5fr repeat(${dates.length || 1}, minmax(140px, 1fr))`,
                                gap: "12px",
                              }}
                            >
                              <span>Variante</span>
                              <span>Prix</span>
                              {(dates.length ? dates : [null]).map((date, index) => (
                                <span key={index}>{date ? dateLabel(date) : "Dates"}</span>
                              ))}
                            </div>
                            <div className="divide-y divide-clay/70">
                              {productVariants.map((variant) => (
                                <div
                                  key={variant.id}
                                  className="min-w-[720px] px-4 py-2"
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: `1.2fr 0.5fr repeat(${dates.length || 1}, minmax(140px, 1fr))`,
                                    gap: "12px",
                                  }}
                                >
                                  <div>
                                    <p className="text-sm font-semibold text-ink">{variant.label}</p>
                                  </div>
                                  <div className="text-sm font-semibold">{variant.price.toFixed(2)} EUR</div>
                                  {dates.length ? (
                                    dates.map((date, dateIndex) => {
                                      const key = `${variant.id}:${dateIndex}`;
                                      const draft = offerDraft[key] ?? {
                                        enabled: false,
                                        limitTotal: "",
                                      };
                                      return (
                                        <div key={key} className="flex flex-col gap-2">
                                          <label className="flex items-center gap-2 text-xs text-ink/70">
                                            <input
                                              type="checkbox"
                                              checked={draft.enabled}
                                              onChange={(event) =>
                                                updateOfferDraft(variant.id, dateIndex, {
                                                  enabled: event.target.checked,
                                                })
                                              }
                                            />
                                            Actif
                                          </label>
                                          <input
                                            type="number"
                                            min={0}
                                            placeholder="Limite totale"
                                            className="rounded-md border border-ink/20 bg-white px-2 py-1 text-[11px]"
                                            value={draft.limitTotal}
                                            onChange={(event) =>
                                              updateOfferDraft(variant.id, dateIndex, {
                                                limitTotal: event.target.value,
                                              })
                                            }
                                          />
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span className="text-sm text-ink/60">Aucune date</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_0.6fr_auto]">
                            <input
                              className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-xs"
                              placeholder="Nouvelle variante"
                              value={variantDraftByProduct[product.id]?.label ?? ""}
                              onChange={(event) => updateVariantDraft(product.id, { label: event.target.value })}
                            />
                            <input
                              className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-xs"
                              placeholder="Prix"
                              type="number"
                              min={0}
                              step="0.1"
                              value={variantDraftByProduct[product.id]?.price ?? ""}
                              onChange={(event) => updateVariantDraft(product.id, { price: event.target.value })}
                            />
                            <button
                              className="rounded-full border border-ink/20 px-3 py-2 text-xs font-semibold"
                              onClick={() => addVariantToProduct(product.id)}
                            >
                              Ajouter variante
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold"
              onClick={() => handleSave(false)}
              disabled={status === "saving" || !selectedId}
            >
              {status === "saving" ? "Enregistrement..." : "Enregistrer la configuration"}
            </button>
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={() => handleSave(true)}
              disabled={status === "opening" || !selectedId}
            >
              {status === "opening" ? "Ouverture..." : "Ouvrir la vente"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {(openDistribution?.dates ?? []).slice(0, 3).map((date, index) => {
            const d = date.toDate();
            return (
              <div key={index} className="rounded-2xl border border-clay/70 bg-stone p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Vente {index + 1}</p>
                <p className="mt-2 text-lg font-semibold text-ink">{dateLabel(d)}</p>
                <p className="mt-1 text-sm text-ink/70">J-{daysUntil(d)} jours</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
