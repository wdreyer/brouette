"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "@/components/auth/AuthProvider";

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
  isSoldByWeight: boolean;
  estimatedPriceMin: string;
  estimatedPriceMax: string;
  limitTotal: string;
  variants: VariantDraft[];
  existingVariantIds: string[];
};

type AddProductDraft = {
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  isSoldByWeight: boolean;
  estimatedPriceMin: string;
  estimatedPriceMax: string;
  limitTotal: string;
  variantLabel: string;
  variantPrice: string;
};

const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

function parseNullableNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function formatEstimatedRange(minValue: string, maxValue: string) {
  const min = parseNullableNumber(minValue);
  const max = parseNullableNumber(maxValue);
  if (min === null && max === null) return "Prix final au retrait";
  if (min !== null && max !== null) {
    return min === max
      ? `Estimatif: ${min.toFixed(2)} EUR`
      : `Estimatif: ${min.toFixed(2)} - ${max.toFixed(2)} EUR`;
  }
  if (min !== null) return `Estimatif à partir de ${min.toFixed(2)} EUR`;
  return `Estimatif jusqu'à ${max!.toFixed(2)} EUR`;
}

function createDraftProductWithDates(activeDateKeys: string[]): ProductDraft {
  return {
    id: newId(),
    name: "Nouveau produit",
    description: "",
    imageUrl: "",
    isOrganic: false,
    isSoldByWeight: false,
    estimatedPriceMin: "",
    estimatedPriceMax: "",
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
  const { effectiveRole, effectiveMemberId } = useAuth();

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
  const [editingProductIndex, setEditingProductIndex] = useState<number | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [addDraft, setAddDraft] = useState<AddProductDraft>({
    name: "",
    description: "",
    imageUrl: "",
    isOrganic: false,
    isSoldByWeight: false,
    estimatedPriceMin: "",
    estimatedPriceMax: "",
    limitTotal: "",
    variantLabel: "",
    variantPrice: "",
  });
  const [draftsByProducer, setDraftsByProducer] = useState<Record<string, ProductDraft[]>>({});
  const [editableDateKeysByProducer, setEditableDateKeysByProducer] = useState<Record<string, string[]>>({});
  const [dirtyProducerIds, setDirtyProducerIds] = useState<string[]>([]);

  const draftsByProducerRef = useRef(draftsByProducer);
  const editableDateKeysByProducerRef = useRef(editableDateKeysByProducer);
  const dirtyProducerIdsRef = useRef(dirtyProducerIds);

  const saleDateKeys = useMemo(() => saleDates.map((date) => date.key), [saleDates]);
  const isReferent = effectiveRole === "referent";
  const canEditOpenSale = effectiveRole === "admin";
  const editingLocked = distributionLocked && !canEditOpenSale;
  const backToSalesPath = isReferent
    ? "/admin/vente/prochaine"
    : distributionLocked
      ? "/admin/vente/en-cours"
      : "/admin/vente/prochaine";
  const backToSalesLabel = isReferent
    ? "Retour prochaine vente"
    : distributionLocked
      ? "Retour vente en cours"
      : "Retour prochaine vente";
  const editableDateKeys = useMemo(
    () => [...allowedDateKeys],
    [allowedDateKeys],
  );
  const editingProduct =
    editingProductIndex !== null ? (draftProducts[editingProductIndex] ?? null) : null;
  const hasManyProducers = producerIds.length > 1;
  const isFirstProducer = currentIndex === 0;
  const isLastProducer = currentIndex >= producerIds.length - 1;

  const createDraftVariant = (): VariantDraft => ({
    tempId: newId(),
    label: "Nouvelle variante",
    price: 0,
    activeDates: [...editableDateKeys],
  });

  const markProducerDirty = useCallback((producerId: string) => {
    if (!producerId) return;
    setDirtyProducerIds((prev) => (prev.includes(producerId) ? prev : [...prev, producerId]));
  }, []);

  const goToIndex = useCallback(
    (nextIndex: number) => {
      if (!distributionId || !producerIds.length) return;
      const safeIndex = Math.max(0, Math.min(nextIndex, producerIds.length - 1));
      const params = new URLSearchParams(searchParams.toString());
      if (currentProducerId) {
        setDraftsByProducer((prev) => ({ ...prev, [currentProducerId]: draftProducts }));
      }
      params.set("distributionId", distributionId);
      params.set("producerIds", producerIds.join(","));
      params.set("idx", String(safeIndex));
      setEditingProductIndex(null);
      setMessage("");
      router.push(`/admin/vente/gerer?${params.toString()}`);
    },
    [currentProducerId, distributionId, draftProducts, producerIds, router, searchParams],
  );

  useEffect(() => {
    draftsByProducerRef.current = draftsByProducer;
  }, [draftsByProducer]);

  useEffect(() => {
    editableDateKeysByProducerRef.current = editableDateKeysByProducer;
  }, [editableDateKeysByProducer]);

  useEffect(() => {
    dirtyProducerIdsRef.current = dirtyProducerIds;
  }, [dirtyProducerIds]);

  useEffect(() => {
    if (!currentProducerId) return;
    setDraftsByProducer((prev) => ({ ...prev, [currentProducerId]: draftProducts }));
  }, [currentProducerId, draftProducts]);

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

      const calendarData = calendarSnap?.exists()
        ? (calendarSnap.data() as { activeDateKeys?: string[] })
        : null;
      const allowedFromCalendar = Array.isArray(calendarData?.activeDateKeys)
        ? (calendarData.activeDateKeys ?? []).filter((key) => loadedSaleDateKeys.includes(key))
        : [];
      const nextEditableDateKeys = distributionId ? allowedFromCalendar : loadedSaleDateKeys;
      setAllowedDateKeys(nextEditableDateKeys);
      setEditableDateKeysByProducer((prev) => ({
        ...prev,
        [currentProducerId]: nextEditableDateKeys,
      }));

      const variantsByProduct = new Map<string, VariantDraft[]>();
      const variantSnaps = await Promise.all(
        productSnap.docs.map((productDoc) => getDocs(collection(firebaseDb, "products", productDoc.id, "variants"))),
      );

      variantSnaps.forEach((variantSnap, index) => {
        const productId = productSnap.docs[index]?.id;
        if (!productId) return;
        const variants = variantSnap.docs.map((variantDoc) => {
          const variantData = variantDoc.data() as { label?: string; price?: number };
          return {
            id: variantDoc.id,
            tempId: variantDoc.id,
            label: String(variantData.label ?? "Variante"),
            price: Number(variantData.price ?? 0),
            activeDates: [...nextEditableDateKeys],
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
          isSoldByWeight?: boolean;
          estimatedPriceMin?: number;
          estimatedPriceMax?: number;
          saleLimit?: number;
        };
        const variants = variantsByProduct.get(productDoc.id) ?? [];
        nextDrafts.push({
          id: productDoc.id,
          name: String(productData.name ?? "Produit"),
          description: String(productData.description ?? ""),
          imageUrl: String(productData.imageUrl ?? ""),
          isOrganic: Boolean(productData.isOrganic),
          isSoldByWeight: Boolean(productData.isSoldByWeight),
          estimatedPriceMin:
            typeof productData.estimatedPriceMin === "number" && productData.estimatedPriceMin >= 0
              ? String(productData.estimatedPriceMin)
              : "",
          estimatedPriceMax:
            typeof productData.estimatedPriceMax === "number" && productData.estimatedPriceMax >= 0
              ? String(productData.estimatedPriceMax)
              : "",
          limitTotal:
            typeof productData.saleLimit === "number" && productData.saleLimit > 0
              ? String(productData.saleLimit)
              : "",
          variants,
          existingVariantIds: variants.map((variant) => variant.id!).filter(Boolean),
        });
      }
      const loadedDrafts = nextDrafts.length ? nextDrafts : [createDraftProductWithDates(nextEditableDateKeys)];
      const cachedDrafts = draftsByProducerRef.current[currentProducerId];
      const shouldUseCached =
        dirtyProducerIdsRef.current.includes(currentProducerId) && Array.isArray(cachedDrafts);
      setDraftProducts(shouldUseCached ? cachedDrafts : loadedDrafts);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [currentProducerId, distributionId]);

  useEffect(() => {
    if (editingProductIndex === null) return;
    if (!draftProducts[editingProductIndex]) {
      setEditingProductIndex(null);
    }
  }, [draftProducts, editingProductIndex]);

  const updateDraftProduct = (index: number, patch: Partial<ProductDraft>) => {
    markProducerDirty(currentProducerId);
    setDraftProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const updateDraftVariant = (productIndex: number, variantIndex: number, patch: Partial<VariantDraft>) => {
    markProducerDirty(currentProducerId);
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
    markProducerDirty(currentProducerId);
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
    if (product.isSoldByWeight) {
      return formatEstimatedRange(product.estimatedPriceMin, product.estimatedPriceMax);
    }
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
    markProducerDirty(currentProducerId);
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
      isSoldByWeight: false,
      estimatedPriceMin: "",
      estimatedPriceMax: "",
      limitTotal: "",
      variantLabel: "",
      variantPrice: "",
    });
    setShowAddProductModal(true);
  };

  const addProductFromModal = () => {
    const price = Number(addDraft.variantPrice || 0);
    const isSoldByWeight = Boolean(addDraft.isSoldByWeight);
    markProducerDirty(currentProducerId);
    setDraftProducts((prev) => [
      ...prev,
      {
        id: newId(),
        name: addDraft.name.trim() || "Nouveau produit",
        description: addDraft.description.trim(),
        imageUrl: addDraft.imageUrl.trim(),
        isOrganic: Boolean(addDraft.isOrganic),
        isSoldByWeight,
        estimatedPriceMin: isSoldByWeight ? addDraft.estimatedPriceMin.trim() : "",
        estimatedPriceMax: isSoldByWeight ? addDraft.estimatedPriceMax.trim() : "",
        limitTotal: addDraft.limitTotal.trim(),
        variants: [
          {
            id: undefined,
            tempId: newId(),
            label: addDraft.variantLabel.trim() || "Variante",
            price: isSoldByWeight ? 0 : Number.isFinite(price) ? price : 0,
            activeDates: [...editableDateKeys],
          },
        ],
        existingVariantIds: [],
      },
    ]);
    setShowAddProductModal(false);
  };

  const saveProducerDraft = useCallback(
    async (producerId: string, producerDrafts: ProductDraft[], producerEditableDateKeys: string[], validatedByMemberId?: string | null) => {
      const savedProducts: Array<{
        id: string;
        name: string;
        imageUrl: string;
        isOrganic: boolean;
        isSoldByWeight: boolean;
        limitTotal: number;
        variants: Array<{ id: string; label: string; price: number; activeDates: string[] }>;
      }> = [];

      const batchOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
      const now = Timestamp.now();
      const selectedDateKeys = Array.from(
        new Set(producerEditableDateKeys.filter((key) => saleDateKeys.includes(key))),
      );

      for (const product of producerDrafts) {
        const parsedLimit = Number(product.limitTotal || 0);
        const isSoldByWeight = Boolean(product.isSoldByWeight);
        const estimatedPriceMin = isSoldByWeight ? parseNullableNumber(product.estimatedPriceMin) : null;
        const estimatedPriceMax = isSoldByWeight ? parseNullableNumber(product.estimatedPriceMax) : null;
        const productId = product.id.startsWith("tmp_")
          ? doc(collection(firebaseDb, "products")).id
          : product.id;
        const payload = {
          producerId,
          name: product.name.trim() || "Produit",
          description: product.description.trim(),
          imageUrl: product.imageUrl.trim(),
          isOrganic: Boolean(product.isOrganic),
          isSoldByWeight,
          estimatedPriceMin,
          estimatedPriceMax,
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
            new Set(variant.activeDates.filter((key) => selectedDateKeys.includes(key))),
          );
          const variantPayload = {
            label: variant.label.trim() || "Variante",
            price: isSoldByWeight ? 0 : Number(variant.price || 0),
            activeDates: selectedActiveDates,
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
          isSoldByWeight: payload.isSoldByWeight,
          limitTotal: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 0,
          variants: savedVariants,
        });
      }

      if (distributionId) {
        const producerRef = doc(firebaseDb, "distributionDates", distributionId, "producers", producerId);
        const offerItemsRef = collection(firebaseDb, "distributionDates", distributionId, "offerItems");

        const existingOfferSnap = await getDocs(query(offerItemsRef, where("producerId", "==", producerId)));
        existingOfferSnap.docs.forEach((offerDoc) => {
          batchOps.push((batch) => batch.delete(offerDoc.ref));
        });

        savedProducts.forEach((product) => {
          product.variants.forEach((variant) => {
            variant.activeDates.forEach((saleDateKey) => {
              const offerRef = doc(offerItemsRef);
              batchOps.push((batch) =>
                batch.set(offerRef, {
                  producerId,
                  productId: product.id,
                  variantId: variant.id,
                  saleDateKey,
                  title: product.name,
                  variantLabel: variant.label,
                  imageUrl: product.imageUrl || null,
                  isOrganic: product.isOrganic,
                  priceApplied: product.isSoldByWeight ? 0 : variant.price,
                  isSoldByWeight: product.isSoldByWeight,
                  limitTotal: product.limitTotal,
                  active: true,
                }),
              );
            });
          });
        });

        const producerSnap = await getDoc(doc(firebaseDb, "producers", producerId));
        const producerData = producerSnap.exists()
          ? (producerSnap.data() as { referentId?: string | null; referentName?: string | null })
          : {};

        batchOps.push((batch) =>
          batch.set(
            producerRef,
            {
              producerId,
              referentId: producerData.referentId ?? null,
              referentName: producerData.referentName ?? null,
              active: selectedDateKeys.length > 0,
              activeDateKeys: selectedDateKeys,
              validatedByReferent: true,
              validatedAt: now,
              validatedByMemberId: validatedByMemberId ?? null,
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
    },
    [distributionId, saleDateKeys],
  );

  const loadProducerDraftsFromDb = useCallback(
    async (producerId: string, producerEditableDateKeys: string[]) => {
      const selectedDateKeys = Array.from(
        new Set(producerEditableDateKeys.filter((key) => saleDateKeys.includes(key))),
      );
      const productSnap = await getDocs(
        query(collection(firebaseDb, "products"), where("producerId", "==", producerId)),
      );
      const variantSnaps = await Promise.all(
        productSnap.docs.map((productDoc) =>
          getDocs(collection(firebaseDb, "products", productDoc.id, "variants")),
        ),
      );

      return productSnap.docs.map((productDoc, productIndex) => {
        const productData = productDoc.data() as {
          name?: string;
          description?: string;
          imageUrl?: string;
          isOrganic?: boolean;
          isSoldByWeight?: boolean;
          estimatedPriceMin?: number;
          estimatedPriceMax?: number;
          saleLimit?: number;
        };
        const variants = (variantSnaps[productIndex]?.docs ?? []).map((variantDoc) => {
          const variantData = variantDoc.data() as {
            label?: string;
            price?: number;
          };
          return {
            id: variantDoc.id,
            tempId: variantDoc.id,
            label: String(variantData.label ?? "Variante"),
            price: Number(variantData.price ?? 0),
            activeDates: [...selectedDateKeys],
          } satisfies VariantDraft;
        });

        return {
          id: productDoc.id,
          name: String(productData.name ?? "Produit"),
          description: String(productData.description ?? ""),
          imageUrl: String(productData.imageUrl ?? ""),
          isOrganic: Boolean(productData.isOrganic),
          isSoldByWeight: Boolean(productData.isSoldByWeight),
          estimatedPriceMin:
            typeof productData.estimatedPriceMin === "number" && productData.estimatedPriceMin >= 0
              ? String(productData.estimatedPriceMin)
              : "",
          estimatedPriceMax:
            typeof productData.estimatedPriceMax === "number" && productData.estimatedPriceMax >= 0
              ? String(productData.estimatedPriceMax)
              : "",
          limitTotal:
            typeof productData.saleLimit === "number" && productData.saleLimit > 0
              ? String(productData.saleLimit)
              : "",
          variants,
          existingVariantIds: variants.map((variant) => variant.id!).filter(Boolean),
        } satisfies ProductDraft;
      });
    },
    [saleDateKeys],
  );

  const resolveProducerEditableDateKeys = useCallback(
    async (producerId: string) => {
      const cached = editableDateKeysByProducerRef.current[producerId];
      if (Array.isArray(cached)) return cached;
      if (!distributionId) return [...saleDateKeys];
      const calendarSnap = await getDoc(
        doc(firebaseDb, "distributionDates", distributionId, "calendarProducers", producerId),
      );
      if (!calendarSnap.exists()) return [];
      const calendarData = calendarSnap.data() as { activeDateKeys?: string[] };
      if (!Array.isArray(calendarData.activeDateKeys)) return [];
      return calendarData.activeDateKeys.filter(
        (key): key is string => typeof key === "string" && saleDateKeys.includes(key),
      );
    },
    [distributionId, saleDateKeys],
  );

  const saveDraft = async () => {
    if (!currentProducerId) return;
    if (editingLocked) {
      setMessage("Cette distribution est ouverte : modifications reservees aux admins.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const drafts =
        draftsByProducerRef.current[currentProducerId] ??
        draftProducts;
      const producerDateKeys = await resolveProducerEditableDateKeys(currentProducerId);
      const producerDrafts =
        dirtyProducerIds.includes(currentProducerId) || drafts.length > 0
          ? drafts
          : await loadProducerDraftsFromDb(currentProducerId, producerDateKeys);
      await saveProducerDraft(currentProducerId, producerDrafts, producerDateKeys, effectiveMemberId);

      setDirtyProducerIds((prev) => prev.filter((id) => id !== currentProducerId));
      setMessage("Producteur enregistre et valide.");
      router.push(distributionLocked ? "/admin/vente/en-cours" : "/admin/vente/prochaine");
    } finally {
      setSaving(false);
    }
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
              <p className="mt-1 text-sm text-ink/70">
                Producteur {currentIndex + 1}/{producerIds.length}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasManyProducers ? (
              <>
                <button
                  className="rounded-md border border-ink/30 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  onClick={() => goToIndex(currentIndex - 1)}
                  disabled={isFirstProducer}
                >
                  Precedent
                </button>
                <button
                  className="rounded-md border border-ink/30 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  onClick={() => goToIndex(currentIndex + 1)}
                  disabled={isLastProducer}
                >
                  Suivant
                </button>
              </>
            ) : null}
            <button className="rounded-md border border-ink/30 px-4 py-2 text-sm font-semibold" onClick={() => router.push(backToSalesPath)}>
              {backToSalesLabel}
            </button>
          </div>
        </div>
      </section>

      <section className="border border-ink/20 bg-stone/90 p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={() => applyAllDates(true)} disabled={saving || editingLocked}>Tout sélectionner</button>
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={() => applyAllDates(false)} disabled={saving || editingLocked}>Tout désélectionner</button>
          <button className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={openAddModal} disabled={saving || editingLocked}>Ajouter un produit</button>
        </div>
        {editingLocked ? (
          <p className="mb-3 text-sm font-semibold text-ember">Cette distribution est ouverte : edition reservee aux admins.</p>
        ) : distributionLocked ? (
          <p className="mb-3 text-sm font-semibold text-moss">Vente ouverte : modifications autorisees (admin).</p>
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
                      {product.isSoldByWeight ? (
                        <div className="rounded-md border border-ink/20 bg-ink/5 px-2 py-1 text-xs font-semibold text-ink/70">
                          <p>0,00 EUR</p>
                          <p className="font-normal">{formatEstimatedRange(product.estimatedPriceMin, product.estimatedPriceMax)}</p>
                        </div>
                      ) : product.variants.length === 1 ? (
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
                        <button
                          className="rounded-md border border-ink/25 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                          onClick={() => setEditingProductIndex(productIndex)}
                          disabled={saving}
                        >
                          Editer
                        </button>
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
                        <input className="w-24 rounded-md border border-ink/25 px-2 py-1 text-sm disabled:bg-stone/60 disabled:text-ink/50" type="number" step="0.01" value={String(product.isSoldByWeight ? 0 : variant.price)} disabled={product.isSoldByWeight} onChange={(e) => updateDraftVariant(productIndex, variantIndex, { price: Number(e.target.value || 0) })} />
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

      {editingProduct ? (
        <div
          className="fixed inset-0 z-50 bg-ink/40"
          onClick={() => setEditingProductIndex(null)}
        >
          <aside
            className="absolute inset-y-0 right-0 w-full max-w-[1040px] overflow-x-hidden overflow-y-auto border-l border-clay/70 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
                  Edition produit
                </p>
                <h3 className="mt-1 font-serif text-3xl text-ink">
                  {editingProduct.name || "Produit"}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {!editingProduct.id.startsWith("tmp_") ? (
                  <a
                    href={`/products/${editingProduct.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-ink/25 px-3 py-2 text-xs font-semibold text-ink"
                  >
                    Voir la fiche
                  </a>
                ) : null}
                <button
                  className="rounded-md border border-ink/25 px-3 py-2 text-xs font-semibold text-ink"
                  onClick={() => setEditingProductIndex(null)}
                >
                  Fermer
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="grid gap-3">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Nom produit
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={editingProduct.name}
                    disabled={editingLocked}
                    onChange={(event) =>
                      updateDraftProduct(editingProductIndex!, { name: event.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Description
                  <textarea
                    className="min-h-[120px] rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={editingProduct.description}
                    disabled={editingLocked}
                    onChange={(event) =>
                      updateDraftProduct(editingProductIndex!, { description: event.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Image URL
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={editingProduct.imageUrl}
                    disabled={editingLocked}
                    onChange={(event) =>
                      updateDraftProduct(editingProductIndex!, { imageUrl: event.target.value })
                    }
                  />
                </label>

                <div className="rounded-xl border border-clay/70 bg-stone/40 p-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={editingProduct.isOrganic}
                      disabled={editingLocked}
                      onChange={(event) =>
                        updateDraftProduct(editingProductIndex!, { isOrganic: event.target.checked })
                      }
                    />
                    Produit bio
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={editingProduct.isSoldByWeight}
                      disabled={editingLocked}
                      onChange={(event) =>
                        updateDraftProduct(editingProductIndex!, {
                          isSoldByWeight: event.target.checked,
                          variants: event.target.checked
                            ? editingProduct.variants.map((variant) => ({ ...variant, price: 0 }))
                            : editingProduct.variants,
                        })
                      }
                    />
                    Produit au poids (prix final après pesée)
                  </label>

                  {editingProduct.isSoldByWeight ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                        Prix estime min
                        <input
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                          type="number"
                          min={0}
                          step="0.01"
                          value={editingProduct.estimatedPriceMin}
                          disabled={editingLocked}
                          onChange={(event) =>
                            updateDraftProduct(editingProductIndex!, { estimatedPriceMin: event.target.value })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                        Prix estime max
                        <input
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                          type="number"
                          min={0}
                          step="0.01"
                          value={editingProduct.estimatedPriceMax}
                          disabled={editingLocked}
                          onChange={(event) =>
                            updateDraftProduct(editingProductIndex!, { estimatedPriceMax: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  <label className="mt-3 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                    Stock limite (optionnel)
                    <input
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                      type="number"
                      min={0}
                      value={editingProduct.limitTotal}
                      disabled={editingLocked}
                      onChange={(event) =>
                        updateDraftProduct(editingProductIndex!, { limitTotal: event.target.value })
                      }
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink/70">Variantes</p>
                  <button
                    className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                    onClick={() =>
                      updateDraftProduct(editingProductIndex!, {
                        variants: [...editingProduct.variants, createDraftVariant()],
                      })
                    }
                    disabled={editingLocked}
                  >
                    Ajouter une option
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-clay/70 bg-white">
                  <table className="min-w-[560px] w-full text-sm">
                    <thead className="border-b border-clay/70 bg-stone/70 text-[11px] uppercase tracking-[0.2em] text-ink/60">
                      <tr>
                        <th className="px-3 py-2 text-left">Variante</th>
                        <th className="px-3 py-2 text-left">Prix</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingProduct.variants.map((variant, variantIndex) => (
                        <tr key={variant.tempId} className="border-b border-clay/50">
                          <td className="px-3 py-2">
                            <input
                              className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                              value={variant.label}
                              disabled={editingLocked}
                              onChange={(event) =>
                                updateDraftVariant(editingProductIndex!, variantIndex, { label: event.target.value })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm disabled:bg-stone/60 disabled:text-ink/50"
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(editingProduct.isSoldByWeight ? 0 : variant.price)}
                              disabled={editingLocked || editingProduct.isSoldByWeight}
                              onChange={(event) =>
                                updateDraftVariant(editingProductIndex!, variantIndex, { price: Number(event.target.value || 0) })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                              disabled={editingLocked || editingProduct.variants.length <= 1}
                              onClick={() =>
                                updateDraftProduct(editingProductIndex!, {
                                  variants: editingProduct.variants.filter((_, idx) => idx !== variantIndex),
                                })
                              }
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 overflow-x-auto rounded-2xl border border-clay/70 bg-white">
                  <table className="min-w-[560px] w-full text-xs">
                    <thead className="border-b border-clay/70 bg-stone/70 uppercase tracking-[0.15em] text-ink/60">
                      <tr>
                        <th className="px-3 py-2 text-left">Disponibilite</th>
                        {saleDates.map((date) => (
                          <th key={`drawer-date-${date.key}`} className="px-2 py-2 text-center">
                            {date.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editingProduct.variants.map((variant, variantIndex) => (
                        <tr key={`drawer-row-${variant.tempId}`} className="border-b border-clay/40">
                          <td className="px-3 py-2 font-semibold text-ink/75">
                            {variant.label || `Variante ${variantIndex + 1}`}
                          </td>
                          {saleDates.map((date) => (
                            <td key={`drawer-cell-${variant.tempId}-${date.key}`} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={variant.activeDates.includes(date.key)}
                                disabled={editingLocked || !editableDateKeys.includes(date.key)}
                                onChange={() =>
                                  updateDraftVariant(editingProductIndex!, variantIndex, {
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

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
                  <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm disabled:bg-stone/60 disabled:text-ink/55" type="number" step="0.01" value={addDraft.isSoldByWeight ? "0" : addDraft.variantPrice} disabled={addDraft.isSoldByWeight} onChange={(e) => setAddDraft((prev) => ({ ...prev, variantPrice: e.target.value }))} />
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
              <label className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  checked={addDraft.isSoldByWeight}
                  onChange={(e) =>
                    setAddDraft((prev) => ({
                      ...prev,
                      isSoldByWeight: e.target.checked,
                      variantPrice: e.target.checked ? "0" : prev.variantPrice,
                    }))
                  }
                />
                Produit au poids (prix final après pesée)
              </label>
              {addDraft.isSoldByWeight ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                    Prix estimatif min
                    <input
                      className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm"
                      type="number"
                      min={0}
                      step="0.01"
                      value={addDraft.estimatedPriceMin}
                      onChange={(e) => setAddDraft((prev) => ({ ...prev, estimatedPriceMin: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                    Prix estimatif max
                    <input
                      className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm"
                      type="number"
                      min={0}
                      step="0.01"
                      value={addDraft.estimatedPriceMax}
                      onChange={(e) => setAddDraft((prev) => ({ ...prev, estimatedPriceMax: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white" onClick={addProductFromModal}>Ajouter ce produit</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink/70">
          <p>{message}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasManyProducers ? (
            <>
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => goToIndex(currentIndex - 1)}
                disabled={saving || isFirstProducer}
              >
                Precedent
              </button>
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => goToIndex(currentIndex + 1)}
                disabled={saving || isLastProducer}
              >
                Suivant
              </button>
            </>
          ) : null}
          <button
            className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={saveDraft}
            disabled={saving || editingLocked}
          >
            Enregistrer et valider
          </button>
        </div>
      </div>
    </div>
  );
}
