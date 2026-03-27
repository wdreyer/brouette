"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";
import { addToCart } from "@/lib/cart";

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
  tags?: string[];
  categoryId?: string;
};

type Variant = {
  id: string;
  label: string;
  type?: string;
  unit?: string;
  price: number;
};

type Distribution = {
  id: string;
  dates?: { toDate: () => Date }[];
};

type Producer = {
  id: string;
  name?: string;
};

type Category = {
  id: string;
  name?: string;
};

type OfferItem = {
  productId?: string;
  variantId?: string;
  saleDateKey?: string;
  dateIndex?: number;
  priceApplied?: number;
  price?: number;
  active?: boolean;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function sanitizeDescriptionForMarkdown(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s{4,}/, " "))
    .join("\n");
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
  if (hasMin) return `Estimatif: a partir de ${min!.toFixed(2)} EUR`;
  return `Estimatif: jusqu'a ${max!.toFixed(2)} EUR`;
}

function sortProducts(
  items: Product[],
  producerMap: Record<string, Producer>,
  categoryMap: Record<string, Category>,
) {
  const copy = [...items];
  copy.sort((a, b) => {
    const aCategory = (a.categoryId ? categoryMap[a.categoryId]?.name : "") ?? "";
    const bCategory = (b.categoryId ? categoryMap[b.categoryId]?.name : "") ?? "";
    if (aCategory !== bCategory) return aCategory.localeCompare(bCategory, "fr");

    const aProducer = producerMap[a.producerId]?.name ?? "";
    const bProducer = producerMap[b.producerId]?.name ?? "";
    if (aProducer !== bProducer) return aProducer.localeCompare(bProducer, "fr");

    return a.name.localeCompare(b.name, "fr");
  });
  return copy;
}

