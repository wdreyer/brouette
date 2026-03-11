"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type Producer = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  productType?: string;
  frequency?: string;
  notes?: string;
  coopStatus?: string | null;
  referentId?: string | null;
  referentName?: string | null;
  referentPhone?: string | null;
  contact?: { firstName?: string; lastName?: string };
  address?: { street?: string; postalCode?: string; city?: string };
};

type Referent = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  auth?: { role?: string };
};

type Product = {
  id: string;
  name?: string;
  categoryId?: string | null;
};

type OrderItem = {
  producerId?: string;
  productId?: string;
  quantity?: number;
  lineTotal?: number;
  label?: string;
  variantLabel?: string;
  saleDateLabel?: string;
  saleDateKey?: string;
};

type ProducerDraft = {
  name: string;
  coopStatus: string;
  email: string;
  phone: string;
  productType: string;
  frequency: string;
  notes: string;
  referentId: string;
  contactFirstName: string;
  contactLastName: string;
  street: string;
  postalCode: string;
  city: string;
};

const EMPTY_DRAFT: ProducerDraft = {
  name: "",
  coopStatus: "active",
  email: "",
  phone: "",
  productType: "",
  frequency: "",
  notes: "",
  referentId: "",
  contactFirstName: "",
  contactLastName: "",
  street: "",
  postalCode: "",
  city: "",
};

type RevenuePoint = { key: string; label: string; value: number };

