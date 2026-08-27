"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { isDistributionOpenNow } from "@/lib/distributions";
import { useAuth } from "@/components/auth/AuthProvider";

type ProductDoc = {
  producerId?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  isOrganic?: boolean;
  isSoldByWeight?: boolean;
  estimatedPriceMin?: number | null;
  estimatedPriceMax?: number | null;
  saleLimit?: number | null;
};

type FireDate = { toDate?: () => Date };

type VariantDraft = {
  id?: string;
  tempId: string;
  label: string;
  price: number;
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const parseNullableNumber = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

export default function AdminSaleProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { effectiveRole } = useAuth();

  const productId = String(params?.productId ?? "");
  const distributionId = searchParams.get("distributionId") ?? "";
  const producerId = searchParams.get("producerId") ?? "";
  const producerIds = searchParams.get("producerIds") ?? "";
  const idx = searchParams.get("idx") ?? "0";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [distributionLocked, setDistributionLocked] = useState(false);
  const [product, setProduct] = useState({
    name: "",
    description: "",
    imageUrl: "",
    isOrganic: false,
    isSoldByWeight: false,
    estimatedPriceMin: "",
    estimatedPriceMax: "",
    limitTotal: "",
    producerId: producerId,
  });
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [existingVariantIds, setExistingVariantIds] = useState<string[]>([]);
  const canEditOpenSale = effectiveRole === "admin";
  const editingLocked = distributionLocked && !canEditOpenSale;
  const backToManager = producerIds
    ? `/admin/vente/gerer?distributionId=${encodeURIComponent(distributionId)}&producerIds=${encodeURIComponent(producerIds)}&idx=${encodeURIComponent(idx)}`
    : "/admin/vente";

  useEffect(() => {
    if (!productId) return;
    const load = async () => {
      setLoading(true);
      if (distributionId) {
        const distributionSnap = await getDoc(doc(firebaseDb, "distributionDates", distributionId));
        if (distributionSnap.exists()) {
          const distributionData = distributionSnap.data() as { status?: string; closeAt?: FireDate };
          setDistributionLocked(
            isDistributionOpenNow({
              id: distributionId,
              status: distributionData.status,
              closeAt: distributionData.closeAt,
            }),
          );
        } else {
          setDistributionLocked(false);
        }
      } else {
        setDistributionLocked(false);
      }
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
        isSoldByWeight: Boolean(data.isSoldByWeight),
        estimatedPriceMin:
          typeof data.estimatedPriceMin === "number" && data.estimatedPriceMin >= 0
            ? String(data.estimatedPriceMin)
            : "",
        estimatedPriceMax:
          typeof data.estimatedPriceMax === "number" && data.estimatedPriceMax >= 0
            ? String(data.estimatedPriceMax)
            : "",
        limitTotal:
          typeof data.saleLimit === "number" && data.saleLimit > 0
            ? String(data.saleLimit)
            : "",
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
        } satisfies VariantDraft;
      });
      setVariants(draftItems);
      setExistingVariantIds(draftItems.map((item) => item.id!).filter(Boolean));

      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [distributionId, producerId, productId]);

  const save = async () => {
    if (!productId) return;
    if (editingLocked) {
      setMessage("Cette distribution est ouverte : modifications reservees aux admins.");
      return;
    }
    setSaving(true);
    setMessage("");
    const isSoldByWeight = Boolean(product.isSoldByWeight);
    const estimatedPrice = isSoldByWeight ? parseNullableNumber(product.estimatedPriceMin) : null;
    const parsedLimit = Number(product.limitTotal || 0);

    await setDoc(
      doc(firebaseDb, "products", productId),
      {
        name: product.name.trim(),
        description: product.description.trim(),
        imageUrl: product.imageUrl.trim(),
        isOrganic: Boolean(product.isOrganic),
        isSoldByWeight,
        estimatedPriceMin: estimatedPrice,
        estimatedPriceMax: estimatedPrice,
        saleLimit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
        producerId: product.producerId || producerId,
      },
      { merge: true },
    );

    const keptIds = new Set<string>();
    for (const variant of variants) {
      const payload = {
        label: variant.label.trim() || "Variante",
        price: isSoldByWeight ? 0 : Number(variant.price || 0),
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
        {editingLocked ? (
          <p className="mb-3 text-sm font-semibold text-ember">Cette distribution est ouverte : edition reservee aux admins.</p>
        ) : distributionLocked ? (
          <p className="mb-3 text-sm font-semibold text-moss">Vente ouverte : modifications autorisees (admin).</p>
        ) : null}
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
        <label className="mt-3 flex items-center gap-2 text-sm text-ink/80">
          <input
            type="checkbox"
            checked={product.isSoldByWeight}
            onChange={(e) =>
              setProduct((p) => ({ ...p, isSoldByWeight: e.target.checked }))
            }
          />
          Produit au poids (prix final après pesée)
        </label>
        {product.isSoldByWeight ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
              Prix estimatif
              <input
                className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm"
                type="number"
                min={0}
                step="0.01"
                value={product.estimatedPriceMin}
                onChange={(e) =>
                  setProduct((p) => ({
                    ...p,
                    estimatedPriceMin: e.target.value,
                    estimatedPriceMax: e.target.value,
                  }))
                }
              />
            </label>
          </div>
        ) : null}
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
          Stock limité (optionnel)
          <input
            className="mt-1 w-full border border-ink/25 px-3 py-2 text-sm"
            type="number"
            min={0}
            value={product.limitTotal}
            onChange={(e) => setProduct((p) => ({ ...p, limitTotal: e.target.value }))}
          />
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
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant, index) => (
                <tr key={variant.tempId} className="border-b border-ink/10">
                  <td className="px-2 py-2"><input className="w-full border border-ink/25 px-2 py-1" value={variant.label} onChange={(e) => setVariants((prev) => prev.map((v, i) => i === index ? { ...v, label: e.target.value } : v))} /></td>
                  <td className="px-2 py-2"><input className="w-full border border-ink/25 px-2 py-1 disabled:bg-stone/60 disabled:text-ink/55" type="number" step="0.01" value={String(product.isSoldByWeight ? 0 : variant.price)} disabled={product.isSoldByWeight} onChange={(e) => setVariants((prev) => prev.map((v, i) => i === index ? { ...v, price: Number(e.target.value || 0) } : v))} /></td>
                  <td className="px-2 py-2 text-right"><button className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold" onClick={() => setVariants((prev) => prev.filter((_, i) => i !== index))}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="mt-3 rounded-md border border-ink/30 px-3 py-1 text-xs font-semibold" onClick={() => setVariants((prev) => [...prev, { id: undefined, tempId: newId(), label: "Nouvelle variante", price: 0 }])}>Ajouter une variante</button>
      </section>

      <div className="flex items-center justify-between">
        {message ? <p className="text-sm text-ink/70">{message}</p> : <span />}
        <button className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={save} disabled={saving || editingLocked}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
