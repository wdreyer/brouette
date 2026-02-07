"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type Producer = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  coopStatus?: string;
  notes?: string;
};

type Product = {
  id: string;
  producerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
  status?: string;
  tags?: string[];
};

export default function ProducerPage() {
  const params = useParams<{ producerId: string }>();
  const producerId = params?.producerId ?? "";
  const [producer, setProducer] = useState<Producer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const producerSnap = await getDoc(doc(firebaseDb, "producers", producerId));
      if (!producerSnap.exists()) {
        setProducer(null);
        setProducts([]);
        setLoading(false);
        return;
      }
      setProducer({ id: producerSnap.id, ...(producerSnap.data() as Omit<Producer, "id">) });

      const productsSnap = await getDocs(
        query(collection(firebaseDb, "products"), where("producerId", "==", producerId)),
      );
      const items = productsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Product, "id">),
      }));
      setProducts(items);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [producerId]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="text-sm text-ink/70">Chargement...</p>
      </div>
    );
  }

  if (!producer) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="font-serif text-3xl">Producteur introuvable</h1>
        <p className="mt-2 text-sm text-ink/70">Verifie l'identifiant du producteur.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Producteur</p>
        <h1 className="mt-2 font-serif text-4xl">{producer.name ?? "Producteur"}</h1>
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-ink/70">
          {producer.email ? <span>{producer.email}</span> : null}
          {producer.phone ? <span>{producer.phone}</span> : null}
          {producer.coopStatus ? <span>Statut: {producer.coopStatus}</span> : null}
        </div>
        {producer.notes ? <p className="mt-3 text-sm text-ink/70">{producer.notes}</p> : null}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
            Produits
          </p>
          <h2 className="font-serif text-3xl">Catalogue du producteur</h2>
        </div>
        {products.length === 0 ? (
          <div className="rounded-xl border border-clay/70 bg-white/90 p-6 shadow-card">
            <p className="text-sm text-ink/70">Aucun produit actif pour le moment.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <a
                key={product.id}
                className="group flex h-full flex-col gap-3 rounded-xl border border-clay/70 bg-white/95 p-4 shadow-card transition hover:-translate-y-1 hover:border-ink/30"
                href={`/products/${product.id}`}
              >
                <div className="flex h-32 items-center justify-center overflow-hidden rounded-lg border border-clay/70 bg-stone">
                  {product.imageUrl ? (
                    <img className="max-h-24 w-full object-contain" src={product.imageUrl} alt={product.name} />
                  ) : (
                    <span className="text-xs uppercase tracking-[0.2em] text-ink/50">Sans image</span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/60">
                      Produit
                    </p>
                    <h3 className="font-serif text-xl">{product.name}</h3>
                  </div>
                  <span className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                    {product.isOrganic ? "Bio" : "Conventionnel"}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