export default function ProductPage() {
  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDates, setOpenDates] = useState<{ key: string; date: Date; index: number }[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [producer, setProducer] = useState<Producer | null>(null);
  const [producerMap, setProducerMap] = useState<Record<string, Producer>>({});
  const [category, setCategory] = useState<Category | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, Category>>({});
  const [variantDateMap, setVariantDateMap] = useState<Record<string, string[]>>({});
  const [variantPriceMap, setVariantPriceMap] = useState<Record<string, number>>({});

  const params = useParams<{ productId: string }>();
  const productId = params?.productId ?? "";

  useEffect(() => {
    const load = async () => {
      const [productSnap, variantsSnap, distSnap, productsSnap, producersSnap, categoriesSnap] =
        await Promise.all([
          getDoc(doc(firebaseDb, "products", productId)),
          getDocs(collection(firebaseDb, "products", productId, "variants")),
          getDocs(collection(firebaseDb, "distributionDates")),
          getDocs(collection(firebaseDb, "products")),
          getDocs(collection(firebaseDb, "producers")),
          getDocs(collection(firebaseDb, "categories")),
        ]);

      if (!productSnap.exists()) {
        setProduct(null);
        setVariants([]);
        setLoading(false);
        return;
      }

      const currentProduct = {
        id: productSnap.id,
        ...(productSnap.data() as Omit<Product, "id">),
      };
      setProduct(currentProduct);

      const variantItems = variantsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Variant, "id">),
      }));
      setVariants(variantItems);

      const producerMapNext: Record<string, Producer> = {};
      producersSnap.docs.forEach((docSnap) => {
        producerMapNext[docSnap.id] = {
          id: docSnap.id,
          ...(docSnap.data() as Omit<Producer, "id">),
        };
      });
      setProducerMap(producerMapNext);
      setProducer(producerMapNext[currentProduct.producerId] ?? null);

      const categoryMapNext: Record<string, Category> = {};
      categoriesSnap.docs.forEach((docSnap) => {
        categoryMapNext[docSnap.id] = {
          id: docSnap.id,
          ...(docSnap.data() as Omit<Category, "id">),
        };
      });
      setCategoryMap(categoryMapNext);
      setCategory(currentProduct.categoryId ? categoryMapNext[currentProduct.categoryId] ?? null : null);

      const distributions = distSnap.docs.map(
        (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
      );
      const openDist = pickOpenDistribution(distributions);
      const openDatesRaw = (openDist?.dates ?? []).slice(0, 3).map((d) => d.toDate());
      setOpenDates(openDatesRaw.map((date, index) => ({ key: dateKey(date), date, index })));

      const allProducts = productsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Product, "id">),
      }));

      let sourceProducts = allProducts;
      let openOffers: OfferItem[] = [];
      if (openDist) {
        const offerSnap = await getDocs(
          collection(firebaseDb, "distributionDates", openDist.id, "offerItems"),
        );
        openOffers = offerSnap.docs.map((docSnap) => docSnap.data() as OfferItem);
        const openProductIds = new Set(
          openOffers
            .filter((offer) => offer.active !== false)
            .map((offer) => String(offer.productId ?? ""))
            .filter(Boolean),
        );

        if (openProductIds.size > 0) {
          const filtered = allProducts.filter((item) => openProductIds.has(item.id));
          if (filtered.length > 0) {
            sourceProducts = filtered;
          }
        }
      }

      const variantDates: Record<string, string[]> = {};
      const variantPrices: Record<string, number> = {};
      const openDateKeyByIndex: string[] = openDatesRaw.map((date) => dateKey(date));
      openOffers
        .filter((offer) => offer.active !== false && String(offer.productId ?? "") === currentProduct.id)
        .forEach((offer) => {
          const variantId = String(offer.variantId ?? "");
          if (!variantId) return;
          const saleKey =
            typeof offer.saleDateKey === "string" && offer.saleDateKey
              ? offer.saleDateKey
              : typeof offer.dateIndex === "number"
                ? openDateKeyByIndex[offer.dateIndex] ?? ""
                : "";
          if (saleKey) {
            const currentKeys = variantDates[variantId] ?? [];
            if (!currentKeys.includes(saleKey)) {
              variantDates[variantId] = [...currentKeys, saleKey];
            }
          }
          const appliedPrice =
            typeof offer.priceApplied === "number"
              ? offer.priceApplied
              : typeof offer.price === "number"
                ? offer.price
                : null;
          if (appliedPrice !== null) {
            variantPrices[variantId] = appliedPrice;
          }
        });
      Object.keys(variantDates).forEach((key) => {
        variantDates[key] = [...variantDates[key]].sort();
      });
      setVariantDateMap(variantDates);
      setVariantPriceMap(variantPrices);

      const ordered = sortProducts(sourceProducts, producerMapNext, categoryMapNext);
      setCatalogProducts(ordered);

      const rankedRelated = ordered
        .filter((item) => item.id !== productId)
        .map((item) => {
          let score = 0;
          const sameProducer = item.producerId === currentProduct.producerId;
          const sameCategory =
            Boolean(item.categoryId) &&
            Boolean(currentProduct.categoryId) &&
            item.categoryId === currentProduct.categoryId;

          if (sameProducer && sameCategory) score = 3;
          else if (sameCategory) score = 2;
          else if (sameProducer) score = 1;

          return { item, score };
        })
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return a.item.name.localeCompare(b.item.name, "fr");
        });

      const relatedCount = rankedRelated.length >= 4 ? Math.min(8, rankedRelated.length) : rankedRelated.length;
      setRelatedProducts(rankedRelated.slice(0, relatedCount).map((entry) => entry.item));

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [productId]);

  const availableDates = useMemo(() => {
    if (!openDates.length) return [];
    return openDates
      .filter((entry) =>
        variants.some((variant) => (variantDateMap[variant.id] ?? []).includes(entry.key)),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [openDates, variants, variantDateMap]);

  const activeVariants = useMemo(() => {
    if (!openDates.length) return [];
    return variants.filter((variant) => (variantDateMap[variant.id] ?? []).length > 0);
  }, [variants, variantDateMap, openDates]);

  const currentCatalogIndex = useMemo(
    () => catalogProducts.findIndex((item) => item.id === productId),
    [catalogProducts, productId],
  );
  const previousProduct = useMemo(() => {
    const count = catalogProducts.length;
    if (count <= 1) return null;
    const currentIndex = currentCatalogIndex >= 0 ? currentCatalogIndex : 0;
    const previousIndex = (currentIndex - 1 + count) % count;
    return catalogProducts[previousIndex] ?? null;
  }, [catalogProducts, currentCatalogIndex]);
  const nextProduct = useMemo(() => {
    const count = catalogProducts.length;
    if (count <= 1) return null;
    const currentIndex = currentCatalogIndex >= 0 ? currentCatalogIndex : 0;
    const nextIndex = (currentIndex + 1) % count;
    return catalogProducts[nextIndex] ?? null;
  }, [catalogProducts, currentCatalogIndex]);

  const setQuantity = (variantId: string, key: string, value: number) => {
    const nextValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    setQuantities((prev) => ({
      ...prev,
      [variantId]: {
        ...(prev[variantId] ?? {}),
        [key]: nextValue,
      },
    }));
  };

  const handleAdd = (variant: Variant) => {
    if (!product) return;
    if (!availableDates.length) {
      toast.error("Aucune date disponible.");
      return;
    }

    const qtyByDate = quantities[variant.id] ?? {};
    const hasQty = Object.values(qtyByDate).some((value) => value > 0);
    if (!hasQty) {
      toast.error("Choisis une quantité.");
      return;
    }

    availableDates.forEach((date) => {
      const key = date.key;
      const activeKeys = variantDateMap[variant.id] ?? [];
      if (!activeKeys.includes(key)) return;
      const qty = qtyByDate[key] ?? 0;
      if (qty <= 0) return;
      const unitPrice = product.isSoldByWeight ? 0 : variantPriceMap[variant.id] ?? variant.price;
      addToCart({
        id: `${product.id}_${variant.id}_${key}`,
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        variantLabel: variant.label,
        unitPrice,
        quantity: qty,
        producerId: product.producerId,
        imageUrl: product.imageUrl,
        saleDateKey: key,
        saleDateLabel: formatDate(date.date),
        isSoldByWeight: Boolean(product.isSoldByWeight),
        estimatedPriceMin: product.isSoldByWeight ? product.estimatedPriceMin ?? null : null,
        estimatedPriceMax: product.isSoldByWeight ? product.estimatedPriceMax ?? null : null,
      });
    });

    animateToCart();
    toast.success("Ajouté au panier.");
    setQuantities((prev) => {
      const next = { ...prev };
      delete next[variant.id];
      return next;
    });
  };

  const animateToCart = () => {
    const cart = document.getElementById("cart-button");
    if (!cart) return;
    const cartRect = cart.getBoundingClientRect();
    const start = { x: window.innerWidth * 0.6, y: window.innerHeight * 0.6 };
    const end = {
      x: cartRect.left + cartRect.width / 2,
      y: cartRect.top + cartRect.height / 2,
    };

    const dot = document.createElement("div");
    dot.style.position = "fixed";
    dot.style.left = `${start.x}px`;
    dot.style.top = `${start.y}px`;
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "999px";
    dot.style.background = "#e35a2b";
    dot.style.zIndex = "9999";
    dot.style.pointerEvents = "none";
    dot.style.transform = "translate(-50%, -50%)";
    document.body.appendChild(dot);

    const duration = 600;
    const startTime = performance.now();
    const animate = (time: number) => {
      const t = Math.min(1, (time - startTime) / duration);
      const ease = 1 - (1 - t) ** 3;
      const x = start.x + (end.x - start.x) * ease;
      const y = start.y + (end.y - start.y) * ease - 40 * Math.sin(Math.PI * t);
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.opacity = `${1 - t}`;
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        dot.remove();
      }
    };
    requestAnimationFrame(animate);
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="text-sm text-ink/70">Chargement...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="font-serif text-3xl">Produit introuvable</h1>
        <p className="mt-2 text-sm text-ink/70">Vérifie l'identifiant du produit.</p>
      </div>
    );
  }

  const descriptionText = sanitizeDescriptionForMarkdown(
    product.description && product.description.trim().length > 0
      ? product.description
      : "Produit local de la coop. Quantités limitées selon les dates de distribution.",
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
        >
          Retour catalogue
        </Link>
        <div className="flex items-center gap-2">
          {previousProduct ? (
            <Link
              href={`/products/${previousProduct.id}`}
              className="rounded-full border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
            >
              &larr; Produit précédent
            </Link>
          ) : null}
          {nextProduct ? (
            <Link
              href={`/products/${nextProduct.id}`}
              className="rounded-full border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
            >
              Produit suivant &rarr;
            </Link>
          ) : null}
        </div>
      </div>

      <div className="relative">
        {previousProduct ? (
          <Link
            href={`/products/${previousProduct.id}`}
            aria-label="Produit précédent"
            className="absolute left-0 top-1/2 z-20 hidden h-12 w-12 -translate-x-[115%] -translate-y-1/2 items-center justify-center rounded-full border border-ink/25 bg-white/95 text-2xl font-bold text-ink shadow-sm transition hover:scale-105 hover:bg-white md:flex"
          >
            &larr;
          </Link>
        ) : null}
        {nextProduct ? (
          <Link
            href={`/products/${nextProduct.id}`}
            aria-label="Produit suivant"
            className="absolute right-0 top-1/2 z-20 hidden h-12 w-12 translate-x-[115%] -translate-y-1/2 items-center justify-center rounded-full border border-ink/25 bg-white/95 text-2xl font-bold text-ink shadow-sm transition hover:scale-105 hover:bg-white md:flex"
          >
            &rarr;
          </Link>
        ) : null}

        <section className="grid gap-6 rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="overflow-hidden rounded-lg border border-clay/70 bg-gradient-to-br from-stone to-clay/25">
              {product.imageUrl ? (
                <img className="h-[320px] w-full object-cover" src={product.imageUrl} alt={product.name} />
              ) : (
                <div className="flex h-[320px] items-center justify-center">
                  <p className="text-sm text-ink/60">Aucune image</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="max-w-full rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                {product.isOrganic ? "Bio" : "Conventionnel"}
              </span>
              {category?.name ? (
                <span
                  className="max-w-full truncate rounded-full bg-clay/70 px-3 py-1 text-xs font-semibold text-ink/70"
                  title={category.name}
                >
                  {category.name}
                </span>
              ) : null}
              {product.isSoldByWeight ? (
                <span className="max-w-full truncate rounded-full border border-ink/20 bg-stone px-3 py-1 text-xs font-semibold text-ink/70">
                  Produit au poids
                </span>
              ) : null}
              {product.tags?.map((tag) => (
                <span
                  key={tag}
                  className="max-w-full truncate rounded-full bg-clay/70 px-3 py-1 text-xs font-semibold text-ink/70"
                  title={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
              <p className="break-words text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
                {producer?.name ? (
                  <>
                    Producteur{" "}
                    <a className="break-words underline" href={`/producers/${producer.id}`}>
                      {producer.name}
                    </a>
                  </>
                ) : (
                  "Producteur"
                )}
              </p>
              <h1 className="break-words [overflow-wrap:anywhere] font-serif text-3xl leading-tight">
                {product.name}
              </h1>
            </div>

            <div className="rounded-lg border border-clay/70 bg-stone p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
                Dates disponibles
              </p>
              {availableDates.length === 0 ? (
                <p className="mt-2 text-sm text-ink/70">Aucune date disponible.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink/70">
                  {availableDates.map((date) => (
                    <span
                      key={date.key}
                      className="rounded-full border border-clay/70 bg-white px-3 py-1 font-semibold"
                    >
                      {formatDate(date.date)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 rounded-lg border border-clay/70 bg-white/90 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
                Description
              </p>
              <div className="mt-3 min-w-0 space-y-3 text-sm text-ink/70">
                <div className="markdown break-words [overflow-wrap:anywhere] text-ink/70">
                  <ReactMarkdown>{descriptionText}</ReactMarkdown>
                </div>
              </div>
            </div>
            {product.isSoldByWeight ? (
              <div className="rounded-lg border border-ink/15 bg-stone px-4 py-3 text-sm text-ink/70">
                <p className="font-semibold text-ink">Produit au poids</p>
                <p className="text-xs">
                  Prix final fixe apres pesee au retrait. {formatEstimatedRange(product.estimatedPriceMin, product.estimatedPriceMax)}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {availableDates.length === 0 ? (
        <div className="rounded-lg border border-clay/70 bg-white/90 p-4">
          <p className="text-sm text-ink/70">Aucune date de vente disponible pour ce produit.</p>
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-2xl">Variantes & dates</h2>
          </div>
          <div className="overflow-x-auto rounded-lg border border-clay/70 bg-white/95 shadow-card">
            <div
              className="min-w-[720px] border-b border-clay/70 bg-stone px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60"
              style={{
                display: "grid",
                gridTemplateColumns: `1.1fr 0.6fr repeat(${openDates.length}, minmax(120px, 1fr)) 0.6fr`,
                gap: "12px",
              }}
            >
              <span>Variante</span>
              <span>Prix</span>
              {openDates.map((date) => (
                <span key={date.key}>{formatShortDate(date.date)}</span>
              ))}
              <span>Actions</span>
            </div>
            <div className="divide-y divide-clay/70">
              {activeVariants.map((variant) => (
                <div
                  key={variant.id}
                  className="min-w-[720px] px-4 py-2"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `1.1fr 0.6fr repeat(${openDates.length}, minmax(120px, 1fr)) 0.6fr`,
                    gap: "12px",
                  }}
                >
                  <div className="min-w-0">
                    <p className="break-words [overflow-wrap:anywhere] text-sm font-semibold leading-tight">
                      {variant.label}
                      {variant.type ? ` - ${variant.type}` : ""} {variant.unit ? `(${variant.unit})` : ""}
                    </p>
                    <p className="text-xs text-ink/60">Variante</p>
                  </div>
                  <div className={`text-sm font-semibold ${product.isSoldByWeight ? "text-ink/60" : "text-ink"}`}>
                    {product.isSoldByWeight
                      ? "0,00 EUR"
                      : `${(variantPriceMap[variant.id] ?? variant.price).toFixed(2)} EUR`}
                  </div>
                  {openDates.map((date) => {
                    const qty = quantities[variant.id]?.[date.key] ?? 0;
                    const activeKeys = variantDateMap[variant.id] ?? [];
                    if (!activeKeys.includes(date.key)) {
                      return (
                        <div key={date.key} className="text-xs text-ink/50">
                          -
                        </div>
                      );
                    }
                    return (
                      <div key={date.key} className="flex items-center gap-2">
                        <button
                          className="h-7 w-7 rounded-full border border-ink/20 bg-white text-xs font-semibold"
                          onClick={() => setQuantity(variant.id, date.key, qty - 1)}
                          disabled={qty <= 0}
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-xs font-semibold text-ink">{qty}</span>
                        <button
                          className="h-7 w-7 rounded-full border border-ink/20 bg-white text-xs font-semibold"
                          onClick={() => setQuantity(variant.id, date.key, qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
                  <div className="flex items-start">
                    <button
                      className="rounded-full border border-ink/20 bg-ink px-4 py-1.5 text-[11px] font-semibold text-stone"
                      onClick={() => handleAdd(variant)}
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {relatedProducts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
                Même période
              </p>
              <h2 className="font-serif text-2xl">Tu peux aussi aimer</h2>
            </div>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {relatedProducts.map((item) => (
              <Link
                key={item.id}
                className="group flex h-full flex-col gap-2 rounded-lg border border-clay/70 bg-white/95 p-3 shadow-card transition hover:-translate-y-1 hover:border-ink/30"
                href={`/products/${item.id}`}
              >
                <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-clay/70 bg-stone">
                  {item.imageUrl ? (
                    <img className="h-full w-full object-cover" src={item.imageUrl} alt={item.name} />
                  ) : (
                    <span className="text-xs uppercase tracking-[0.2em] text-ink/50">Sans image</span>
                  )}
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/60">
                  {producerMap[item.producerId]?.name ?? "Producteur"}
                </p>
                <h3 className="break-words [overflow-wrap:anywhere] font-serif text-lg leading-tight">
                  {item.name}
                </h3>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
