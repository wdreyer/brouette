"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  writeBatch,
  where,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { isDistributionOpenNow } from "@/lib/distributions";

type FireDate = { toDate?: () => Date };

type Producer = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
};

type VariantDraft = {
  id?: string;
  tempId: string;
  label: string;
  price: number;
  activeDates: string[];
};

type ProductDraft = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  limitTotal: string;
  variants: VariantDraft[];
  existingVariantIds: string[];
};

type AddProductDraft = {
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  limitTotal: string;
  variantLabel: string;
  variantPrice: string;
};

const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

function createDraftProductWithDates(activeDateKeys: string[]): ProductDraft {
  return {
    id: newId(),
    name: "Nouveau produit",
    description: "",
    imageUrl: "",
    isOrganic: false,
    limitTotal: "",
    variants: [
      {
        tempId: newId(),
        label: "Nouvelle variante",
        price: 0,
        activeDates: [...activeDateKeys],
      },
    ],
    existingVariantIds: [],
  };
}

export default function AdminSaleProducerManagerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const distributionId = searchParams.get("distributionId") ?? "";
  const producerIds = useMemo(
    () =>
      (searchParams.get("producerIds") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [searchParams],
  );
  const currentIndex = Math.max(0, Math.min(Number(searchParams.get("idx") ?? 0), Math.max(producerIds.length - 1, 0)));
  const currentProducerId = producerIds[currentIndex] ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [producer, setProducer] = useState<Producer | null>(null);
  const [distributionLocked, setDistributionLocked] = useState(false);
  const [saleDates, setSaleDates] = useState<{ key: string; label: string }[]>([]);
  const [allowedDateKeys, setAllowedDateKeys] = useState<string[]>([]);
  const [draftProducts, setDraftProducts] = useState<ProductDraft[]>([]);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [addDraft, setAddDraft] = useState<AddProductDraft>({
    name: "",
    description: "",
    imageUrl: "",
    isOrganic: false,
    limitTotal: "",
    variantLabel: "",
    variantPrice: "",
  });

  const saleDateKeys = useMemo(() => saleDates.map((date) => date.key), [saleDates]);
  const editableDateKeys = useMemo(
    () => (allowedDateKeys.length ? allowedDateKeys : saleDateKeys),
    [allowedDateKeys, saleDateKeys],
  );

  const createDraftVariant = (): VariantDraft => ({
    tempId: newId(),
    label: "Nouvelle variante",
    price: 0,
    activeDates: [...editableDateKeys],
  });

  useEffect(() => {
    if (!currentProducerId) return;
    const load = async () => {
      setLoading(true);
      let loadedSaleDateKeys: string[] = [];

      const [producerSnap, distSnap, calendarSnap, productSnap] = await Promise.all([
        getDoc(doc(firebaseDb, "producers", currentProducerId)),
        distributionId ? getDoc(doc(firebaseDb, "distributionDates", distributionId)) : Promise.resolve(null),
        distributionId
          ? getDoc(doc(firebaseDb, "distributionDates", distributionId, "calendarProducers", currentProducerId))
          : Promise.resolve(null),
        getDocs(query(collection(firebaseDb, "products"), where("producerId", "==", currentProducerId))),
      ]);

      if (producerSnap.exists()) {
        setProducer({ id: producerSnap.id, ...(producerSnap.data() as Omit<Producer, "id">) });
      } else {
        setProducer(null);
      }

      if (distSnap?.exists()) {
        const distData = distSnap.data() as { dates?: FireDate[]; status?: string; closeAt?: FireDate };
        const dates = (distData.dates ?? [])
          .slice(0, 3)
          .map((item) => item.toDate?.())
          .filter(Boolean) as Date[];
        const nextDates = dates.map((value) => ({
          key: dateKey(value),
          label: value.toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          }),
        }));
        loadedSaleDateKeys = nextDates.map((item) => item.key);
        setSaleDates(nextDates);
        setDistributionLocked(
          isDistributionOpenNow({
            id: distributionId || "distribution",
            status: distData.status,
            closeAt: distData.closeAt,
          }),
        );
      } else {
        setSaleDates([]);
        setDistributionLocked(false);
      }

      const allowedFromCalendar =
        calendarSnap?.exists() && Array.isArray((calendarSnap.data() as { activeDateKeys?: string[] }).activeDateKeys)
          ? ((calendarSnap.data() as { activeDateKeys?: string[] }).activeDateKeys ?? []).filter((key) =>
              loadedSaleDateKeys.includes(key),
            )
          : [];
      setAllowedDateKeys(allowedFromCalendar);
      const nextEditableDateKeys = allowedFromCalendar.length
        ? allowedFromCalendar
        : loadedSaleDateKeys;

      const offersByVariant = new Map<string, string[]>();
      if (distributionId) {
        const offerSnap = await getDocs(
          query(
            collection(firebaseDb, "distributionDates", distributionId, "offerItems"),
            where("producerId", "==", currentProducerId),
          ),
        );
        offerSnap.docs.forEach((offerDoc) => {
          const data = offerDoc.data() as {
            productId?: string;
            variantId?: string;
            saleDateKey?: string;
            dateIndex?: number;
            active?: boolean;
          };
          if (data.active === false) return;
          const productId = String(data.productId ?? "");
          const variantId = String(data.variantId ?? "");
          if (!productId || !variantId) return;
          const resolvedDateKey =
            typeof data.saleDateKey === "string" && data.saleDateKey
              ? data.saleDateKey
              : typeof data.dateIndex === "number"
                ? loadedSaleDateKeys[data.dateIndex] ?? ""
                : "";
          if (!resolvedDateKey) return;
          const mapKey = `${productId}:${variantId}`;
          const current = offersByVariant.get(mapKey) ?? [];
          if (!current.includes(resolvedDateKey)) {
            offersByVariant.set(mapKey, [...current, resolvedDateKey]);
          }
        });
      }

      const variantsByProduct = new Map<string, VariantDraft[]>();
      const variantSnaps = await Promise.all(
        productSnap.docs.map((productDoc) => getDocs(collection(firebaseDb, "products", productDoc.id, "variants"))),
      );

      variantSnaps.forEach((variantSnap, index) => {
        const productId = productSnap.docs[index]?.id;
        if (!productId) return;
        const variants = variantSnap.docs.map((variantDoc) => {
          const variantData = variantDoc.data() as { label?: string; price?: number };
          const activeDates =
            offersByVariant.get(`${productId}:${variantDoc.id}`)?.filter((key) =>
              nextEditableDateKeys.includes(key),
            ) ?? [];
          return {
            id: variantDoc.id,
            tempId: variantDoc.id,
            label: String(variantData.label ?? "Variante"),
            price: Number(variantData.price ?? 0),
            activeDates: activeDates.length > 0 ? activeDates : [...nextEditableDateKeys],
          } satisfies VariantDraft;
        });
        variantsByProduct.set(productId, variants);
      });

      const nextDrafts: ProductDraft[] = [];
      for (const productDoc of productSnap.docs) {
        const productData = productDoc.data() as {
          name?: string;
          description?: string;
          imageUrl?: string;
          isOrganic?: boolean;
          saleLimit?: number;
        };
        const variants = variantsByProduct.get(productDoc.id) ?? [];
        nextDrafts.push({
          id: productDoc.id,
          name: String(productData.name ?? "Produit"),
          description: String(productData.description ?? ""),
          imageUrl: String(productData.imageUrl ?? ""),
          isOrganic: Boolean(productData.isOrganic),
          limitTotal:
            typeof productData.saleLimit === "number" && productData.saleLimit > 0
              ? String(productData.saleLimit)
              : "",
          variants,
          existingVariantIds: variants.map((variant) => variant.id!).filter(Boolean),
        });
      }
      setDraftProducts(nextDrafts.length ? nextDrafts : [createDraftProductWithDates(nextEditableDateKeys)]);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [currentProducerId, distributionId]);

  const updateDraftProduct = (index: number, patch: Partial<ProductDraft>) => {
    setDraftProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const updateDraftVariant = (productIndex: number, variantIndex: number, patch: Partial<VariantDraft>) => {
    setDraftProducts((prev) =>
      prev.map((item, i) => {
        if (i !== productIndex) return item;
        const variants = item.variants.map((variant, vi) =>
          vi === variantIndex ? { ...variant, ...patch } : variant,
        );
        return { ...item, variants };
      }),
    );
  };

  const applyAllDates = (selected: boolean) => {
    setDraftProducts((prev) =>
      prev.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => ({
          ...variant,
          activeDates: selected ? [...editableDateKeys] : [],
        })),
      })),
    );
  };

  const getProductPriceLabel = (product: ProductDraft) => {
    const prices = product.variants.map((variant) => Number(variant.price || 0));
    if (!prices.length) return "-";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `${min.toFixed(2)} €` : `${min.toFixed(2)} - ${max.toFixed(2)} €`;
  };

  const getProductDateState = (product: ProductDraft, targetDateKey: string) => {
    if (product.variants.length === 0) return "none" as const;
    const selectedCount = product.variants.filter((variant) =>
      variant.activeDates.includes(targetDateKey),
    ).length;
    if (selectedCount === 0) return "none" as const;
    if (selectedCount === product.variants.length) return "all" as const;
    return "partial" as const;
  };

  const toggleProductDate = (productIndex: number, targetDateKey: string) => {
    if (!editableDateKeys.includes(targetDateKey)) return;
    setDraftProducts((prev) =>
      prev.map((product, idx) => {
        if (idx !== productIndex) return product;
        const checked = getProductDateState(product, targetDateKey) === "all";
        const variants = product.variants.map((variant) => ({
          ...variant,
          activeDates: checked
            ? variant.activeDates.filter((key) => key !== targetDateKey)
            : Array.from(new Set([...variant.activeDates, targetDateKey])),
        }));
        return { ...product, variants };
      }),
    );
  };

  const openAddModal = () => {
    setAddDraft({
      name: "",
      description: "",
      imageUrl: "",
      isOrganic: false,
      limitTotal: "",
      variantLabel: "",
      variantPrice: "",
    });
    setShowAddProductModal(true);
  };

  const addProductFromModal = () => {
    const price = Number(addDraft.variantPrice || 0);
    setDraftProducts((prev) => [
      ...prev,
      {
        id: newId(),
        name: addDraft.name.trim() || "Nouveau produit",
        description: addDraft.description.trim(),
        imageUrl: addDraft.imageUrl.trim(),
        isOrganic: Boolean(addDraft.isOrganic),
        limitTotal: addDraft.limitTotal.trim(),
        variants: [
          {
            id: undefined,
            tempId: newId(),
            label: addDraft.variantLabel.trim() || "Variante",
            price: Number.isFinite(price) ? price : 0,
            activeDates: [...editableDateKeys],
          },
        ],
        existingVariantIds: [],
      },
    ]);
    setShowAddProductModal(false);
  };

  const saveDraft = async () => {
    if (!currentProducerId) return;
    if (distributionLocked) {
      setMessage("Cette distribution est ouverte : modifications verrouillees.");
      return;
    }
    setSaving(true);
    setMessage("");

    const savedProducts: Array<{
      id: string;
      name: string;
      imageUrl: string;
      isOrganic: boolean;
      limitTotal: number;
      variants: Array<{ id: string; label: string; price: number; activeDates: string[] }>;
    }> = [];

    const batchOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    const now = Timestamp.now();

    for (const product of draftProducts) {
      const parsedLimit = Number(product.limitTotal || 0);
      const productId = product.id.startsWith("tmp_")
        ? doc(collection(firebaseDb, "products")).id
        : product.id;
      const payload = {
        producerId: currentProducerId,
        name: product.name.trim() || "Produit",
        description: product.description.trim(),
        imageUrl: product.imageUrl.trim(),
        isOrganic: Boolean(product.isOrganic),
        saleLimit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
        updatedAt: now,
      };
      const productRef = doc(firebaseDb, "products", productId);
      batchOps.push((batch) => batch.set(productRef, payload, { merge: true }));

      const keptVariantIds = new Set<string>();
      const savedVariants: Array<{ id: string; label: string; price: number; activeDates: string[] }> = [];
      for (const variant of product.variants) {
        const variantId = variant.id ?? doc(collection(firebaseDb, "products", productId, "variants")).id;
        const selectedActiveDates = Array.from(
          new Set(variant.activeDates.filter((key) => editableDateKeys.includes(key))),
        );
        const variantPayload = {
          label: variant.label.trim() || "Variante",
          price: Number(variant.price || 0),
        };
        keptVariantIds.add(variantId);
        const variantRef = doc(firebaseDb, "products", productId, "variants", variantId);
        batchOps.push((batch) => batch.set(variantRef, variantPayload, { merge: true }));
        savedVariants.push({ id: variantId, ...variantPayload, activeDates: selectedActiveDates });
      }

      for (const existingId of product.existingVariantIds) {
        if (!keptVariantIds.has(existingId)) {
          const existingVariantRef = doc(firebaseDb, "products", productId, "variants", existingId);
          batchOps.push((batch) => batch.delete(existingVariantRef));
        }
      }

      savedProducts.push({
        id: productId,
        name: payload.name,
        imageUrl: payload.imageUrl,
        isOrganic: payload.isOrganic,
        limitTotal: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 0,
        variants: savedVariants,
      });
    }

    if (distributionId) {
      const producerRef = doc(firebaseDb, "distributionDates", distributionId, "producers", currentProducerId);
      const offerItemsRef = collection(firebaseDb, "distributionDates", distributionId, "offerItems");

      const existingOfferSnap = await getDocs(query(offerItemsRef, where("producerId", "==", currentProducerId)));
      existingOfferSnap.docs.forEach((offerDoc) => {
        batchOps.push((batch) => batch.delete(offerDoc.ref));
      });

      savedProducts.forEach((product) => {
        product.variants.forEach((variant) => {
          variant.activeDates.forEach((saleDateKey) => {
            const offerRef = doc(offerItemsRef);
            batchOps.push((batch) =>
              batch.set(offerRef, {
              producerId: currentProducerId,
              productId: product.id,
              variantId: variant.id,
              saleDateKey,
              title: product.name,
              variantLabel: variant.label,
              imageUrl: product.imageUrl || null,
              isOrganic: product.isOrganic,
              priceApplied: variant.price,
              limitTotal: product.limitTotal,
              active: true,
              }),
            );
          });
        });
      });

      batchOps.push((batch) =>
        batch.set(
          producerRef,
          {
            producerId: currentProducerId,
            referentId: producer?.referentId ?? null,
            referentName: producer?.referentName ?? null,
            active: true,
            validatedByReferent: true,
            validatedAt: now,
          },
          { merge: true },
        ),
      );
    }

    const MAX_BATCH_OPS = 380;
    for (let index = 0; index < batchOps.length; index += MAX_BATCH_OPS) {
      const batch = writeBatch(firebaseDb);
      const chunk = batchOps.slice(index, index + MAX_BATCH_OPS);
      chunk.forEach((apply) => apply(batch));
      await batch.commit();
    }

    setSaving(false);
    setMessage("Producteur enregistre.");

    router.push("/admin/vente");
  };

  if (loading) return <div className="p-6 text-sm text-ink/70">Chargement...</div>;

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-ink/20 bg-stone/90 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Gestion producteur</p>
            <h1 className="mt-1 font-serif text-3xl">{producer?.name ?? "Producteur"}</h1>
            {producerIds.length > 1 ? (
              <p className="mt-1 text-sm text-ink/70">Producteur {currentIndex + 1}/{producerIds.length}</p>
            ) : null}
          </div>
          <button className="rounded-md border border-ink/30 px-4 py-2 text-sm font-semibold" onClick={() => router.push("/admin/vente")}>
            Retour vente
          </button>
        </div>
      </section>

      <section className="border border-ink/20 bg-stone/90 p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={() => applyAllDates(true)} disabled={saving || distributionLocked}>Tout selectionner</button>
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={() => applyAllDates(false)} disabled={saving || distributionLocked}>Tout deselectionner</button>
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={openAddModal} disabled={saving || distributionLocked}>Ajouter un produit</button>
        </div>
        {distributionLocked ? (
          <p className="mb-3 text-sm font-semibold text-ember">Cette distribution est ouverte : edition verrouillee.</p>
        ) : null}

        <div className="overflow-x-auto border border-ink/20">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-ink text-stone">
              <tr>
                <th className="px-2 py-2 text-left">Produit</th>
                <th className="px-2 py-2 text-left">Prix</th>
                {saleDates.map((date) => (
                  <th key={date.key} className="px-2 py-2 text-center">{date.label}</th>
                ))}
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {draftProducts.map((product, productIndex) => (
                <Fragment key={product.id}>
                  <tr className="border-b border-ink/10 bg-ink/[0.02]">
                    <td className="px-2 py-2 align-top">
                      <div className="flex items-start gap-2">
                        <label className="flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                          <span className="sr-only">Nom produit</span>
                          <input
                            className="w-full rounded-md border border-ink/25 px-2 py-1 text-sm font-semibold normal-case tracking-normal"
                            value={product.name}
                            onChange={(e) => updateDraftProduct(productIndex, { name: e.target.value })}
                          />
                        </label>
                        <button
                          className="rounded-md border border-ink/25 px-2 py-1 text-[11px] font-semibold"
                          onClick={() =>
                            updateDraftProduct(productIndex, {
                              variants: [...product.variants, createDraftVariant()],
                            })
                          }
                        >
                          + Variante
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top text-sm font-semibold text-ink">
                      {product.variants.length === 1 ? (
                        <input
                          className="w-24 rounded-md border border-ink/25 px-2 py-1 text-sm font-semibold"
                          type="number"
                          step="0.01"
                          value={String(product.variants[0]?.price ?? 0)}
                          onChange={(e) =>
                            updateDraftVariant(productIndex, 0, { price: Number(e.target.value || 0) })
                          }
                        />
                      ) : (
                        getProductPriceLabel(product)
                      )}
                    </td>
                    {saleDates.map((date) => (
                      <td key={`${product.id}-head-${date.key}`} className="px-2 py-2 text-center align-top">
                        {product.variants.length === 1 ? (
                          <input
                            type="checkbox"
                            checked={product.variants[0]?.activeDates.includes(date.key)}
                            disabled={!editableDateKeys.includes(date.key)}
                            onChange={() =>
                              updateDraftVariant(productIndex, 0, {
                                activeDates: product.variants[0]?.activeDates.includes(date.key)
                                  ? product.variants[0].activeDates.filter((key) => key !== date.key)
                                  : editableDateKeys.includes(date.key)
                                    ? [...(product.variants[0]?.activeDates ?? []), date.key]
                                    : [...(product.variants[0]?.activeDates ?? [])],
                              })
                            }
                          />
                        ) : (
                          (() => {
                            const dateState = getProductDateState(product, date.key);
                            return (
                              <input
                                type="checkbox"
                                checked={dateState === "all"}
                                ref={(element) => {
                                  if (element) {
                                    element.indeterminate = dateState === "partial";
                                  }
                                }}
                                disabled={!editableDateKeys.includes(date.key)}
                                onChange={() => toggleProductDate(productIndex, date.key)}
                              />
                            );
                          })()
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2 align-top text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!product.id.startsWith("tmp_") ? (
                          <button
                            className="rounded-md border border-ink/25 px-2 py-1 text-[11px] font-semibold"
                            onClick={() => {
                              const idsParam = encodeURIComponent(producerIds.join(","));
                              router.push(`/admin/vente/produit/${product.id}?distributionId=${encodeURIComponent(distributionId)}&producerId=${encodeURIComponent(currentProducerId)}&producerIds=${idsParam}&idx=${currentIndex}`);
                            }}
                          >
                            Details
                          </button>
                        ) : null}
                        <input
                          className="w-20 rounded-md border border-ink/25 px-2 py-1 text-xs"
                          placeholder="Stock"
                          type="number"
                          min={0}
                          value={product.limitTotal}
                          onChange={(e) => updateDraftProduct(productIndex, { limitTotal: e.target.value })}
                        />
                      </div>
                    </td>
                  </tr>
                  {product.variants.length > 1
                    ? product.variants.map((variant, variantIndex) => (
                    <tr key={variant.tempId} className="border-b border-ink/10">
                      <td className="px-2 py-2 pl-8 text-ink/80">
                        <input className="w-full rounded-md border border-ink/25 px-2 py-1 text-sm" value={variant.label} onChange={(e) => updateDraftVariant(productIndex, variantIndex, { label: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <input className="w-24 rounded-md border border-ink/25 px-2 py-1 text-sm" type="number" step="0.01" value={String(variant.price)} onChange={(e) => updateDraftVariant(productIndex, variantIndex, { price: Number(e.target.value || 0) })} />
                      </td>
                      {saleDates.map((date) => (
                        <td key={`${variant.tempId}-${date.key}`} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={variant.activeDates.includes(date.key)}
                            disabled={!editableDateKeys.includes(date.key)}
                            onChange={() =>
                              updateDraftVariant(productIndex, variantIndex, {
                                activeDates: variant.activeDates.includes(date.key)
                                  ? variant.activeDates.filter((key) => key !== date.key)
                                  : editableDateKeys.includes(date.key)
                                    ? [...variant.activeDates, date.key]
                                    : [...variant.activeDates],
                              })
                            }
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right">
                        <button className="rounded-md border border-ink/25 px-2 py-1 text-[11px] font-semibold" disabled={product.variants.length <= 1} onClick={() => updateDraftProduct(productIndex, { variants: product.variants.filter((_, idx) => idx !== variantIndex) })}>Retirer variante</button>
                      </td>
                    </tr>
                      ))
                    : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showAddProductModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl border border-ink/20 bg-stone/95 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl">Ajouter un produit</h2>
              <button className="rounded-md border border-ink/25 px-3 py-1 text-sm font-semibold" onClick={() => setShowAddProductModal(false)}>Fermer</button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                Nom produit
                <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" value={addDraft.name} onChange={(e) => setAddDraft((prev) => ({ ...prev, name: e.target.value }))} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                Description
                <textarea className="mt-1 min-h-[100px] w-full border border-ink/25 px-3 py-2 text-sm" value={addDraft.description} onChange={(e) => setAddDraft((prev) => ({ ...prev, description: e.target.value }))} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                Image URL
                <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" value={addDraft.imageUrl} onChange={(e) => setAddDraft((prev) => ({ ...prev, imageUrl: e.target.value }))} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                  Premiere variante
                  <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" value={addDraft.variantLabel} onChange={(e) => setAddDraft((prev) => ({ ...prev, variantLabel: e.target.value }))} />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                  Prix initial
                  <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" type="number" step="0.01" value={addDraft.variantPrice} onChange={(e) => setAddDraft((prev) => ({ ...prev, variantPrice: e.target.value }))} />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                  Stock limite (optionnel)
                  <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" type="number" min={0} value={addDraft.limitTotal} onChange={(e) => setAddDraft((prev) => ({ ...prev, limitTotal: e.target.value }))} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink/80">
                <input type="checkbox" checked={addDraft.isOrganic} onChange={(e) => setAddDraft((prev) => ({ ...prev, isOrganic: e.target.checked }))} />
                Produit bio
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white" onClick={addProductFromModal}>Ajouter ce produit</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/70">{message}</p>
        <button className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={saveDraft} disabled={saving || distributionLocked}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