function RevenueBars({ title, points }: { title: string; points: RevenuePoint[] }) {
  const values = points.map((point) => point.value);
  const maxValue = Math.max(...values, 1);
  return (
    <div className="border border-clay/70 bg-white/90 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">{title}</p>
      <div className="mt-3 flex h-28 items-end gap-2">
        {points.map((point) => {
          const height = point.value > 0 ? Math.max(10, Math.round((point.value / maxValue) * 96)) : 4;
          return (
            <div key={point.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-semibold text-ink/70">{point.value.toFixed(0)} €</span>
              <div className={`w-full rounded-sm ${point.value > 0 ? "bg-forest/70" : "bg-forest/20"}`} style={{ height }} />
              <span className="text-[10px] text-ink/60">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProducerPage() {
  const params = useParams();
  const router = useRouter();
  const producerId = String(params?.producerId ?? "");
  const [producer, setProducer] = useState<Producer | null>(null);
  const [referents, setReferents] = useState<Referent[]>([]);
  const [draft, setDraft] = useState<ProducerDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [salesHistory, setSalesHistory] = useState<{ label: string; total: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ label: string; quantity: number; total: number }[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState<RevenuePoint[]>([]);
  const [yearlyRevenue, setYearlyRevenue] = useState<RevenuePoint[]>([]);

  useEffect(() => {
    if (!producerId) return;
    const load = async () => {
      setLoading(true);
      const [producerSnap, referentSnap, productsSnap, ordersSnap] = await Promise.all([
        getDoc(doc(firebaseDb, "producers", producerId)),
        getDocs(query(collection(firebaseDb, "members"), where("auth.role", "==", "referent"))),
        getDocs(query(collection(firebaseDb, "products"), where("producerId", "==", producerId))),
        getDocs(collection(firebaseDb, "orders")),
      ]);
      if (!producerSnap.exists()) {
        setProducer(null);
        setLoading(false);
        return;
      }
      const data = producerSnap.data() as Omit<Producer, "id">;
      setProducer({ id: producerSnap.id, ...data });
      setDraft({
        name: data.name ?? "",
        coopStatus: data.coopStatus ?? "active",
        email: data.email ?? "",
        phone: data.phone ?? "",
        productType: data.productType ?? "",
        frequency: data.frequency ?? "",
        notes: data.notes ?? "",
        referentId: data.referentId ?? "",
        contactFirstName: data.contact?.firstName ?? "",
        contactLastName: data.contact?.lastName ?? "",
        street: data.address?.street ?? "",
        postalCode: data.address?.postalCode ?? "",
        city: data.address?.city ?? "",
      });
      const referentItems = referentSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Referent, "id">),
      }));
      setReferents(referentItems);

      const productItems = productsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Product, "id">),
      }));
      setProducts(productItems);

      const productMap = new Map(productItems.map((item) => [item.id, item.name ?? "Produit"]));
      const historyMap = new Map<string, number>();
      const topMap = new Map<string, { quantity: number; total: number }>();
      const monthMap = new Map<string, number>();
      const yearMap = new Map<string, number>();
      let nextRevenue = 0;

      await Promise.all(
        ordersSnap.docs.map(async (orderDoc) => {
          const itemsSnap = await getDocs(collection(firebaseDb, "orders", orderDoc.id, "items"));
          itemsSnap.docs.forEach((itemDoc) => {
            const item = itemDoc.data() as OrderItem;
            if (item.producerId !== producerId) return;
            const label = item.saleDateLabel ?? item.saleDateKey ?? "Date";
            const lineTotal = Number(item.lineTotal ?? 0);
            const quantity = Number(item.quantity ?? 0);
            historyMap.set(label, (historyMap.get(label) ?? 0) + lineTotal);
            const productLabel = productMap.get(item.productId ?? "") ?? item.label ?? "Produit";
            const current = topMap.get(productLabel) ?? { quantity: 0, total: 0 };
            topMap.set(productLabel, {
              quantity: current.quantity + quantity,
              total: current.total + lineTotal,
            });
            if (item.saleDateKey) {
              const date = new Date(`${item.saleDateKey}T00:00:00.000Z`);
              if (!Number.isNaN(date.getTime())) {
                const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
                const yearKey = String(date.getUTCFullYear());
                monthMap.set(monthKey, (monthMap.get(monthKey) ?? 0) + lineTotal);
                yearMap.set(yearKey, (yearMap.get(yearKey) ?? 0) + lineTotal);
              }
            }
            nextRevenue += lineTotal;
          });
        }),
      );

      setSalesHistory(
        Array.from(historyMap.entries()).map(([label, total]) => ({ label, total })),
      );
      setTopProducts(
        Array.from(topMap.entries())
          .map(([label, value]) => ({ label, quantity: value.quantity, total: value.total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 3),
      );
      setTotalRevenue(nextRevenue);
      setMonthlyRevenue(
        Array.from(monthMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-12)
          .map(([key, value]) => {
            const [year, month] = key.split("-");
            return {
              key,
              label: `${month}/${year.slice(-2)}`,
              value,
            } satisfies RevenuePoint;
          }),
      );
      setYearlyRevenue(
        Array.from(yearMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-5)
          .map(([key, value]) => ({ key, label: key, value })),
      );
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [producerId]);

  const selectedReferent = useMemo(
    () => referents.find((ref) => ref.id === draft.referentId) ?? null,
    [referents, draft.referentId],
  );

  const save = async () => {
    if (!producerId) return;
    setMessage("");
    const referentName = selectedReferent
      ? `${selectedReferent.firstName ?? ""} ${selectedReferent.lastName ?? ""}`.trim()
      : "";
    const payload = {
      name: draft.name.trim(),
      coopStatus: draft.coopStatus === "inactive" ? "inactive" : "active",
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      productType: draft.productType.trim(),
      frequency: draft.frequency.trim(),
      notes: draft.notes.trim(),
      referentId: draft.referentId || null,
      referentName: referentName || null,
      referentPhone: selectedReferent?.phone ?? null,
      contact: {
        firstName: draft.contactFirstName.trim(),
        lastName: draft.contactLastName.trim(),
      },
      address: {
        street: draft.street.trim(),
        postalCode: draft.postalCode.trim(),
        city: draft.city.trim(),
      },
    };
    await setDoc(doc(firebaseDb, "producers", producerId), payload, { merge: true });
    setProducer((prev) => (prev ? { ...prev, ...payload } : prev));
    setEditing(false);
    setMessage("Producteur mis a jour.");
  };

  const removeProducer = async () => {
    if (!producerId) return;
    const ok = window.confirm("Supprimer ce producteur ?");
    if (!ok) return;
    await deleteDoc(doc(firebaseDb, "producers", producerId));
    router.push("/admin/producers");
  };

  if (loading) {
    return <p className="text-sm text-ink/70">Chargement...</p>;
  }

  if (!producer) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/70">Producteur introuvable.</p>
        <Link className="text-sm font-semibold text-ink" href="/admin/producers">
          Retour
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-clay/70 bg-white/90 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteur</p>
            <h2 className="font-serif text-3xl">{producer.name ?? "Producteur"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold" href="/admin/producers">
              Retour
            </Link>
            <button
              className="rounded-full border border-ember/25 px-4 py-2 text-xs font-semibold text-ember"
              onClick={removeProducer}
            >
              Supprimer
            </button>
            <button
              className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-stone"
              onClick={() => setEditing((prev) => !prev)}
            >
              {editing ? "Fermer" : "Editer"}
            </button>
          </div>
        </div>
        {message ? <p className="mt-2 text-sm text-ink/70">{message}</p> : null}
      </div>

      {!editing ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-6">
            <div className="border border-clay/70 bg-white/90 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                    Informations
                  </h3>
                  <div className="mt-4 grid gap-3 text-sm text-ink/80">
                    <p><span className="text-ink/60">Telephone:</span> {producer.phone || "-"}</p>
                    <p><span className="text-ink/60">Email:</span> {producer.email || "-"}</p>
                    <p><span className="text-ink/60">Statut:</span> {producer.coopStatus === "inactive" ? "Inactif" : "Actif"}</p>
                    <p><span className="text-ink/60">Type de produit:</span> {producer.productType || "-"}</p>
                    <p><span className="text-ink/60">Frequence:</span> {producer.frequency || "-"}</p>
                  </div>
                </div>
                {producer.email ? (
                  <a
                    className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold"
                    href={`mailto:${producer.email}?subject=${encodeURIComponent(`Brouette - ${producer.name ?? "Producteur"}`)}`}
                  >
                    Contacter le producteur
                  </a>
                ) : null}
              </div>
              <div className="mt-4 text-sm leading-7 text-ink/70">
                {producer.notes || "Aucune precision."}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="border border-clay/70 bg-white/90 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produits associes</p>
                <p className="mt-2 font-serif text-3xl">{products.length}</p>
              </div>
              <div className="border border-clay/70 bg-white/90 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Chiffre d'affaires</p>
                <p className="mt-2 font-serif text-3xl">{totalRevenue.toFixed(2).replace(".", ",")} EUR</p>
              </div>
              <div className="border border-clay/70 bg-white/90 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Top ventes</p>
                <p className="mt-2 font-serif text-3xl">{topProducts.length}</p>
              </div>
            </div>

            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produits associes</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {products.length ? (
                  products.map((item) => (
                    <Link
                      key={item.id}
                      href={`/products/${item.id}`}
                      className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/75"
                    >
                      {item.name ?? "Produit"}
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-ink/60">Aucun produit associe.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Referent</h3>
              {producer.referentId ? (
                <Link
                  href={`/admin/members/${producer.referentId}`}
                  className="mt-3 inline-block text-sm font-semibold text-ink underline underline-offset-4"
                >
                  {producer.referentName || "Referent"}
                </Link>
              ) : (
                <p className="mt-3 text-sm text-ink/80">{producer.referentName || "Non attribue"}</p>
              )}
              <p className="text-sm text-ink/70">{producer.referentPhone || "-"}</p>
            </div>

            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Historique des ventes</h3>
              <div className="mt-4 grid gap-3">
                {salesHistory.length ? (
                  salesHistory.map((item) => (
                    <div key={item.label} className="flex items-center justify-between border-b border-clay/40 pb-3 text-sm">
                      <span className="text-ink/70">{item.label}</span>
                      <span className="font-semibold text-ink">{item.total.toFixed(2).replace(".", ",")} EUR</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink/60">Pas encore d'historique de commandes.</p>
                )}
              </div>
            </div>

            <RevenueBars title="Evolution CA / mois" points={monthlyRevenue} />
            <RevenueBars title="Evolution CA / annee" points={yearlyRevenue} />

            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Top 3 ventes</h3>
              <div className="mt-4 grid gap-3">
                {topProducts.length ? (
                  topProducts.map((item, index) => (
                    <div key={item.label} className="flex items-center justify-between border-b border-clay/40 pb-3 text-sm">
                      <div>
                        <p className="font-semibold text-ink">{index + 1}. {item.label}</p>
                        <p className="text-ink/60">{item.quantity} unite(s)</p>
                      </div>
                      <span className="font-semibold text-ink">{item.total.toFixed(2).replace(".", ",")} EUR</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink/60">Aucune vente enregistree pour ce producteur.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-clay/70 bg-white/90 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Nom
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Statut
              <select
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.coopStatus}
                onChange={(event) => setDraft((prev) => ({ ...prev, coopStatus: event.target.value }))}
              >
                <option value="active">Actif</option>
                <option value="inactive">Inactif</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Telephone
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.phone}
                onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Email
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.email}
                onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Type de produit
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.productType}
                onChange={(event) => setDraft((prev) => ({ ...prev, productType: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Frequence
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.frequency}
                onChange={(event) => setDraft((prev) => ({ ...prev, frequency: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Referent
              <select
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.referentId}
                onChange={(event) => setDraft((prev) => ({ ...prev, referentId: event.target.value }))}
              >
                <option value="">Aucun</option>
                {referents.map((ref) => (
                  <option key={ref.id} value={ref.id}>
                    {`${ref.firstName ?? ""} ${ref.lastName ?? ""}`.trim() || "Referent"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
              Notes / precisions
              <textarea
                className="min-h-[120px] rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.notes}
                onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
              onClick={save}
            >
              Enregistrer
            </button>
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
              onClick={() => {
                setEditing(false);
                router.refresh();
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
