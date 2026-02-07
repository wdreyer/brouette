"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel } from "@/lib/distributions";

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
  email?: string;
  phone?: string;
};

type Category = {
  id: string;
  name?: string;
};

type Product = {
  id: string;
  producerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
  categoryId?: string;
  saleDates?: { toDate?: () => Date }[];
};

type Variant = {
  id: string;
  productId: string;
  label: string;
  price: number;
  activeDates?: string[];
};

type OfferDraft = {
  enabled: boolean;
  limitPerMember: string;
  limitTotal: string;
};

type ProductDraft = {
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  categoryId: string;
};

type AddProductDraft = ProductDraft & {
  variantLabel: string;
  variantPrice: string;
};

function offerKey(productId: string, variantId: string, dateIndex: number) {
  return `${productId}:${variantId}:${dateIndex}`;
}

function dateLabel(date?: Date) {
  if (!date) return "-";
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function shortDate(date?: Date) {
  if (!date) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

type OpenSalesWizardProps = {
  onFocusChange?: (focused: boolean) => void;
};

export default function OpenSalesWizard({ onFocusChange }: OpenSalesWizardProps) {
  const [loading, setLoading] = useState(true);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedDistributionId, setSelectedDistributionId] = useState("");
  const [selectedProducerIds, setSelectedProducerIds] = useState<string[]>([]);
  const [offerDraft, setOfferDraft] = useState<Record<string, OfferDraft>>({});
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "opening" | "error">("idle");

  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [editProductDraft, setEditProductDraft] = useState<ProductDraft | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addProductDraft, setAddProductDraft] = useState<AddProductDraft>({
    name: "",
    description: "",
    imageUrl: "",
    isOrganic: false,
    categoryId: "",
    variantLabel: "",
    variantPrice: "",
  });

  const selectedDistribution = useMemo(
    () => distributions.find((dist) => dist.id === selectedDistributionId),
    [distributions, selectedDistributionId],
  );

  const openDistribution = useMemo(
    () => distributions.find((dist) => dist.status === "open") ?? null,
    [distributions],
  );

  const nextDistribution = useMemo(() => {
    const today = new Date();
    const sorted = [...distributions].sort((a, b) => {
      const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
      const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
      return aDate.getTime() - bDate.getTime();
    });
    const candidates = sorted.filter((dist) => dist.status !== "open");
    return (
      candidates.find((dist) => {
        const firstDate = dist.dates?.[0]?.toDate?.() ?? new Date(0);
        return firstDate >= today;
      }) ?? candidates[0] ?? null
    );
  }, [distributions]);

  const dates = useMemo(
    () => (selectedDistribution?.dates ?? []).slice(0, 3).map((d) => d.toDate()),
    [selectedDistribution],
  );

  const selectedProducers = useMemo(
    () => producers.filter((producer) => selectedProducerIds.includes(producer.id)),
    [producers, selectedProducerIds],
  );

  const producerSteps = useMemo(() => selectedProducers, [selectedProducers]);
  const currentProducerIndex = Math.max(0, step - 2);
  const currentProducer = producerSteps[currentProducerIndex] ?? null;

  const productsByProducer = useMemo(() => {
    const map: Record<string, Product[]> = {};
    products.forEach((product) => {
      if (!map[product.producerId]) map[product.producerId] = [];
      map[product.producerId].push(product);
    });
    return map;
  }, [products]);

  const variantsByProduct = useMemo(() => {
    const map: Record<string, Variant[]> = {};
    variants.forEach((variant) => {
      if (!map[variant.productId]) map[variant.productId] = [];
      map[variant.productId].push(variant);
    });
    return map;
  }, [variants]);

  const totalSteps = 2 + producerSteps.length + 1;
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [distSnap, producersSnap, categoriesSnap, productsSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "distributionDates")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "categories")),
        getDocs(collection(firebaseDb, "products")),
      ]);

      const distItems = distSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Distribution, "id">),
      }));
      distItems.sort((a, b) => {
        const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
        const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
        return aDate.getTime() - bDate.getTime();
      });
      setDistributions(distItems);

      const producerItems = producersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Producer, "id">),
      }));
      setProducers(producerItems);

      const categoryItems = categoriesSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Category, "id">),
      }));
      setCategories(categoryItems);

      const productItems = productsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Product, "id">),
      }));
      setProducts(productItems);

      const variantSnaps = await Promise.all(
        productItems.map((product) =>
          getDocs(collection(firebaseDb, "products", product.id, "variants")),
        ),
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
      setOfferDraft({});

      if (producerItems.length) {
        setSelectedProducerIds((prev) => (prev.length ? prev : producerItems.map((p) => p.id)));
      }

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [selectedDistributionId]);

  useEffect(() => {
    if (step === 0) {
      setOfferDraft({});
    }
  }, [step]);

  useEffect(() => {
    if (!selectedDistributionId && nextDistribution) {
      setSelectedDistributionId(nextDistribution.id);
    }
  }, [nextDistribution, selectedDistributionId]);

  useEffect(() => {
    onFocusChange?.(step > 0);
  }, [step, onFocusChange]);

  useEffect(() => {
    if (!currentProducer) return;
    const producerProducts = productsByProducer[currentProducer.id] ?? [];
    if (!producerProducts.length) return;

    setOfferDraft((prev) => {
      const next = { ...prev };
      const dateKeys = dates.map((date) => dateKey(date));
      producerProducts.forEach((product) => {
        const productVariants = variantsByProduct[product.id] ?? [];
        productVariants.forEach((variant) => {
          const variantDates = Array.isArray(variant.activeDates) ? variant.activeDates : [];
          dateKeys.forEach((dateValue, index) => {
            const key = offerKey(product.id, variant.id, index);
            if (!next[key]) {
              const enabled = variantDates.length ? variantDates.includes(dateValue) : true;
              next[key] = { enabled, limitPerMember: "", limitTotal: "" };
            }
          });
        });
      });
      return next;
    });
  }, [currentProducer, productsByProducer, variantsByProduct, dates]);

  const toggleProducer = (id: string) => {
    setSelectedProducerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const updateOfferDraft = (
    productId: string,
    variantId: string,
    dateIndex: number,
    patch: Partial<OfferDraft>,
  ) => {
    const key = offerKey(productId, variantId, dateIndex);
    setOfferDraft((prev) => {
      const current = prev[key] ?? { enabled: false, limitPerMember: "", limitTotal: "" };
      return { ...prev, [key]: { ...current, ...patch } };
    });
  };

  const enableAllDatesForVariant = (productId: string, variantId: string) => {
    dates.forEach((_, index) => updateOfferDraft(productId, variantId, index, { enabled: true }));
  };

  const enableAllDatesForProduct = (productId: string) => {
    const productVariants = variantsByProduct[productId] ?? [];
    productVariants.forEach((variant) => enableAllDatesForVariant(productId, variant.id));
  };

  const openEditProduct = (product: Product) => {
    setEditProductId(product.id);
    setEditProductDraft({
      name: product.name ?? "",
      description: product.description ?? "",
      imageUrl: product.imageUrl ?? "",
      isOrganic: Boolean(product.isOrganic),
      categoryId: product.categoryId ?? "",
    });
  };

  const saveProduct = async () => {
    if (!editProductId || !editProductDraft) return;
    try {
      setStatus("saving");
      await setDoc(doc(firebaseDb, "products", editProductId), editProductDraft, { merge: true });
      setProducts((prev) =>
        prev.map((item) => (item.id === editProductId ? { ...item, ...editProductDraft } : item)),
      );
      setEditProductId(null);
      setEditProductDraft(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const saveVariantsForProducer = async (producerId: string) => {
    const producerProducts = productsByProducer[producerId] ?? [];
    const dateKeys = dates.map((date) => dateKey(date));
    const tasks: Promise<void>[] = [];
    const productDateMap: Record<string, Set<string>> = {};

    producerProducts.forEach((product) => {
      productDateMap[product.id] = new Set();
      const productVariants = variantsByProduct[product.id] ?? [];
      productVariants.forEach((variant) => {
        const activeDates = dateKeys.filter((_, index) => {
          const key = offerKey(product.id, variant.id, index);
          return Boolean(offerDraft[key]?.enabled);
        });
        activeDates.forEach((key) => productDateMap[product.id].add(key));
        tasks.push(
          setDoc(
            doc(firebaseDb, "products", product.id, "variants", variant.id),
            {
              label: variant.label,
              price: Number(variant.price || 0),
              activeDates,
            },
            { merge: true },
          ) as unknown as Promise<void>,
        );
      });
    });
    await Promise.all(tasks);

    const productTasks = Object.entries(productDateMap).map(([productId, dateSet]) => {
      const saleDates = Array.from(dateSet).map((key) => Timestamp.fromDate(dateFromKey(key)));
      return setDoc(doc(firebaseDb, "products", productId), { saleDates }, { merge: true }) as unknown as Promise<void>;
    });
    await Promise.all(productTasks);
  };

  const saveOffersForProducer = async (producerId: string) => {
    if (!selectedDistributionId) return;
    const distRef = doc(firebaseDb, "distributionDates", selectedDistributionId);
    const offerSnap = await getDocs(collection(distRef, "offerItems"));
    const batch = writeBatch(firebaseDb);

    offerSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.producerId === producerId) {
        batch.delete(docSnap.ref);
      }
    });

    const producerProducts = productsByProducer[producerId] ?? [];
    const productMap: Record<string, Product> = {};
    producerProducts.forEach((product) => {
      productMap[product.id] = product;
    });
    const variantMap: Record<string, Variant> = {};
    variants.forEach((variant) => {
      if (productMap[variant.productId]) {
        variantMap[`${variant.productId}:${variant.id}`] = variant;
      }
    });

    Object.entries(offerDraft).forEach(([key, draft]) => {
      if (!draft.enabled) return;
      const [productId, variantId, dateIndexRaw] = key.split(":");
      const variant = variantMap[`${productId}:${variantId}`];
      if (!variant) return;
      const product = productMap[productId];
      if (!product) return;
      const dateIndex = Number(dateIndexRaw);
      const limitPerMember = draft.limitPerMember ? Number(draft.limitPerMember) : 0;
      const limitTotal = draft.limitTotal ? Number(draft.limitTotal) : 0;

      const ref = doc(collection(distRef, "offerItems"));
      batch.set(ref, {
        producerId: product.producerId,
        productId: product.id,
        variantId: variant.id,
        dateIndex,
        limitPerMember,
        limitTotal,
        price: variant.price,
        title: product.name,
        variantLabel: variant.label,
        imageUrl: product.imageUrl ?? null,
        isOrganic: Boolean(product.isOrganic),
        categoryId: product.categoryId ?? null,
      });
    });

    await batch.commit();
  };

  const saveProducerStep = async () => {
    if (!currentProducer) return;
    try {
      setStatus("saving");
      setMessage("");
      await saveVariantsForProducer(currentProducer.id);
      await saveOffersForProducer(currentProducer.id);
      setMessage(`${currentProducer.name ?? "Producteur"} enregistre.`);
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const saveSelectedProducers = async () => {
    if (!selectedDistributionId) return;
    const distRef = doc(firebaseDb, "distributionDates", selectedDistributionId);
    const producerSnap = await getDocs(collection(distRef, "producers"));
    const batch = writeBatch(firebaseDb);
    producerSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    selectedProducerIds.forEach((producerId) => {
      batch.set(doc(collection(distRef, "producers"), producerId), { producerId, active: true });
    });
    await batch.commit();

    const dateKeys = dates.map((date) => dateKey(date));
    if (!dateKeys.length) return;

    const deselected = producers
      .map((producer) => producer.id)
      .filter((id) => !selectedProducerIds.includes(id));
    if (!deselected.length) return;

    const updatedVariants: { productId: string; id: string; activeDates: string[] }[] = [];
    const updatedProducts: { id: string; saleDates: Timestamp[] }[] = [];

    deselected.forEach((producerId) => {
      const producerProducts = productsByProducer[producerId] ?? [];
      producerProducts.forEach((product) => {
        const productVariants = variantsByProduct[product.id] ?? [];
        const fallbackKeys = (product.saleDates ?? [])
          .map((date) => date.toDate?.())
          .filter(Boolean)
          .map((date) => dateKey(date as Date));
        const nextDates = new Set<string>();
        productVariants.forEach((variant) => {
          const currentKeys =
            Array.isArray(variant.activeDates) && variant.activeDates.length
              ? variant.activeDates
              : fallbackKeys;
          const nextKeys = currentKeys.filter((key) => !dateKeys.includes(key));
          nextKeys.forEach((key) => nextDates.add(key));
          updatedVariants.push({ productId: product.id, id: variant.id, activeDates: nextKeys });
        });
        updatedProducts.push({
          id: product.id,
          saleDates: Array.from(nextDates).map((key) => Timestamp.fromDate(dateFromKey(key))),
        });
      });
    });

    await Promise.all(
      updatedVariants.map((variant) =>
        setDoc(
          doc(firebaseDb, "products", variant.productId, "variants", variant.id),
          { activeDates: variant.activeDates },
          { merge: true },
        ),
      ),
    );

    await Promise.all(
      updatedProducts.map((product) =>
        setDoc(doc(firebaseDb, "products", product.id), { saleDates: product.saleDates }, { merge: true }),
      ),
    );

    if (updatedVariants.length) {
      const updateMap = new Map(
        updatedVariants.map((variant) => [`${variant.productId}:${variant.id}`, variant.activeDates]),
      );
      setVariants((prev) =>
        prev.map((variant) => {
          const key = `${variant.productId}:${variant.id}`;
          const activeDates = updateMap.get(key);
          return activeDates ? { ...variant, activeDates } : variant;
        }),
      );
    }
    if (updatedProducts.length) {
      const productMap = new Map(updatedProducts.map((product) => [product.id, product.saleDates]));
      setProducts((prev) =>
        prev.map((product) => {
          const saleDates = productMap.get(product.id);
          return saleDates ? { ...product, saleDates } : product;
        }),
      );
    }
  };

  const openSale = async () => {
    if (!selectedDistributionId) return;
    try {
      setStatus("opening");
      if (openDistribution && openDistribution.id !== selectedDistributionId) {
        setMessage("Ferme d'abord la vente ouverte avant d'en ouvrir une nouvelle.");
        setStatus("idle");
        return;
      }
      if (!openDistribution && nextDistribution && selectedDistributionId !== nextDistribution.id) {
        setMessage("Tu peux ouvrir uniquement la prochaine distribution.");
        setStatus("idle");
        return;
      }
      const distRef = doc(firebaseDb, "distributionDates", selectedDistributionId);
      const allSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      const batch = writeBatch(firebaseDb);
      allSnap.docs.forEach((docSnap) => {
        if (docSnap.id !== selectedDistributionId && docSnap.data().status === "open") {
          batch.update(docSnap.ref, { status: "finished" });
        }
      });
      batch.update(distRef, {
        status: "open",
        openedAt: Timestamp.now(),
      });
      await batch.commit();
      setMessage("Vente ouverte.");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const closeOpenSale = async () => {
    if (!openDistribution) return;
    try {
      setStatus("opening");
      await updateDoc(doc(firebaseDb, "distributionDates", openDistribution.id), {
        status: "finished",
      });
      setMessage("Vente fermee.");
      setSelectedDistributionId("");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setStatus("idle");
    }
  };

  const currentProducerProducts = currentProducer ? productsByProducer[currentProducer.id] ?? [] : [];

  const stepTitle = useMemo(() => {
    if (step === 0) return "Preparer la prochaine distribution";
    if (step === 1) return "Selectionner les producteurs";
    if (step >= 2 && step < 2 + producerSteps.length) {
      return `Configurer ${currentProducer?.name ?? "producteur"}`;
    }
    return "Finaliser";
  }, [step, producerSteps.length, currentProducer]);

  const goNext = async () => {
    if (step === 1) {
      await saveSelectedProducers();
    }
    if (step >= 2 && step < 2 + producerSteps.length) {
      await saveProducerStep();
    }
    setStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const goPrev = () => {
    setStep((prev) => Math.max(prev - 1, 0));
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-8 shadow-card">
        <p className="text-sm text-ink/70">Chargement...</p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-clay/70 bg-white/90 p-8 shadow-card">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-moss">
          Etape {Math.min(step + 1, totalSteps)} / {totalSteps}
        </p>
        <h2 className="font-serif text-3xl">{stepTitle}</h2>
        {message ? <p className="text-sm text-ink/70">{message}</p> : null}
      </div>

      {step === 0 ? (
        <div className="mt-6 flex flex-col gap-4">
          {openDistribution ? (
            <div className="rounded-2xl border border-amber-200/60 bg-amber-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                Vente ouverte
              </p>
              <p className="mt-2 text-sm text-amber-800">
                {distributionLabel(openDistribution)}. Tu dois la fermer avant d&apos;en ouvrir une
                nouvelle.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800"
                  onClick={closeOpenSale}
                >
                  Fermer la vente
                </button>
                <button
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
                  onClick={() => {
                    setSelectedDistributionId(openDistribution.id);
                    setStep(2);
                  }}
                >
                  Modifier la vente ouverte
                </button>
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-clay/70 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
              Prochaine distribution
            </p>
            {nextDistribution ? (
              <>
                <p className="mt-2 text-sm text-ink/70">
                  {distributionLabel(nextDistribution)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink/70">
                  {(nextDistribution.dates ?? []).slice(0, 3).map((date, index) => (
                    <span key={index} className="rounded-full border border-clay/70 px-2 py-0.5">
                      {shortDate(date.toDate())}
                    </span>
                  ))}
                </div>
                {openDistribution ? (
                  <p className="mt-2 text-xs text-ink/50">
                    La vente actuelle doit etre fermee avant d&apos;ouvrir celle-ci.
                  </p>
                ) : null}
                <div className="mt-4">
                  <button
                    className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                    onClick={goNext}
                    disabled={Boolean(openDistribution)}
                  >
                    Ouvrir la vente
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink/70">Aucune distribution planifiee.</p>
            )}
          </div>
        <div className="rounded-2xl border border-clay/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
            {openDistribution ? "Vente ouverte" : "Aucune vente ouverte"}
          </p>
          {openDistribution ? (
            <p className="mt-2 text-sm text-ink/70">La vente est deja ouverte.</p>
          ) : (
            <p className="mt-2 text-sm text-ink/70">
              Ouvrir la vente. La prochaine distribution est selectionnee automatiquement.
            </p>
          )}
        </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-6 rounded-2xl border border-clay/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteurs</p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/70 text-xs uppercase tracking-[0.2em] text-ink/60">
                <tr>
                  <th className="px-3 py-2">Selection</th>
                  <th className="px-3 py-2">Producteur</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Telephone</th>
                </tr>
              </thead>
              <tbody>
                {producers.map((producer) => (
                  <tr key={producer.id} className="border-b border-clay/50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedProducerIds.includes(producer.id)}
                        onChange={() => toggleProducer(producer.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-semibold text-ink">
                      {producer.name ?? producer.id}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/60">{producer.email ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-ink/60">{producer.phone ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {step >= 2 && step < 2 + producerSteps.length && currentProducer ? (
        <div className="mt-6 flex flex-col gap-6">
          <div className="rounded-2xl border border-clay/70 bg-white/90 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteur</p>
                <h3 className="font-serif text-2xl">{currentProducer.name ?? currentProducer.id}</h3>
              </div>
              <button
                className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-stone"
                onClick={() => setAddProductOpen(true)}
              >
                Ajouter un produit
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink/60">
              {dates.map((date, index) => (
                <span key={index} className="rounded-full border border-clay/70 bg-white px-3 py-1">
                  {dateLabel(date)}
                </span>
              ))}
            </div>
          </div>

          {currentProducerProducts.length === 0 ? (
            <p className="text-sm text-ink/70">Aucun produit pour ce producteur.</p>
          ) : (
            currentProducerProducts.map((product) => {
              const productVariants = variantsByProduct[product.id] ?? [];
              return (
                <div key={product.id} className="rounded-2xl border border-clay/70 bg-white/95 p-5 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produit</p>
                      <h4 className="font-serif text-xl">{product.name}</h4>
                    </div>
                    <div className="flex items-center gap-3">
                  <button
                    className="rounded-full border border-ink/20 px-3 py-1 text-[11px] font-semibold"
                    onClick={() => enableAllDatesForProduct(product.id)}
                  >
                    Tout cocher
                      </button>
                      <button
                        className="rounded-full border border-ink/20 px-3 py-1 text-[11px] font-semibold"
                        onClick={() => openEditProduct(product)}
                      >
                        Modifier
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto rounded-lg border border-clay/70 bg-white">
                    <div
                      className="min-w-[720px] border-b border-clay/70 bg-stone px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60"
                      style={{
                        display: "grid",
                        gridTemplateColumns: `1.2fr 0.6fr repeat(${dates.length || 1}, minmax(140px, 1fr))`,
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
                      {productVariants.map((variant) => {
                        return (
                          <div
                            key={variant.id}
                            className="min-w-[720px] px-4 py-2"
                            style={{
                              display: "grid",
                              gridTemplateColumns: `1.2fr 0.6fr repeat(${dates.length || 1}, minmax(140px, 1fr))`,
                              gap: "12px",
                            }}
                          >
                            <div>
                              <input
                                className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
                                value={variant.label}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setVariants((prev) =>
                                    prev.map((item) =>
                                      item.id === variant.id ? { ...item, label: value } : item,
                                    ),
                                  );
                                }}
                              />
                              <button
                                className="mt-1 rounded-full border border-ink/20 px-2 py-0.5 text-[10px] font-semibold"
                                onClick={() => enableAllDatesForVariant(product.id, variant.id)}
                              >
                                Tout cocher
                              </button>
                            </div>
                            <input
                              className="rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
                              type="number"
                              min={0}
                              step="0.1"
                              value={variant.price}
                              onChange={(event) => {
                                const value = Number(event.target.value || 0);
                                setVariants((prev) =>
                                  prev.map((item) =>
                                    item.id === variant.id ? { ...item, price: value } : item,
                                  ),
                                );
                              }}
                            />
                            {dates.length ? (
                              dates.map((_, dateIndex) => {
                                const key = offerKey(product.id, variant.id, dateIndex);
                                const draft = offerDraft[key] ?? {
                                  enabled: false,
                                  limitPerMember: "",
                                  limitTotal: "",
                                };
                                return (
                                  <div key={key} className="flex flex-col gap-2">
                                    <label className="flex items-center gap-2 text-xs text-ink/70">
                                      <input
                                        type="checkbox"
                                        checked={draft.enabled}
                                        onChange={(event) =>
                                          updateOfferDraft(product.id, variant.id, dateIndex, {
                                            enabled: event.target.checked,
                                          })
                                        }
                                      />
                                      Actif
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        placeholder="Limite adh."
                                        className="rounded-md border border-ink/20 bg-white px-2 py-1 text-[11px]"
                                        value={draft.limitPerMember}
                                        onChange={(event) =>
                                          updateOfferDraft(product.id, variant.id, dateIndex, {
                                            limitPerMember: event.target.value,
                                          })
                                        }
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        placeholder="Limite totale"
                                        className="rounded-md border border-ink/20 bg-white px-2 py-1 text-[11px]"
                                        value={draft.limitTotal}
                                        onChange={(event) =>
                                          updateOfferDraft(product.id, variant.id, dateIndex, {
                                            limitTotal: event.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <span className="text-xs text-ink/60">Aucune date</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {step === totalSteps - 1 ? (
        <div className="mt-6 rounded-2xl border border-clay/70 bg-white/90 p-6">
          <h3 className="font-serif text-2xl">Vente prete</h3>
          <p className="mt-2 text-sm text-ink/70">
            Tu peux ouvrir la vente maintenant ou revenir pour ajuster un producteur.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={openSale}
              disabled={status === "opening"}
            >
              {status === "opening"
                ? "Ouverture..."
                : openDistribution?.id === selectedDistributionId
                  ? "Mettre a jour la vente ouverte"
                  : "Ouvrir la vente"}
            </button>
          </div>
        </div>
      ) : null}

      {step > 0 && step < totalSteps - 1 ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <button
            className="rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold"
            onClick={goPrev}
          >
            Precedent
          </button>
          <button
            className="rounded-full bg-ink px-6 py-2 text-sm font-semibold text-stone"
            onClick={goNext}
            disabled={status === "saving"}
          >
            Suivant
          </button>
        </div>
      ) : null}

      {editProductId && editProductDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Modifier le produit</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Nom
                <input
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={editProductDraft.name}
                  onChange={(event) =>
                    setEditProductDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Image URL
                <input
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={editProductDraft.imageUrl}
                  onChange={(event) =>
                    setEditProductDraft((prev) => (prev ? { ...prev, imageUrl: event.target.value } : prev))
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
                Description
                <textarea
                  className="min-h-[120px] rounded-lg border border-ink/20 px-3 py-2"
                  value={editProductDraft.description}
                  onChange={(event) =>
                    setEditProductDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-ink/70">
                <input
                  type="checkbox"
                  checked={editProductDraft.isOrganic}
                  onChange={(event) =>
                    setEditProductDraft((prev) => (prev ? { ...prev, isOrganic: event.target.checked } : prev))
                  }
                />
                Bio
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Categorie
                <select
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={editProductDraft.categoryId}
                  onChange={(event) =>
                    setEditProductDraft((prev) => (prev ? { ...prev, categoryId: event.target.value } : prev))
                  }
                >
                  <option value="">Sans categorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name ?? category.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                onClick={saveProduct}
              >
                Enregistrer
              </button>
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => {
                  setEditProductId(null);
                  setEditProductDraft(null);
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addProductOpen && currentProducer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Ajouter un produit</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Nom
                <input
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.name}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Image URL
                <input
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.imageUrl}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
                Description
                <textarea
                  className="min-h-[120px] rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.description}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, description: event.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-ink/70">
                <input
                  type="checkbox"
                  checked={addProductDraft.isOrganic}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, isOrganic: event.target.checked }))}
                />
                Bio
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Categorie
                <select
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.categoryId}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, categoryId: event.target.value }))}
                >
                  <option value="">Sans categorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name ?? category.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Variante
                <input
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.variantLabel}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, variantLabel: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Prix
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className="rounded-lg border border-ink/20 px-3 py-2"
                  value={addProductDraft.variantPrice}
                  onChange={(event) => setAddProductDraft((prev) => ({ ...prev, variantPrice: event.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                onClick={async () => {
                  try {
                    setStatus("saving");
                    const dateKeys = dates.map((date) => dateKey(date));
                    const saleDates = dateKeys.map((key) => Timestamp.fromDate(dateFromKey(key)));
                    const productRef = await addDoc(collection(firebaseDb, "products"), {
                      producerId: currentProducer.id,
                      name: addProductDraft.name.trim(),
                      description: addProductDraft.description.trim(),
                      imageUrl: addProductDraft.imageUrl.trim(),
                      isOrganic: addProductDraft.isOrganic,
                      categoryId: addProductDraft.categoryId || null,
                      saleDates,
                    });
                    const price = Number(addProductDraft.variantPrice || 0);
                    const variantRef = await addDoc(
                      collection(firebaseDb, "products", productRef.id, "variants"),
                      {
                        label: addProductDraft.variantLabel.trim(),
                        price,
                        activeDates: dateKeys,
                      },
                    );
                    setProducts((prev) => [
                      ...prev,
                      {
                        id: productRef.id,
                        producerId: currentProducer.id,
                        name: addProductDraft.name.trim(),
                        description: addProductDraft.description.trim(),
                        imageUrl: addProductDraft.imageUrl.trim(),
                        isOrganic: addProductDraft.isOrganic,
                        categoryId: addProductDraft.categoryId || undefined,
                        saleDates,
                      },
                    ]);
                    setVariants((prev) => [
                      ...prev,
                      {
                        id: variantRef.id,
                        productId: productRef.id,
                        label: addProductDraft.variantLabel.trim(),
                        price,
                        activeDates: dateKeys,
                      },
                    ]);
                    setAddProductDraft({
                      name: "",
                      description: "",
                      imageUrl: "",
                      isOrganic: false,
                      categoryId: "",
                      variantLabel: "",
                      variantPrice: "",
                    });
                    setAddProductOpen(false);
                  } catch (error) {
                    const err = error instanceof Error ? error.message : "Erreur inconnue.";
                    setMessage(err);
                  } finally {
                    setStatus("idle");
                  }
                }}
              >
                Ajouter
              </button>
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setAddProductOpen(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
