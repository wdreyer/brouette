"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";

type Product = {
  id: string;
  producerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
  status?: string;
  tags?: string[];
  saleDates?: { toDate: () => Date }[];
  categoryId?: string;
};

type Producer = {
  id: string;
  name?: string;
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

type Variant = {
  id: string;
  productId: string;
  price?: number;
  activeDates?: string[];
};

type OfferItem = {
  productId?: string;
  limitPerMember?: number;
  limitTotal?: number;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function CatalogueGrid() {
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
        const activeIds = activeProducerDocs
          .map((docSnap) => {
            const data = docSnap.data() as { producerId?: string; active?: boolean };
            if (data.active === false) return "";
            return String(data.producerId ?? docSnap.id);
          })
          .filter(Boolean);
        setActiveProducerIds(activeIds);

        const openDateKeys = (openDist?.dates ?? []).slice(0, 3).map((date) => dateKey(date.toDate()));
        const openKeySet = new Set(openDateKeys);
        const prices: Record<string, { min: number; max: number }> = {};
        const availability: Record<string, { dateKeys: string[]; hasLimit?: boolean; minLimit?: number }> = {};

        const variantSnaps = await Promise.all(
          items.map((product) => getDocs(collection(firebaseDb, "products", product.id, "variants"))),
        );
        variantSnaps.forEach((snap, index) => {
          const product = items[index];
          const saleKeys = (product.saleDates ?? []).map((date) => dateKey(date.toDate()));
          const dateSet = new Set<string>();

          snap.docs.forEach((docSnap) => {
            const variant = docSnap.data() as Variant;
            const variantKeys = Array.isArray(variant.activeDates)
              ? variant.activeDates.filter((key) => typeof key === "string")
              : [];
            variantKeys.forEach((key) => dateSet.add(key));
            const matchesOpen = variantKeys.length
              ? variantKeys.some((key) => openKeySet.has(key))
              : saleKeys.some((key) => openKeySet.has(key));
            if (matchesOpen && typeof variant.price === "number") {
              if (!prices[product.id]) {
                prices[product.id] = { min: variant.price, max: variant.price };
              } else {
                prices[product.id].min = Math.min(prices[product.id].min, variant.price);
                prices[product.id].max = Math.max(prices[product.id].max, variant.price);
              }
            }
          });

          const dateKeys = dateSet.size ? Array.from(dateSet) : saleKeys;
          availability[product.id] = { dateKeys: dateKeys.sort() };
        });

        const offers = offerSnap?.docs.map((docSnap) => docSnap.data() as OfferItem) ?? [];
        offers.forEach((offer) => {
          if (!offer.productId) return;
          const entry =
            availability[offer.productId] ?? { dateKeys: [] };
          const limitTotal = Number(offer.limitTotal ?? 0);
          const limitPerMember = Number(offer.limitPerMember ?? 0);
          if (limitTotal > 0 || limitPerMember > 0) {
            entry.hasLimit = true;
            const limitValue = limitTotal > 0 ? limitTotal : limitPerMember;
            if (!entry.minLimit || limitValue < entry.minLimit) {
              entry.minLimit = limitValue;
            }
          }
          availability[offer.productId] = entry;
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
    if (dateOptions.length) {
      setDateFilter(dateOptions.map((option) => option.key));
    }
  }, [dateOptions]);

  const inStockProducts = useMemo(() => {
    if (!openDateKeys.length) return [];
    return products.filter((product) => {
      const keys = availabilityMap[product.id]?.dateKeys ?? [];
      const matchesDate = keys.some((key) => openDateKeys.includes(key));
      const matchesProducer =
        activeProducerIds.length === 0 || activeProducerIds.includes(product.producerId);
      return matchesDate && matchesProducer;
    });
  }, [openDateKeys, products, availabilityMap, activeProducerIds]);

  const visibleProducts = useMemo(() => {
    if (!openDateKeys.length) return [];
    return inStockProducts.filter((product) => {
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
  }, [openDateKeys, inStockProducts, categoryFilter, producerFilter, organicFilter, dateFilter]);

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
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/85 p-6 shadow-card">
        <p className="text-sm text-ink/70">Aucune vente ouverte pour le moment.</p>
      </div>
    );
  }

  if (visibleProducts.length === 0) {
    return (
      <div className="rounded-2xl border border-clay/70 bg-white/85 p-6 shadow-card">
        <p className="text-sm text-ink/70">Aucun produit pour cette periode.</p>
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
              <span className="text-xs font-semibold text-ink/60">Categorie</span>
              <select
                className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">Toutes les categories</option>
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
              <div className="flex flex-col gap-2">
                {dateOptions.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-xs text-ink/70">
                    <input
                      type="checkbox"
                      checked={dateFilter.includes(option.key)}
                      onChange={() =>
                        setDateFilter((prev) =>
                          prev.includes(option.key)
                            ? prev.filter((key) => key !== option.key)
                            : [...prev, option.key],
                        )
                      }
                    />
                    {option.label}
                  </label>
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
            Reinitialiser
          </button>
        </div>
      </aside>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {visibleProducts.map((product) => (
          <div
            className="group flex h-full flex-col gap-4 rounded-xl border border-clay/70 bg-white/95 p-5 shadow-card transition hover:-translate-y-1 hover:border-ink/30"
            key={product.id}
          >
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-clay/70 bg-stone">
              {product.imageUrl ? (
                <img className="max-h-32 w-full object-contain" src={product.imageUrl} alt={product.name} />
              ) : (
                <span className="text-xs uppercase tracking-[0.2em] text-ink/50">Sans image</span>
              )}
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
                  {producerMap[product.producerId]?.name
                    ? `Producteur ${producerMap[product.producerId]?.name}`
                    : "Producteur"}
                </p>
                <h2 className="font-serif text-2xl">{product.name}</h2>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                  {product.isOrganic ? "Bio" : "Conventionnel"}
                </span>
                {product.categoryId && categoryMap[product.categoryId]?.name ? (
                  <span className="rounded-full bg-clay/70 px-3 py-1 text-[11px] font-semibold text-ink/70">
                    {categoryMap[product.categoryId]?.name}
                  </span>
                ) : null}
                {availabilityMap[product.id]?.hasLimit ? (
                  <span className="rounded-full bg-ember/10 px-3 py-1 text-[11px] font-semibold text-ember">
                    {availabilityMap[product.id]?.minLimit
                      ? `Limite ${availabilityMap[product.id]?.minLimit}`
                      : "Quantites limitees"}
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-ink/70">{product.description}</p>
            {product.tags?.length ? (
              <div className="flex flex-wrap gap-2">
                {product.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-clay/70 px-3 py-1 text-xs font-semibold text-ink/70">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {priceMap[product.id] ? (
              <p className="text-sm font-semibold text-ink/70">
                {priceMap[product.id].min === priceMap[product.id].max
                  ? `${priceMap[product.id].min.toFixed(2)} EUR`
                  : `${priceMap[product.id].min.toFixed(2)} EUR - ${priceMap[product.id].max.toFixed(2)} EUR`}
              </p>
            ) : null}
            <Link
              className="mt-auto inline-flex w-fit items-center gap-2 rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink transition group-hover:border-ink/50"
              href={`/products/${product.id}`}
            >
              Voir le produit
              <span aria-hidden>-&gt;</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
