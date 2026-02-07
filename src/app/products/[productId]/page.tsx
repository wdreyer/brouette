"use client";

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

  tags?: string[];
  saleDates?: { toDate: () => Date }[];
  categoryId?: string;
};

type Variant = {
  id: string;
  label: string;
  type?: string;
  unit?: string;
  price: number;
  activeDates?: string[];
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

export default function ProductPage() {
  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDates, setOpenDates] = useState<{ key: string; date: Date; index: number }[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [producer, setProducer] = useState<Producer | null>(null);
  const [producerMap, setProducerMap] = useState<Record<string, Producer>>({});
  const [category, setCategory] = useState<Category | null>(null);

  const params = useParams<{ productId: string }>();
  const productId = params?.productId ?? "";

  useEffect(() => {
    const load = async () => {
      const productRef = doc(firebaseDb, "products", productId);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) {
        setProduct(null);
        setVariants([]);
        setLoading(false);
        return;
      }

      const productData = {
        id: productSnap.id,
        ...(productSnap.data() as Omit<Product, "id">),
      };
      setProduct(productData);

      if (productData.producerId) {
        const producerSnap = await getDoc(doc(firebaseDb, "producers", productData.producerId));
        setProducer(
          producerSnap.exists()
            ? ({ id: producerSnap.id, ...(producerSnap.data() as Omit<Producer, "id">) } as Producer)
            : null,
        );
      } else {
        setProducer(null);
      }

      if (productData.categoryId) {
        const categorySnap = await getDoc(doc(firebaseDb, "categories", productData.categoryId));
        setCategory(
          categorySnap.exists()
            ? ({ id: categorySnap.id, ...(categorySnap.data() as Omit<Category, "id">) } as Category)
            : null,
        );
      } else {
        setCategory(null);
      }

      const variantsSnap = await getDocs(collection(firebaseDb, "products", productId, "variants"));
      const variantItems = variantsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Variant, "id">),
      }));
      setVariants(variantItems);

      const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
      const distItems = distSnap.docs.map(
        (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
      );
      const openDist = pickOpenDistribution(distItems);
      const openDatesRaw = (openDist?.dates ?? []).slice(0, 3).map((d) => d.toDate());
      setOpenDates(openDatesRaw.map((date, index) => ({ key: dateKey(date), date, index })));

      const [productsSnap, producersSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "products")),
        getDocs(collection(firebaseDb, "producers")),
      ]);
      const openKeys = new Set(
        (openDist?.dates ?? []).slice(0, 3).map((date) => dateKey(date.toDate())),
      );
      const related = productsSnap.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<Product, "id">),
        }))
        .filter((item) => item.id !== productId)
        .filter((item) => {
          const keys = (item.saleDates ?? []).map((d) => dateKey(d.toDate()));
          return keys.some((key) => openKeys.has(key));
        })
        .slice(0, 6);
      setRelatedProducts(related);
      const map: Record<string, Producer> = {};
      producersSnap.docs.forEach((docSnap) => {
        map[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Producer, "id">) };
      });
      setProducerMap(map);

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [productId]);

  const productSaleKeys = useMemo(
    () => (product?.saleDates ?? []).map((date) => dateKey(date.toDate())),
    [product],
  );

  const variantActiveMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    variants.forEach((variant) => {
      const keys =
        Array.isArray(variant.activeDates) && variant.activeDates.length > 0
          ? variant.activeDates
          : productSaleKeys;
      map[variant.id] = keys;
    });
    return map;
  }, [variants, productSaleKeys]);

  const availableDates = useMemo(() => {
    if (!openDates.length) return [];
    return openDates
      .filter((entry) =>
        variants.some((variant) => (variantActiveMap[variant.id] ?? []).includes(entry.key)),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [openDates, variants, variantActiveMap]);

  const activeVariants = useMemo(() => {
    if (!openDates.length) return [];
    const openKeys = new Set(openDates.map((entry) => entry.key));
    return variants.filter((variant) =>
      (variantActiveMap[variant.id] ?? []).some((key) => openKeys.has(key)),
    );
  }, [variants, variantActiveMap, openDates]);

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
      toast.error("Choisis une quantite.");
      return;
    }

    availableDates.forEach((date) => {
      const key = date.key;
      const activeKeys = variantActiveMap[variant.id] ?? [];
      if (!activeKeys.includes(key)) return;
      const dateLabel = date.date;
      const qty = qtyByDate[key] ?? 0;
      if (qty <= 0) return;
      addToCart({
        id: `${product.id}_${variant.id}_${key}`,
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        variantLabel: variant.label,
        unitPrice: variant.price,
        quantity: qty,
        producerId: product.producerId,
        imageUrl: product.imageUrl,
        saleDateKey: key,
        saleDateLabel: dateLabel ? formatDate(dateLabel) : key,
      });
    });

    animateToCart();
    toast.success("Ajout\u00e9 au panier.");
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
      const ease = 1 - Math.pow(1 - t, 3);
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
        <p className="mt-2 text-sm text-ink/70">Verifie l'identifiant du produit.</p>
      </div>
    );
  }

  const descriptionText =
    product.description && product.description.trim().length > 0
      ? product.description
      : "Produits de saison issus des producteurs locaux de la coop. Quantites limitees selon les dates.";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <section className="grid gap-6 rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card md:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center rounded-lg border border-clay/70 bg-stone p-6">
            {product.imageUrl ? (
              <img className="max-h-64 w-full object-contain" src={product.imageUrl} alt={product.name} />
            ) : (
              <p className="text-sm text-ink/60">Aucune image</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
                {producer?.name ? (
                  <>
                    Producteur{" "}
                    <a className="underline" href={`/producers/${producer.id}`}>
                      {producer.name}
                    </a>
                  </>
                ) : (
                  "Producteur"
                )}
              </p>
              <h1 className="font-serif text-3xl">{product.name}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                {product.isOrganic ? "Bio" : "Conventionnel"}
              </span>
              {category?.name ? (
                <span className="rounded-full bg-clay/70 px-3 py-1 text-xs font-semibold text-ink/70">
                  {category.name}
                </span>
              ) : null}
              {product.tags?.map((tag) => (
                <span key={tag} className="rounded-full bg-clay/70 px-3 py-1 text-xs font-semibold text-ink/70">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
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

          <div className="rounded-lg border border-clay/70 bg-white/90 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">Description</p>
            <div className="mt-3 space-y-3 text-sm text-ink/70">
              <div className="markdown text-ink/70">
                <ReactMarkdown>{descriptionText}</ReactMarkdown>
              </div>
              <p className="leading-relaxed text-ink/60">
                Retrait sur place lors des distributions. Quantites limitees selon la saison et la
                disponibilite.
              </p>
            </div>
          </div>
        </div>
      </section>

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
              {activeVariants.map((variant) => {
                return (
                  <div
                    key={variant.id}
                    className="min-w-[720px] px-4 py-2"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `1.1fr 0.6fr repeat(${openDates.length}, minmax(120px, 1fr)) 0.6fr`,
                      gap: "12px",
                    }}
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {variant.label}
                        {variant.type ? ` - ${variant.type}` : ""} {variant.unit ? `(${variant.unit})` : ""}
                      </p>
                      <p className="text-xs text-ink/60">Variante</p>
                    </div>
                    <div className="text-sm font-semibold">{variant.price.toFixed(2)} EUR</div>
                    {openDates.map((date) => {
                      const qty = quantities[variant.id]?.[date.key] ?? 0;
                      const activeKeys = variantActiveMap[variant.id] ?? [];
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
                );
              })}
            </div>
          </div>
        </section>
      )}

      {relatedProducts.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
              Meme periode
            </p>
            <h2 className="font-serif text-2xl">Produits disponibles aux memes dates</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {relatedProducts.map((item) => (
              <a
                key={item.id}
                className="group flex h-full flex-col gap-3 rounded-xl border border-clay/70 bg-white/95 p-4 shadow-card transition hover:-translate-y-1 hover:border-ink/30"
                href={`/products/${item.id}`}
              >
                <div className="flex h-32 items-center justify-center overflow-hidden rounded-lg border border-clay/70 bg-stone">
                  {item.imageUrl ? (
                    <img className="max-h-24 w-full object-contain" src={item.imageUrl} alt={item.name} />
                  ) : (
                    <span className="text-xs uppercase tracking-[0.2em] text-ink/50">Sans image</span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
                      Producteur {producerMap[item.producerId]?.name ?? "local"}
                    </p>
                    <h3 className="font-serif text-xl">{item.name}</h3>
                  </div>
                  <span className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                    {item.isOrganic ? "Bio" : "Conventionnel"}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
