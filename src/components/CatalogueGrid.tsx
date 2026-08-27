"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";
import {
  buildValidatedProducerDateMap,
  filterVisibleOffers,
  type ProducerLinkLike,
} from "@/lib/offerVisibility";
import { estimatedUnitPrice } from "@/lib/orderEstimates";

type Product = {
  id: string;
  producerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
  isSoldByWeight?: boolean;
  estimatedPriceMin?: number | null;
  estimatedPriceMax?: number | null;
  status?: string;
  tags?: string[];
  categoryId?: string;
};

type Producer = {
  id: string;
  name?: string;
  productType?: string;
};

type Category = {
  id: string;
  name?: string;
};

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate: () => Date }[];
};

type OfferItem = {
  producerId?: string;
  productId?: string;
  saleDateKey?: string;
  dateIndex?: number;
  priceApplied?: number;
  price?: number;
  limitTotal?: number;
  active?: boolean;
};

type CatalogueNavigationState = {
  categoryFilter: string;
  producerFilter: string;
  organicFilter: string;
  dateFilter: string[];
  visibleCount: number;
  scrollY: number;
  selectedProductId?: string;
};

const CATALOGUE_NAVIGATION_STATE_KEY = "labrouette.catalogue.navigationState";
const CATALOGUE_PRODUCT_CARD_PREFIX = "catalogue-product";
const PAGE_SIZE = 16;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function descriptionExcerpt(value?: string, maxLength = 96) {
  if (!value) return "";
  const plain = value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trimEnd()}...`;
}

function formatEstimatedRange(min?: number | null, max?: number | null) {
  const estimate = estimatedUnitPrice(min, max);
  if (estimate === null) return "Prix final au retrait";
  return `Prix estime : ~${estimate.toFixed(2)} EUR`;
}

function dateLabelForKey(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function CatalogueGrid({ hideWhenClosed = false }: { hideWhenClosed?: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDistribution, setOpenDistribution] = useState<Distribution | null>(null);
  const [producerMap, setProducerMap] = useState<Record<string, Producer>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, Category>>({});
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [producerFilter, setProducerFilter] = useState("all");
  const [organicFilter, setOrganicFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<string[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, { min: number; max: number }>>({});
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, { dateKeys: string[]; hasLimit?: boolean; minLimit?: number }>
  >({});
  const [activeProducerIds, setActiveProducerIds] = useState<string[]>([]);
  const [hasProducerLinks, setHasProducerLinks] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const restoredNavigationRef = useRef(false);
  const suppressNextResetRef = useRef(false);
  const pendingNavigationStateRef = useRef<CatalogueNavigationState | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
        const distItems = distSnap.docs.map(
          (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
        );
        const openDist = pickOpenDistribution(distItems);
        setOpenDistribution(openDist);

        const [productSnap, producerSnap, categorySnap, activeProducersSnap, offerSnap] =
          await Promise.all([
            getDocs(collection(firebaseDb, "products")),
            getDocs(collection(firebaseDb, "producers")),
            getDocs(collection(firebaseDb, "categories")),
            openDist
              ? getDocs(collection(firebaseDb, "distributionDates", openDist.id, "producers"))
              : Promise.resolve(null),
            openDist
              ? getDocs(collection(firebaseDb, "distributionDates", openDist.id, "offerItems"))
              : Promise.resolve(null),
          ]);
        const items = productSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Product, "id">),
        }));
        const producers = producerSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Producer, "id">),
        }));
        const map: Record<string, Producer> = {};
        producers.forEach((producer) => {
          map[producer.id] = producer;
        });
        setProducts(items);
        setProducerMap(map);
        const catMap: Record<string, Category> = {};
        categorySnap.docs.forEach((docSnap) => {
          catMap[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Category, "id">) };
        });
        setCategoryMap(catMap);

        const activeProducerDocs = activeProducersSnap?.docs ?? [];
        const producerLinks: ProducerLinkLike[] = activeProducerDocs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ProducerLinkLike, "id">),
        }));
        setHasProducerLinks(producerLinks.length > 0);
        const openDateKeys = (openDist?.dates ?? []).slice(0, 3).map((date) => dateKey(date.toDate()));
        const validatedProducerDateMap = buildValidatedProducerDateMap(producerLinks, openDateKeys);
        setActiveProducerIds(Array.from(validatedProducerDateMap.keys()));

        const prices: Record<string, { min: number; max: number }> = {};
        const availability: Record<string, { dateKeys: string[]; hasLimit?: boolean; minLimit?: number }> = {};

        const offers = offerSnap?.docs.map((docSnap) => docSnap.data() as OfferItem) ?? [];
        const visibleOffers = filterVisibleOffers(offers, producerLinks, openDateKeys);
        visibleOffers.forEach((offer) => {
          const entry = availability[offer.productId] ?? { dateKeys: [] };
          const offerDateKey = offer.resolvedSaleDateKey;
          if (!offerDateKey || !openDateKeys.includes(offerDateKey)) return;
          if (offerDateKey && !entry.dateKeys.includes(offerDateKey)) {
            entry.dateKeys.push(offerDateKey);
          }
          const appliedPrice =
            typeof offer.priceApplied === "number"
              ? offer.priceApplied
              : typeof offer.price === "number"
                ? offer.price
                : null;
          if (appliedPrice !== null) {
            if (!prices[offer.productId]) {
              prices[offer.productId] = { min: appliedPrice, max: appliedPrice };
            } else {
              prices[offer.productId].min = Math.min(prices[offer.productId].min, appliedPrice);
              prices[offer.productId].max = Math.max(prices[offer.productId].max, appliedPrice);
            }
          }
          const limitTotal = Number(offer.limitTotal ?? 0);
          if (limitTotal > 0) {
            entry.hasLimit = true;
            if (!entry.minLimit || limitTotal < entry.minLimit) {
              entry.minLimit = limitTotal;
            }
          }
          availability[offer.productId] = { ...entry, dateKeys: entry.dateKeys.sort() };
        });

        setAvailabilityMap(availability);
        setPriceMap(prices);
      } catch (error) {
        const err = error instanceof Error ? error.message : "Erreur inconnue.";
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const openDateKeys = useMemo(() => {
    if (!openDistribution?.dates) return [];
    return openDistribution.dates.slice(0, 3).map((d) => dateKey(d.toDate()));
  }, [openDistribution]);

  const dateOptions = useMemo(
    () =>
      openDistribution?.dates
        ? openDistribution.dates.slice(0, 3).map((date) => ({
            key: dateKey(date.toDate()),
            label: date.toDate().toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "short",
            }),
          }))
        : [],
    [openDistribution],
  );

  useEffect(() => {
    if (loading || restoredNavigationRef.current || !dateOptions.length) return;

    const allDateKeys = dateOptions.map((option) => option.key);
    const rawSavedState = window.sessionStorage.getItem(CATALOGUE_NAVIGATION_STATE_KEY);
    if (!rawSavedState) {
      setDateFilter(allDateKeys);
      restoredNavigationRef.current = true;
      return;
    }

    try {
      const savedState = JSON.parse(rawSavedState) as Partial<CatalogueNavigationState>;
      const restoredDateFilter = Array.isArray(savedState.dateFilter)
        ? savedState.dateFilter.filter((key) => allDateKeys.includes(key))
        : allDateKeys;
      const restoredVisibleCount =
        typeof savedState.visibleCount === "number"
          ? Math.max(PAGE_SIZE, Math.floor(savedState.visibleCount))
          : PAGE_SIZE;

      suppressNextResetRef.current = true;
      setCategoryFilter(savedState.categoryFilter ?? "all");
      setProducerFilter(savedState.producerFilter ?? "all");
      setOrganicFilter(savedState.organicFilter ?? "all");
      setDateFilter(restoredDateFilter);
      setVisibleCount(restoredVisibleCount);
      pendingNavigationStateRef.current = {
        categoryFilter: savedState.categoryFilter ?? "all",
        producerFilter: savedState.producerFilter ?? "all",
        organicFilter: savedState.organicFilter ?? "all",
        dateFilter: restoredDateFilter,
        visibleCount: restoredVisibleCount,
        scrollY:
          typeof savedState.scrollY === "number" && Number.isFinite(savedState.scrollY)
            ? Math.max(0, savedState.scrollY)
            : 0,
        selectedProductId:
          typeof savedState.selectedProductId === "string"
            ? savedState.selectedProductId
            : undefined,
      };
    } catch {
      setDateFilter(allDateKeys);
    } finally {
      restoredNavigationRef.current = true;
    }
  }, [dateOptions, loading]);

  const inStockProducts = useMemo(() => {
    if (!openDateKeys.length) return [];
    return products.filter((product) => {
      const keys = availabilityMap[product.id]?.dateKeys ?? [];
      const matchesDate = keys.some((key) => openDateKeys.includes(key));
      const matchesProducer = hasProducerLinks
        ? activeProducerIds.includes(product.producerId)
        : true;
      return matchesDate && matchesProducer;
    });
  }, [openDateKeys, products, availabilityMap, activeProducerIds, hasProducerLinks]);

  const visibleProducts = useMemo(() => {
    if (!openDateKeys.length) return [];
    const filtered = inStockProducts.filter((product) => {
      const productDateKeys = availabilityMap[product.id]?.dateKeys ?? [];
      const matchesDate =
        productDateKeys.length === 0 || dateFilter.length === 0
          ? true
          : dateFilter.some((key) => productDateKeys.includes(key));
      const matchesCategory =
        categoryFilter === "all" ? true : product.categoryId === categoryFilter;
      const matchesProducer =
        producerFilter === "all" ? true : product.producerId === producerFilter;
      const matchesOrganic =
        organicFilter === "all"
          ? true
          : organicFilter === "bio"
            ? Boolean(product.isOrganic)
            : !product.isOrganic;
      return matchesCategory && matchesProducer && matchesOrganic && matchesDate;
    });

    filtered.sort((a, b) => {
      const aCategory = (a.categoryId ? categoryMap[a.categoryId]?.name : "") ?? "";
      const bCategory = (b.categoryId ? categoryMap[b.categoryId]?.name : "") ?? "";
      if (aCategory !== bCategory) return aCategory.localeCompare(bCategory, "fr");

      const aProducer = producerMap[a.producerId]?.name ?? "";
      const bProducer = producerMap[b.producerId]?.name ?? "";
      if (aProducer !== bProducer) return aProducer.localeCompare(bProducer, "fr");

      return a.name.localeCompare(b.name, "fr");
    });
    return filtered;
  }, [
    openDateKeys,
    inStockProducts,
    categoryFilter,
    producerFilter,
    organicFilter,
    dateFilter,
    availabilityMap,
    categoryMap,
    producerMap,
  ]);
  const pagedProducts = useMemo(() => visibleProducts.slice(0, visibleCount), [visibleProducts, visibleCount]);
  const hasMore = visibleProducts.length > visibleCount;
  const openDateKeysSignature = openDateKeys.join(",");

  const categoryOptions = useMemo(
    () =>
      Object.values(categoryMap)
        .filter((category) => inStockProducts.some((product) => product.categoryId === category.id))
        .map((category) => ({
          id: category.id,
          label: category.name ?? category.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categoryMap, inStockProducts],
  );

  const producerOptions = useMemo(
    () =>
      Object.values(producerMap)
        .filter((producer) =>
          inStockProducts.some((product) => product.producerId === producer.id),
        )
        .map((producer) => ({
          id: producer.id,
          label: producer.name ?? producer.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [producerMap, inStockProducts],
  );

  useEffect(() => {
    if (!restoredNavigationRef.current) return;
    if (suppressNextResetRef.current) {
      suppressNextResetRef.current = false;
      return;
    }
    setVisibleCount(PAGE_SIZE);
  }, [categoryFilter, producerFilter, organicFilter, dateFilter, openDateKeysSignature]);

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, visibleProducts.length));
      },
      { rootMargin: "600px 0px 600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visibleProducts.length]);

  useEffect(() => {
    const savedState = pendingNavigationStateRef.current;
    if (!savedState || loading || !restoredNavigationRef.current) return;
    if (pagedProducts.length === 0) return;

    let attempts = 0;
    let timeoutId: number | null = null;
    let frameId: number | null = null;

    const restorePosition = () => {
      const productCard = savedState.selectedProductId
        ? document.getElementById(`${CATALOGUE_PRODUCT_CARD_PREFIX}-${savedState.selectedProductId}`)
        : null;

      if (savedState.scrollY > 0) {
        window.scrollTo({ top: savedState.scrollY });
      } else if (productCard) {
        productCard.scrollIntoView({ block: "center" });
      } else {
        window.scrollTo({ top: savedState.scrollY });
      }

      attempts += 1;
      if (attempts >= 8) {
        pendingNavigationStateRef.current = null;
        return;
      }

      timeoutId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(restorePosition);
      }, 50);
    };

    frameId = window.requestAnimationFrame(restorePosition);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [loading, pagedProducts.length]);

  const saveNavigationState = (selectedProductId: string) => {
    window.sessionStorage.setItem(
      CATALOGUE_NAVIGATION_STATE_KEY,
      JSON.stringify({
        categoryFilter,
        producerFilter,
        organicFilter,
        dateFilter,
        visibleCount: Math.max(visibleCount, pagedProducts.length),
        scrollY: window.scrollY,
        selectedProductId,
      } satisfies CatalogueNavigationState),
    );
  };

  if (loading) {
    return <p className="text-sm text-ink/70">Chargement...</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/85 p-6 shadow-card">
        <p className="text-sm text-ember">Erreur de chargement.</p>
        <p className="mt-2 text-xs text-ink/60">{error}</p>
      </div>
    );
  }

  if (!openDistribution) {
    if (hideWhenClosed) {
      return null;
    }
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/85 p-6 shadow-card">
        <p className="text-sm text-ink/70">Aucune vente ouverte pour le moment.</p>
      </div>
    );
  }

  if (visibleProducts.length === 0) {
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/85 p-6 shadow-card">
        <p className="text-sm text-ink/70">Aucun produit pour cette période.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-6 h-fit rounded-xl border border-clay/70 bg-white/90 p-4 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
          Filtres
        </p>
        <div className="mt-3 flex flex-col gap-4 text-sm">
          {categoryOptions.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-ink/60">Catégorie</span>
              <select
                className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">Toutes les catégories</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {producerOptions.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-ink/60">Producteur</span>
              <select
                className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                value={producerFilter}
                onChange={(event) => setProducerFilter(event.target.value)}
              >
                <option value="all">Tous</option>
                {producerOptions.map((producer) => (
                  <option key={producer.id} value={producer.id}>
                    {producer.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {dateOptions.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-ink/60">Date</span>
              <div className="flex flex-wrap gap-2">
                {dateOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      dateFilter.includes(option.key)
                        ? "border-ink/30 bg-ink text-stone"
                        : "border-ink/20 bg-white text-ink hover:border-ink/45 hover:bg-stone"
                    }`}
                    onClick={() =>
                      setDateFilter((prev) =>
                        prev.includes(option.key)
                          ? prev.filter((key) => key !== option.key)
                          : [...prev, option.key],
                      )
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-ink/60">Bio</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "all", label: "Tous" },
                { id: "bio", label: "Bio" },
                { id: "conv", label: "Conv." },
              ].map((option) => (
                <button
                  key={option.id}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                    organicFilter === option.id
                      ? "border-ink/30 bg-ink text-stone"
                      : "border-ink/20 bg-white text-ink"
                  }`}
                  onClick={() => setOrganicFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="rounded-full border border-ink/20 px-3 py-2 text-xs font-semibold"
            onClick={() => {
              setCategoryFilter("all");
              setProducerFilter("all");
              setOrganicFilter("all");
              setDateFilter(dateOptions.map((option) => option.key));
            }}
          >
            Réinitialiser
          </button>
        </div>
      </aside>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pagedProducts.map((product) => (
          <Link
            id={`${CATALOGUE_PRODUCT_CARD_PREFIX}-${product.id}`}
            className="group flex h-full overflow-hidden flex-col gap-3 rounded-xl border border-clay/70 bg-white/95 p-4 shadow-card transition hover:-translate-y-1 hover:border-ink/30"
            key={product.id}
            href={`/products/${product.id}`}
            onClick={() => saveNavigationState(product.id)}
          >
            <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-clay/70 bg-stone">
              {product.imageUrl ? (
                <img className="h-full w-full object-cover" src={product.imageUrl} alt={product.name} />
              ) : (
                <span className="text-xs uppercase tracking-[0.2em] text-ink/50">Sans image</span>
              )}
            </div>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
                  {producerMap[product.producerId]?.name || "Sans producteur"}
                </p>
                {producerMap[product.producerId]?.productType ? (
                  <p className="truncate text-[11px] text-ink/55">
                    {producerMap[product.producerId]?.productType}
                  </p>
                ) : null}
                <h2 className="mt-1 break-words font-serif text-xl leading-tight">{product.name}</h2>
              </div>
              <div className="ml-auto flex max-w-[48%] flex-wrap justify-end gap-1">
                <span className="max-w-full break-all rounded-full border border-ink/15 px-2 py-0.5 text-[11px] font-semibold text-ink/70">
                  {product.isOrganic ? "Bio" : "Conventionnel"}
                </span>
                {product.categoryId && categoryMap[product.categoryId]?.name ? (
                  <span className="max-w-full break-all rounded-full bg-clay/70 px-2 py-0.5 text-[11px] font-semibold text-ink/70">
                    {categoryMap[product.categoryId]?.name}
                  </span>
                ) : null}
                {availabilityMap[product.id]?.hasLimit ? (
                  <span className="max-w-full break-all rounded-full bg-ember/10 px-2 py-0.5 text-[11px] font-semibold text-ember">
                    {availabilityMap[product.id]?.minLimit
                      ? `Limite ${availabilityMap[product.id]?.minLimit}`
                      : "Quantités limitées"}
                  </span>
                ) : null}
                {product.isSoldByWeight ? (
                  <span className="max-w-full break-all rounded-full border border-ink/15 bg-stone px-2 py-0.5 text-[11px] font-semibold text-ink/70">
                    Produit au poids
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-ink/70">
              {descriptionExcerpt(product.description) || "Description disponible sur la fiche produit."}
            </p>
            <div className="rounded-lg border border-forest/25 bg-forest/5 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-forest">
                Dates de retrait
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(availabilityMap[product.id]?.dateKeys ?? []).map((key) => (
                  <span
                    key={`${product.id}-${key}`}
                    className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-white"
                  >
                    {dateLabelForKey(key)}
                  </span>
                ))}
              </div>
            </div>
            {product.isSoldByWeight ? (
              <p className="text-xs font-semibold text-ink/60">
                Produit au poids - {formatEstimatedRange(product.estimatedPriceMin, product.estimatedPriceMax)}
              </p>
            ) : priceMap[product.id] ? (
              <p className="text-xs font-semibold text-ink/70">
                {priceMap[product.id].min === priceMap[product.id].max
                  ? `${priceMap[product.id].min.toFixed(2)} EUR`
                  : `${priceMap[product.id].min.toFixed(2)} EUR - ${priceMap[product.id].max.toFixed(2)} EUR`}
              </p>
            ) : null}
            <span className="mt-auto inline-flex w-fit items-center gap-2 rounded-full border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition group-hover:border-ink/50">
              Voir le produit
              <span aria-hidden>-&gt;</span>
            </span>
          </Link>
        ))}
      </div>
      {hasMore ? (
        <div
          ref={loadMoreRef}
          aria-hidden="true"
          className="h-8 md:col-span-2 xl:col-span-3"
        />
      ) : null}
    </div>
  );
}
