"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel } from "@/lib/distributions";

type Producer = {
  id: string;
  name?: string;
  imageUrl?: string;
  email?: string;
  phone?: string;
  productType?: string;
  notes?: string;
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

type FireDate = { toDate?: () => Date };

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
  imageUrl: string;
  email: string;
  phone: string;
  productType: string;
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
  imageUrl: "",
  email: "",
  phone: "",
  productType: "",
  notes: "",
  referentId: "",
  contactFirstName: "",
  contactLastName: "",
  street: "",
  postalCode: "",
  city: "",
};

type RevenuePoint = { key: string; label: string; value: number };
type ActivityRow = { key: string; label: string; dates: string[] };

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

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
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);

  useEffect(() => {
    if (!producerId) return;
    const load = async () => {
      setLoading(true);
      const [producerSnap, referentSnap, productsSnap, ordersSnap, distributionsSnap] = await Promise.all([
        getDoc(doc(firebaseDb, "producers", producerId)),
        getDocs(query(collection(firebaseDb, "members"), where("auth.role", "in", ["referent", "admin"]))),
        getDocs(query(collection(firebaseDb, "products"), where("producerId", "==", producerId))),
        getDocs(collection(firebaseDb, "orders")),
        getDocs(collection(firebaseDb, "distributionDates")),
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
        imageUrl: data.imageUrl ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        productType: data.productType ?? "",
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

      const nextActivityRows: ActivityRow[] = [];
      await Promise.all(
        distributionsSnap.docs.map(async (distributionDoc) => {
          const distributionData = distributionDoc.data() as { dates?: FireDate[] };
          const dates = (distributionData.dates ?? [])
            .slice(0, 3)
            .map((entry) => entry.toDate?.())
            .filter(Boolean) as Date[];
          const keys = dates.map((value) => dateKey(value));
          if (!keys.length) return;

          const calendarDoc = await getDoc(
            doc(firebaseDb, "distributionDates", distributionDoc.id, "calendarProducers", producerId),
          );
          if (!calendarDoc.exists()) return;
          const calendarData = calendarDoc.data() as { activeDateKeys?: string[] };
          const activeKeys = Array.isArray(calendarData.activeDateKeys)
            ? calendarData.activeDateKeys.filter((key) => keys.includes(key))
            : [];
          if (!activeKeys.length) return;

          nextActivityRows.push({
            key: distributionDoc.id,
            label: distributionLabel({ id: distributionDoc.id, dates: distributionData.dates }),
            dates: activeKeys.map((key) =>
              new Date(`${key}T00:00:00`).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              }),
            ),
          });
        }),
      );
      setActivityRows(
        nextActivityRows.sort((left, right) =>
          (left.dates[0] ?? "").localeCompare(right.dates[0] ?? "", "fr"),
        ),
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
      imageUrl: draft.imageUrl.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      productType: draft.productType.trim(),
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
    setMessage("Producteur mis à jour.");
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-[260px] items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full border border-clay/70 bg-stone">
              {producer.imageUrl ? (
                <img src={producer.imageUrl} alt={producer.name ?? "Producteur"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.1em] text-ink/45">
                  Photo
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Producteur</p>
              <h2 className="font-serif text-3xl">{producer.name ?? "Producteur"}</h2>
            </div>
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
              {editing ? "Fermer" : "Éditer"}
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
                    <p>
                      <span className="text-ink/60">Contact prénom:</span>{" "}
                      {String(producer.contact?.firstName ?? "").trim() || "-"}
                    </p>
                    <p>
                      <span className="text-ink/60">Contact nom:</span>{" "}
                      {String(producer.contact?.lastName ?? "").trim() || "-"}
                    </p>
                    <p><span className="text-ink/60">Téléphone :</span> {producer.phone || "-"}</p>
                    <p><span className="text-ink/60">Email :</span> {producer.email || "-"}</p>
                    <p>
                      <span className="text-ink/60">Adresse :</span>{" "}
                      {[producer.address?.street, producer.address?.postalCode, producer.address?.city]
                        .map((value) => String(value ?? "").trim())
                        .filter(Boolean)
                        .join(" ") || "-"}
                    </p>
                    <p><span className="text-ink/60">Type de produit:</span> {producer.productType || "-"}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 text-sm leading-7 text-ink/70">
                {producer.notes || "Aucune précision."}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="border border-clay/70 bg-white/90 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produits associés</p>
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
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Produits associés</h3>
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
                  <p className="text-sm text-ink/60">Aucun produit associé.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Référent</h3>
              {producer.referentId ? (
                <Link
                  href={`/admin/members/${producer.referentId}`}
                  className="mt-3 inline-block text-sm font-semibold text-ink underline underline-offset-4"
                >
                  {producer.referentName || "Référent"}
                </Link>
              ) : (
                <p className="mt-3 text-sm text-ink/80">{producer.referentName || "Non attribué"}</p>
              )}
              <p className="text-sm text-ink/70">{producer.referentPhone || "-"}</p>
            </div>

            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Dates d'activite
              </h3>
              <div className="mt-4 grid gap-3">
                {activityRows.length ? (
                  activityRows.map((row) => (
                    <div key={row.key} className="border-b border-clay/40 pb-3 text-sm">
                      <p className="font-semibold text-ink">{row.label}</p>
                      <p className="text-ink/65">{row.dates.join(" - ")}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink/60">Aucune date active dans le calendrier annuel.</p>
                )}
              </div>
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
            <RevenueBars title="Évolution CA / année" points={yearlyRevenue} />

            <div className="border border-clay/70 bg-white/90 p-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Top 3 ventes</h3>
              <div className="mt-4 grid gap-3">
                {topProducts.length ? (
                  topProducts.map((item, index) => (
                    <div key={item.label} className="flex items-center justify-between border-b border-clay/40 pb-3 text-sm">
                      <div>
                        <p className="font-semibold text-ink">{index + 1}. {item.label}</p>
                        <p className="text-ink/60">{item.quantity} unité(s)</p>
                      </div>
                      <span className="font-semibold text-ink">{item.total.toFixed(2).replace(".", ",")} EUR</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink/60">Aucune vente enregistrée pour ce producteur.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-clay/70 bg-white/90 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Nom du producteur
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Photo (URL)
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.imageUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
                placeholder="https://..."
              />
            </label>
            <div className="md:col-span-2 rounded-xl border border-clay/70 bg-stone/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/60">Aperçu photo</p>
              <div className="mt-2 h-20 w-20 overflow-hidden rounded-full border border-clay/70 bg-stone">
                {draft.imageUrl.trim() ? (
                  <img src={draft.imageUrl.trim()} alt={draft.name || "Producteur"} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.1em] text-ink/45">
                    Aucune
                  </div>
                )}
              </div>
            </div>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Téléphone
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
              Prénom du contact
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.contactFirstName}
                onChange={(event) => setDraft((prev) => ({ ...prev, contactFirstName: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Nom du contact
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.contactLastName}
                onChange={(event) => setDraft((prev) => ({ ...prev, contactLastName: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Référent
              <select
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.referentId}
                onChange={(event) => setDraft((prev) => ({ ...prev, referentId: event.target.value }))}
              >
                <option value="">Aucun</option>
                {referents.map((ref) => (
                  <option key={ref.id} value={ref.id}>
                    {`${ref.firstName ?? ""} ${ref.lastName ?? ""}`.trim() || "Référent"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
              Adresse (rue)
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.street}
                onChange={(event) => setDraft((prev) => ({ ...prev, street: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Code postal
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.postalCode}
                onChange={(event) => setDraft((prev) => ({ ...prev, postalCode: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Ville
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.city}
                onChange={(event) => setDraft((prev) => ({ ...prev, city: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
              Notes / précisions
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

