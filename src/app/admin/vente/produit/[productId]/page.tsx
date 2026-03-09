"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type FireDate = { toDate?: () => Date };

type ProductDoc = {
  producerId?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
};

type VariantDraft = {
  id?: string;
  tempId: string;
  label: string;
  price: number;
  activeDates: string[];
};

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export default function AdminSaleProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const productId = String(params?.productId ?? "");
  const distributionId = searchParams.get("distributionId") ?? "";
  const producerId = searchParams.get("producerId") ?? "";
  const producerIds = searchParams.get("producerIds") ?? "";
  const idx = searchParams.get("idx") ?? "0";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [product, setProduct] = useState({
    name: "",
    description: "",
    imageUrl: "",
    isOrganic: false,
    producerId: producerId,
  });
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [existingVariantIds, setExistingVariantIds] = useState<string[]>([]);
  const [saleDates, setSaleDates] = useState<{ key: string; label: string }[]>([]);
  const backToManager = producerIds
    ? `/admin/vente/gerer?distributionId=${encodeURIComponent(distributionId)}&producerIds=${encodeURIComponent(producerIds)}&idx=${encodeURIComponent(idx)}`
    : "/admin/vente";

  useEffect(() => {
    if (!productId) return;
    const load = async () => {
      setLoading(true);
      const productRef = doc(firebaseDb, "products", productId);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) {
        setLoading(false);
        return;
      }

      const data = productSnap.data() as ProductDoc;
      setProduct({
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        imageUrl: String(data.imageUrl ?? ""),
        isOrganic: Boolean(data.isOrganic),
        producerId: String(data.producerId ?? producerId ?? ""),
      });

      const variantsSnap = await getDocs(collection(firebaseDb, "products", productId, "variants"));
      const draftItems = variantsSnap.docs.map((variantDoc) => {
        const variantData = variantDoc.data() as { label?: string; price?: number; activeDates?: string[] };
        return {
          id: variantDoc.id,
          tempId: variantDoc.id,
          label: String(variantData.label ?? ""),
          price: Number(variantData.price ?? 0),
          activeDates: Array.isArray(variantData.activeDates) ? variantData.activeDates : [],
        } satisfies VariantDraft;
      });
      setVariants(draftItems);
      setExistingVariantIds(draftItems.map((item) => item.id!).filter(Boolean));

      if (distributionId) {
        const distSnap = await getDoc(doc(firebaseDb, "distributionDates", distributionId));
        if (distSnap.exists()) {
          const distData = distSnap.data() as { dates?: FireDate[] };
          const dates = (distData.dates ?? [])
            .slice(0, 3)
            .map((d) => d.toDate?.())
            .filter(Boolean) as Date[];
          setSaleDates(
            dates.map((d) => ({
              key: dateKey(d),
              label: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }),
            })),
          );
        }
      }

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [distributionId, producerId, productId]);

  const finalDates = useMemo(() => {
    if (saleDates.length) return saleDates;
    const keys = Array.from(new Set(variants.flatMap((variant) => variant.activeDates))).sort();
    return keys.map((key) => ({ key, label: key }));
  }, [saleDates, variants]);

  const save = async () => {
    if (!productId) return;
    setSaving(true);
    setMessage("");

    await setDoc(
      doc(firebaseDb, "products", productId),
      {
        name: product.name.trim(),
        description: product.description.trim(),
        imageUrl: product.imageUrl.trim(),
        isOrganic: Boolean(product.isOrganic),
        producerId: product.producerId || producerId,
      },
      { merge: true },
    );

    const keptIds = new Set<string>();
    for (const variant of variants) {
      const payload = {
        label: variant.label.trim() || "Variante",
        price: Number(variant.price || 0),
        activeDates: Array.from(new Set(variant.activeDates)),
      };
      if (variant.id) {
        keptIds.add(variant.id);
        await setDoc(doc(firebaseDb, "products", productId, "variants", variant.id), payload, { merge: true });
      } else {
        await addDoc(collection(firebaseDb, "products", productId, "variants"), payload);
      }
    }

    for (const existingId of existingVariantIds) {
      if (!keptIds.has(existingId)) {
        await deleteDoc(doc(firebaseDb, "products", productId, "variants", existingId));
      }
    }

    setExistingVariantIds(Array.from(keptIds));
    setSaving(false);
    setMessage("Produit enregistre.");
  };

  if (loading) return <div className="p-6 text-sm text-ink/70">Chargement...</div>;

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Edition produit</p>
            <h1 className="mt-1 font-serif text-3xl text-ink">{product.name || "Produit"}</h1>
          </div>
          <button
            className="rounded-md border border-ink/30 px-4 py-2 text-sm font-semibold text-ink"
            onClick={() => router.push(backToManager)}
          >
            Retour vente
          </button>
        </div>
      </section>

      <section className="border border-ink/20 bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
            Nom produit
            <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" value={product.name} onChange={(e) => setProduct((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
            Image URL
            <input className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm" value={product.imageUrl} onChange={(e) => setProduct((p) => ({ ...p, imageUrl: e.target.value }))} />
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
          Description
          <textarea className="mt-1 min-h-[120px] w-full border border-ink/25 px-3 py-2 text-sm" value={product.description} onChange={(e) => setProduct((p) => ({ ...p, description: e.target.value }))} />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink/80">
          <input type="checkbox" checked={product.isOrganic} onChange={(e) => setProduct((p) => ({ ...p, isOrganic: e.target.checked }))} />
          Produit bio
        </label>
      </section>

      <section className="border border-ink/20 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Variantes</h2>
        <div className="mt-3 overflow-x-auto border border-ink/20">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-ink text-stone">
              <tr>
                <th className="px-2 py-2 text-left">Variante</th>
                <th className="px-2 py-2 text-left">Prix</th>
                {finalDates.map((date) => <th key={date.key} className="px-2 py-2 text-center">{date.label}</th>)}
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant, index) => (
                <tr key={variant.tempId} className="border-b border-ink/10">
                  <td className="px-2 py-2"><input className="w-full border border-ink/25 px-2 py-1" value={variant.label} onChange={(e) => setVariants((prev) => prev.map((v, i) => i === index ? { ...v, label: e.target.value } : v))} /></td>
                  <td className="px-2 py-2"><input className="w-full border border-ink/25 px-2 py-1" type="number" step="0.01" value={String(variant.price)} onChange={(e) => setVariants((prev) => prev.map((v, i) => i === index ? { ...v, price: Number(e.target.value || 0) } : v))} /></td>
                  {finalDates.map((date) => <td key={date.key} className="px-2 py-2 text-center"><input type="checkbox" checked={variant.activeDates.includes(date.key)} onChange={() => setVariants((prev) => prev.map((v, i) => i === index ? { ...v, activeDates: v.activeDates.includes(date.key) ? v.activeDates.filter((k) => k !== date.key) : [...v.activeDates, date.key] } : v))} /></td>)}
                  <td className="px-2 py-2 text-right"><button className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold" onClick={() => setVariants((prev) => prev.filter((_, i) => i !== index))}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="mt-3 rounded-md border border-ink/30 px-3 py-1 text-xs font-semibold" onClick={() => setVariants((prev) => [...prev, { id: undefined, tempId: newId(), label: "Nouvelle variante", price: 0, activeDates: finalDates.map((d) => d.key) }])}>Ajouter une variante</button>
      </section>

      <div className="flex items-center justify-between">
        {message ? <p className="text-sm text-ink/70">{message}</p> : <span />}
        <button className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={save} disabled={saving}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
