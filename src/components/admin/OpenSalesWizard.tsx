"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel, isOpenStatus, pickOpenDistribution } from "@/lib/distributions";

type FireDate = { toDate?: () => Date };

type Distribution = { id: string; status?: string; dates?: FireDate[]; openedAt?: FireDate };
type Producer = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
  coopStatus?: string | null;
};
type Member = { id: string; firstName?: string; lastName?: string };
type Order = { distributionId?: string | null; totals?: { totalAmount?: number } };
type Variant = { id: string; label: string; price: number; activeDates: string[] };
type Product = {
  id: string;
  producerId: string;
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  variants: Variant[];
};

type ProducerRow = {
  producerId: string;
  producerName: string;
  referentId: string | null;
  referentName: string;
  validatedByReferent: boolean;
  validatedAtLabel: string;
  productCount: number;
};

type VariantDraft = {
  id?: string;
  tempId: string;
  label: string;
  price: number;
  activeDates: string[];
};

type ProductDraft = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  isOrganic: boolean;
  variants: VariantDraft[];
  existingVariantIds: string[];
};

const FINISHED = new Set(["finished", "fermee", "ferme", "closed"]);

const toDate = (value?: FireDate) => value?.toDate?.() ?? null;
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const formatDate = (value?: Date | null) =>
  value
    ? value.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "-";
const formatLongDate = (value?: Date | null) =>
  value
    ? value.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "-";
const money = (value: number) => value.toFixed(2).replace(".", ",");
const isPlanned = (status?: string) =>
  !isOpenStatus(status) && !FINISHED.has(String(status ?? "").toLowerCase());
const isProducerActive = (status?: string | null) =>
  !["inactive", "inactif", "inactif ", "off"].includes(String(status ?? "").toLowerCase().trim());
const fullName = (m?: Member | null) => `${m?.firstName ?? ""} ${m?.lastName ?? ""}`.trim();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export default function OpenSalesWizard() {
  const router = useRouter();
  const { effectiveRole, effectiveMemberId } = useAuth();
  const isAdmin = effectiveRole === "admin";
  const isReferent = effectiveRole === "referent";
  const canManageAdmin = isAdmin || isReferent;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [membersById, setMembersById] = useState<Record<string, Member>>({});
  const [productsByProducer, setProductsByProducer] = useState<Record<string, Product[]>>({});
  const [rows, setRows] = useState<ProducerRow[]>([]);
  const [targetId, setTargetId] = useState("");
  const [orderStats, setOrderStats] = useState<Record<string, { count: number; amount: number }>>({});

  const [flowOpen, setFlowOpen] = useState(false);
  const [flowProducerIds, setFlowProducerIds] = useState<string[]>([]);
  const [flowIndex, setFlowIndex] = useState(0);
  const [draftProducts, setDraftProducts] = useState<ProductDraft[]>([]);

  const openDistribution = useMemo(() => pickOpenDistribution(distributions), [distributions]);
  const planned = useMemo(() => distributions.filter((d) => isPlanned(d.status)), [distributions]);
  const targetDistribution = useMemo(
    () => distributions.find((d) => d.id === targetId) ?? openDistribution ?? planned[0] ?? null,
    [distributions, targetId, openDistribution, planned],
  );
  const saleDates = useMemo(
    () =>
      ((targetDistribution?.dates ?? []).slice(0, 3).map((d) => toDate(d)).filter(Boolean) as Date[]).map((d) => ({
        key: dateKey(d),
        label: formatDate(d),
      })),
    [targetDistribution],
  );
  const saleDateKeys = useMemo(() => saleDates.map((d) => d.key), [saleDates]);

  const currentProducerId = flowProducerIds[flowIndex] ?? "";
  const currentProducer = useMemo(
    () => producers.find((producer) => producer.id === currentProducerId) ?? null,
    [currentProducerId, producers],
  );
  const currentRow = useMemo(
    () => rows.find((row) => row.producerId === currentProducerId) ?? null,
    [currentProducerId, rows],
  );

  const syncRows = useCallback(
    async (
      distributionId: string,
      producerList: Producer[],
      memberMap: Record<string, Member>,
      productMap: Record<string, Product[]>,
    ) => {
      if (!distributionId) {
        setRows([]);
        return;
      }

      const producerById: Record<string, Producer> = {};
      producerList.forEach((producer) => {
        producerById[producer.id] = producer;
      });
      const producerIds = Object.keys(productMap).filter(
        (id) => (productMap[id] ?? []).length > 0 && Boolean(producerById[id]),
      );
      const producerSet = new Set(producerIds);

      const linkSnap = await getDocs(collection(firebaseDb, "distributionDates", distributionId, "producers"));
      const existing = new Map<
        string,
        { validatedByReferent?: boolean; validatedAt?: FireDate; referentId?: string | null; referentName?: string | null }
      >();
      linkSnap.docs.forEach((linkDoc) => existing.set(linkDoc.id, linkDoc.data() as never));

      const batch = writeBatch(firebaseDb);
      let changed = false;

      linkSnap.docs.forEach((linkDoc) => {
        if (!producerSet.has(linkDoc.id)) {
          batch.delete(linkDoc.ref);
          changed = true;
        }
      });

      const nextRows = producerIds.map((producerId) => {
        const producer = producerById[producerId];
        const dbRow = existing.get(producerId);
        const referentId = producer?.referentId ?? dbRow?.referentId ?? null;
        const referentName =
          fullName(referentId ? memberMap[referentId] : null) ||
          producer?.referentName ||
          dbRow?.referentName ||
          "Sans referent";

        if (
          !dbRow ||
          referentId !== (dbRow?.referentId ?? null) ||
          referentName !== String(dbRow?.referentName ?? "")
        ) {
          batch.set(
            doc(firebaseDb, "distributionDates", distributionId, "producers", producerId),
            {
              producerId,
              referentId,
              referentName,
              active: true,
              validatedByReferent: false,
              validatedAt: null,
            },
            { merge: true },
          );
          changed = true;
        }

        return {
          producerId,
          producerName: producer?.name ?? "Producteur",
          referentId,
          referentName,
          validatedByReferent: dbRow?.validatedByReferent === true,
          validatedAtLabel: formatLongDate(toDate(dbRow?.validatedAt)),
          productCount: (productMap[producerId] ?? []).length,
        } satisfies ProducerRow;
      });

      if (changed) await batch.commit();
      setRows(nextRows.sort((a, b) => a.producerName.localeCompare(b.producerName)));
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);

    const [distSnap, producerSnap, memberSnap, orderSnap, productSnap, variantSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates")),
      getDocs(collection(firebaseDb, "producers")),
      getDocs(collection(firebaseDb, "members")),
      getDocs(collection(firebaseDb, "orders")),
      getDocs(collection(firebaseDb, "products")),
      getDocs(collectionGroup(firebaseDb, "variants")),
    ]);

    const distItems = distSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Distribution, "id">) }));
    distItems.sort(
      (a, b) =>
        (toDate(a.dates?.[0]) ?? new Date(0)).getTime() -
        (toDate(b.dates?.[0]) ?? new Date(0)).getTime(),
    );
    setDistributions(distItems);

    const producerItems = producerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Producer, "id">) }));
    producerItems.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    const activeProducerItems = producerItems.filter((producer) => isProducerActive(producer.coopStatus));
    setProducers(activeProducerItems);

    const memberMap: Record<string, Member> = {};
    memberSnap.docs.forEach((d) => {
      memberMap[d.id] = { id: d.id, ...(d.data() as Omit<Member, "id">) };
    });
    setMembersById(memberMap);

    const stats: Record<string, { count: number; amount: number }> = {};
    orderSnap.docs.forEach((d) => {
      const order = d.data() as Order;
      const key = String(order.distributionId ?? "");
      if (!key) return;
      const prev = stats[key] ?? { count: 0, amount: 0 };
      prev.count += 1;
      prev.amount += Number(order.totals?.totalAmount ?? 0);
      stats[key] = prev;
    });
    setOrderStats(stats);

    const variantsByProduct: Record<string, Variant[]> = {};
    variantSnap.docs.forEach((d) => {
      const productId = d.ref.parent.parent?.id;
      if (!productId) return;
      if (!variantsByProduct[productId]) variantsByProduct[productId] = [];
      const data = d.data() as { label?: string; price?: number; activeDates?: string[] };
      variantsByProduct[productId].push({
        id: d.id,
        label: String(data.label ?? "Variante"),
        price: Number(data.price ?? 0),
        activeDates: Array.isArray(data.activeDates) ? data.activeDates : [],
      });
    });

    const nextProductsByProducer: Record<string, Product[]> = {};
    productSnap.docs.forEach((d) => {
      const data = d.data() as {
        producerId?: string;
        name?: string;
        description?: string;
        imageUrl?: string;
        isOrganic?: boolean;
      };
      const producerId = String(data.producerId ?? "");
      if (!producerId) return;
      if (!nextProductsByProducer[producerId]) nextProductsByProducer[producerId] = [];
      nextProductsByProducer[producerId].push({
        id: d.id,
        producerId,
        name: String(data.name ?? "Produit"),
        description: String(data.description ?? ""),
        imageUrl: String(data.imageUrl ?? ""),
        isOrganic: Boolean(data.isOrganic),
        variants: variantsByProduct[d.id] ?? [],
      });
    });
    Object.values(nextProductsByProducer).forEach((list) =>
      list.sort((a, b) => a.name.localeCompare(b.name)),
    );
    setProductsByProducer(nextProductsByProducer);

    const open = pickOpenDistribution(distItems);
    const plannedDist = distItems.filter((d) => isPlanned(d.status));
    const defaultTarget = open?.id ?? plannedDist[0]?.id ?? "";
    setTargetId((prev) => (prev && distItems.some((d) => d.id === prev) ? prev : defaultTarget));

    await syncRows(defaultTarget, activeProducerItems, memberMap, nextProductsByProducer);
    setLoading(false);
  }, [syncRows]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!targetId || loading) return;
    syncRows(targetId, producers, membersById, productsByProducer).catch(() => undefined);
  }, [targetId, loading, producers, membersById, productsByProducer, syncRows]);

  const validatedCount = rows.filter((row) => row.validatedByReferent).length;
  const pendingCount = Math.max(rows.length - validatedCount, 0);
  const canOpen = canManageAdmin && !openDistribution && validatedCount > 0;
  const openStats = openDistribution
    ? orderStats[openDistribution.id] ?? { count: 0, amount: 0 }
    : { count: 0, amount: 0 };

  const groups = useMemo(() => {
    const map: Record<
      string,
      { referentId: string | null; referentName: string; mine: boolean; rows: ProducerRow[] }
    > = {};
    rows.forEach((row) => {
      const key = row.referentId ?? row.referentName;
      if (!map[key]) {
        map[key] = {
          referentId: row.referentId,
          referentName: row.referentName,
          mine: Boolean(row.referentId && row.referentId === effectiveMemberId),
          rows: [],
        };
      }
      map[key].rows.push(row);
    });
    return Object.values(map).sort((a, b) => {
      if (a.mine && !b.mine) return -1;
      if (!a.mine && b.mine) return 1;
      return a.referentName.localeCompare(b.referentName);
    });
  }, [rows, effectiveMemberId]);

  const producersWithoutProducts = useMemo(
    () =>
      producers
        .filter((producer) => (productsByProducer[producer.id] ?? []).length === 0)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [producers, productsByProducer],
  );

  const openFlow = (producerIds: string[], startAt = 0) => {
    if (!producerIds.length) {
      setMessage("Aucun producteur a gerer pour cette vue.");
      return;
    }
    setMessage("");
    const safeIndex = Math.max(0, Math.min(startAt, producerIds.length - 1));
    const idsParam = encodeURIComponent(producerIds.join(","));
    const distributionParam = encodeURIComponent(targetDistribution?.id ?? "");
    router.push(`/admin/vente/gerer?distributionId=${distributionParam}&producerIds=${idsParam}&idx=${safeIndex}`);
  };

  const createDraftVariant = (): VariantDraft => ({
    tempId: newId(),
    label: "Nouvelle variante",
    price: 0,
    activeDates: [...saleDateKeys],
  });

  const createDraftProduct = (): ProductDraft => ({
    id: newId(),
    name: "Nouveau produit",
    description: "",
    imageUrl: "",
    isOrganic: false,
    variants: [createDraftVariant()],
    existingVariantIds: [],
  });

  useEffect(() => {
    if (!flowOpen) return;
    const source = productsByProducer[currentProducerId] ?? [];
    setDraftProducts(
      source.length
        ? source.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl,
            isOrganic: product.isOrganic,
            variants: product.variants.map((variant) => ({
              id: variant.id,
              tempId: variant.id,
              label: variant.label,
              price: variant.price,
              activeDates: [...saleDateKeys],
            })),
            existingVariantIds: product.variants.map((variant) => variant.id),
          }))
        : [createDraftProduct()],
    );
  }, [flowOpen, currentProducerId, productsByProducer, saleDateKeys]);

  const updateDraftProduct = (index: number, patch: Partial<ProductDraft>) => {
    setDraftProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const updateDraftVariant = (productIndex: number, variantIndex: number, patch: Partial<VariantDraft>) => {
    setDraftProducts((prev) =>
      prev.map((item, i) => {
        if (i !== productIndex) return item;
        const variants = item.variants.map((variant, vi) =>
          vi === variantIndex ? { ...variant, ...patch } : variant,
        );
        return { ...item, variants };
      }),
    );
  };

  const applyAllDates = (selected: boolean) => {
    setDraftProducts((prev) =>
      prev.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => ({
          ...variant,
          activeDates: selected ? [...saleDateKeys] : [],
        })),
      })),
    );
  };

  const setValidation = async (row: ProducerRow, validated: boolean) => {
    if (!targetDistribution) return;
    setSaving(true);
    await setDoc(
      doc(firebaseDb, "distributionDates", targetDistribution.id, "producers", row.producerId),
      {
        producerId: row.producerId,
        referentId: row.referentId,
        referentName: row.referentName,
        active: validated,
        validatedByReferent: validated,
        validatedAt: validated ? Timestamp.now() : null,
      },
      { merge: true },
    );
    await load();
    setSaving(false);
  };

  const saveDraft = async () => {
    if (!currentProducerId) return;
    setSaving(true);
    setMessage("");

    for (const product of draftProducts) {
      const payload = {
        producerId: currentProducerId,
        name: product.name.trim() || "Produit",
        description: product.description.trim(),
        imageUrl: product.imageUrl.trim(),
        isOrganic: Boolean(product.isOrganic),
        updatedAt: Timestamp.now(),
      };

      let productId = product.id;
      if (product.id.startsWith("tmp_")) {
        const created = await addDoc(collection(firebaseDb, "products"), payload);
        productId = created.id;
      } else {
        await setDoc(doc(firebaseDb, "products", productId), payload, { merge: true });
      }

      const keptExistingVariantIds = new Set<string>();
      for (const variant of product.variants) {
        const variantPayload = {
          label: variant.label.trim() || "Variante",
          price: Number.isFinite(Number(variant.price)) ? Number(variant.price) : 0,
          activeDates: Array.from(
            new Set(
              (Array.isArray(variant.activeDates) ? variant.activeDates : []).filter((key) =>
                saleDateKeys.includes(key),
              ),
            ),
          ),
        };

        if (variant.id && !variant.id.startsWith("tmp_")) {
          keptExistingVariantIds.add(variant.id);
          await setDoc(doc(firebaseDb, "products", productId, "variants", variant.id), variantPayload, {
            merge: true,
          });
        } else {
          await addDoc(collection(firebaseDb, "products", productId, "variants"), variantPayload);
        }
      }

      for (const existingVariantId of product.existingVariantIds) {
        if (!keptExistingVariantIds.has(existingVariantId)) {
          await deleteDoc(doc(firebaseDb, "products", productId, "variants", existingVariantId));
        }
      }
    }

    await load();
    setSaving(false);
    setMessage("Produits enregistres.");
  };

  const saveAndValidate = async () => {
    await saveDraft();
    if (currentRow) await setValidation(currentRow, true);
  };

  const openSale = async () => {
    if (!targetDistribution || !canOpen) return;
    setSaving(true);
    const batch = writeBatch(firebaseDb);
    distributions.forEach((distribution) => {
      if (isOpenStatus(distribution.status) && distribution.id !== targetDistribution.id) {
        batch.update(doc(firebaseDb, "distributionDates", distribution.id), { status: "finished" });
      }
    });
    batch.update(doc(firebaseDb, "distributionDates", targetDistribution.id), {
      status: "open",
      openedAt: Timestamp.now(),
    });
    await batch.commit();
    await load();
    setSaving(false);
  };

  const closeSale = async () => {
    if (!openDistribution || !canManageAdmin) return;
    setSaving(true);
    await updateDoc(doc(firebaseDb, "distributionDates", openDistribution.id), {
      status: "finished",
      closedAt: Timestamp.now(),
    });
    await load();
    setSaving(false);
  };

  const goToStep = (nextIndex: number) => {
    setFlowIndex(nextIndex);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (loading) {
    return (
      <div className="rounded-md border border-clay/80 bg-stone p-6 text-sm text-ink/70">
        Chargement des ventes...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-4xl">
              {openDistribution ? "Vente ouverte" : "Aucune vente ouverte"}
            </h2>
            <p className="mt-2 text-sm text-ink/70">
              {openDistribution
                ? `${distributionLabel(openDistribution)} ouverte le ${formatLongDate(
                    toDate(openDistribution.openedAt),
                  )}.`
                : targetDistribution
                  ? `Distribution cible : ${distributionLabel(targetDistribution)}.`
                  : "Aucune distribution planifiee."}
            </p>
          </div>
          <div className="flex gap-2">
            {canManageAdmin && openDistribution ? (
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold"
                onClick={closeSale}
                disabled={saving}
              >
                Fermer la vente
              </button>
            ) : null}
            {canManageAdmin && !openDistribution ? (
              <button
                className="rounded-md bg-forest px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openSale}
                disabled={saving || !canOpen}
              >
                Ouvrir la vente
              </button>
            ) : null}
          </div>
        </div>

        {openDistribution ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
              Commandes : <span className="font-semibold">{openStats.count}</span>
            </div>
            <div className="rounded-sm border border-forest/30 bg-forest/10 px-3 py-2 text-sm">
              Chiffre : <span className="font-semibold">{money(openStats.amount)} EUR</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-ink/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-3xl">Producteurs a valider</h3>
            <p className="mt-1 text-sm text-ink/70">
              Seuls les producteurs avec produits apparaissent dans le tableau.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {planned.length > 1 ? (
              <select
                className="rounded-md border border-ink/25 bg-stone px-4 py-2 text-sm"
                value={targetDistribution?.id ?? ""}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {planned.map((distribution) => (
                  <option key={distribution.id} value={distribution.id}>
                    {distributionLabel(distribution)}
                  </option>
                ))}
              </select>
            ) : null}
            {isReferent ? (
              <button
                className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white"
                onClick={() =>
                  openFlow(rows.filter((row) => row.referentId === effectiveMemberId).map((row) => row.producerId))
                }
              >
                Gerer mes producteurs pour la vente
              </button>
            ) : null}
            {canManageAdmin ? (
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold"
                onClick={() => openFlow(rows.map((row) => row.producerId))}
              >
                Gerer tous les producteurs
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs total : <span className="font-semibold">{rows.length}</span>
          </div>
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs valides : <span className="font-semibold">{validatedCount}</span>
          </div>
          <div className="rounded-sm border border-clay/70 bg-clay/10 px-3 py-2 text-sm">
            Producteurs a valider : <span className="font-semibold">{pendingCount}</span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border border-ink/20">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-ink/20 bg-ink text-xs uppercase tracking-[0.18em] text-stone">
              <tr>
                <th className="px-3 py-2">Referent</th>
                <th className="px-3 py-2">Producteur</th>
                <th className="px-3 py-2">Produits</th>
                <th className="px-3 py-2">Validation</th>
                <th className="px-3 py-2">Date validation</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.rows.map((row, index) => {
                  const canEdit = canManageAdmin;
                  const myProducerIds = rows
                    .filter((item) => item.referentId === effectiveMemberId)
                    .map((item) => item.producerId);
                  return (
                    <tr key={row.producerId} className={`border-b border-ink/10 ${group.mine ? "bg-forest/10" : "bg-white"}`}>
                      <td className="px-3 py-2 text-xs text-ink/70">{index === 0 ? group.referentName : null}</td>
                      <td className="px-3 py-2 font-semibold text-ink">{row.producerName}</td>
                      <td className="px-3 py-2 text-xs text-ink/70">{row.productCount}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-sm px-2 py-1 text-xs font-semibold ${
                            row.validatedByReferent
                              ? "border border-forest/40 bg-forest/15 text-forest"
                              : "border border-ink/20 bg-ink/5 text-ink/70"
                          }`}
                        >
                          {row.validatedByReferent ? "Valide" : "A valider"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink/60">{row.validatedAtLabel}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                            onClick={() => openFlow([row.producerId])}
                          >
                            Gerer
                          </button>
                          {isReferent && row.referentId === effectiveMemberId ? (
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                              onClick={() =>
                                openFlow(
                                  myProducerIds,
                                  myProducerIds.findIndex((id) => id === row.producerId),
                                )
                              }
                            >
                              Gerer tous mes producteurs
                            </button>
                          ) : null}
                          {canEdit ? (
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                              onClick={() => setValidation(row, !row.validatedByReferent).catch(() => undefined)}
                            >
                              {row.validatedByReferent ? "Retirer validation" : "Valider"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>

        {producersWithoutProducts.length > 0 ? (
          <div className="mt-4 border border-dashed border-ink/25 bg-ink/5 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">
              Producteurs sans produits ({producersWithoutProducts.length})
            </p>
            <p className="mt-1 text-xs text-ink/55">
              Ces producteurs existent, mais ne sont pas inclus dans la validation de vente.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {producersWithoutProducts.map((producer) => (
                <span
                  key={producer.id}
                  className="rounded-sm border border-ink/20 bg-stone px-2 py-1 text-xs text-ink/65"
                >
                  {producer.name ?? "Producteur"}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {flowOpen ? (
        <section className="rounded-md border border-ink/20 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/20 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Gerer mes producteurs pour la vente
              </p>
              <h4 className="mt-1 font-serif text-2xl">{currentProducer?.name ?? "Producteur"}</h4>
              <p className="text-sm text-ink/70">
                Producteur {flowIndex + 1} / {flowProducerIds.length}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => applyAllDates(true)}
              >
                Tout selectionner
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => applyAllDates(false)}
              >
                Tout deselectionner
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => setDraftProducts((prev) => [...prev, createDraftProduct()])}
              >
                Ajouter un produit
              </button>
              <button
                className="rounded-md border border-ink/25 px-3 py-1.5 text-sm font-semibold"
                onClick={() => setFlowOpen(false)}
              >
                Fermer edition
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {draftProducts.map((product, pIndex) => (
              <div key={`${product.id}-${pIndex}`} className="border border-ink/20 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="min-w-[280px] flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                    Nom produit
                    <input
                      className="mt-1 w-full rounded-sm border border-ink/20 bg-stone px-3 py-2 text-sm"
                      value={product.name}
                      onChange={(e) => updateDraftProduct(pIndex, { name: e.target.value })}
                    />
                  </label>
                  {product.id.startsWith("tmp_") ? (
                    <span className="text-xs text-ink/60">Enregistrer pour editer les details</span>
                  ) : (
                    <button
                      className="rounded-md border border-ink/25 px-3 py-2 text-xs font-semibold"
                      onClick={() =>
                        router.push(
                          `/admin/vente/produit/${product.id}?distributionId=${targetDistribution?.id ?? ""}&producerId=${currentProducerId}`,
                        )
                      }
                    >
                      Ouvrir details produit
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-ink/20">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b border-ink/20 bg-ink text-xs uppercase tracking-[0.12em] text-stone">
                      <tr>
                        <th className="px-2 py-2 text-left">Variante</th>
                        <th className="px-2 py-2 text-left">Prix</th>
                        {saleDates.map((date) => (
                          <th key={date.key} className="px-2 py-2 text-center">
                            {date.label}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.variants.map((variant, vIndex) => (
                        <tr key={variant.tempId} className="border-b border-ink/10">
                          <td className="px-2 py-2">
                            <input
                              className="w-full rounded-sm border border-ink/20 bg-stone px-2 py-1"
                              value={variant.label}
                              onChange={(e) => updateDraftVariant(pIndex, vIndex, { label: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="relative">
                              <input
                                className="w-full rounded-sm border border-ink/20 bg-stone px-2 py-1 pr-12"
                                type="number"
                                min={0}
                                step="0.01"
                                value={String(variant.price)}
                                onChange={(e) =>
                                  updateDraftVariant(pIndex, vIndex, { price: Number(e.target.value || 0) })
                                }
                              />
                              <span className="pointer-events-none absolute right-2 top-1 text-xs text-ink/55">
                                &euro;
                              </span>
                            </div>
                          </td>
                          {saleDates.map((date) => (
                            <td key={date.key} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={variant.activeDates.includes(date.key)}
                                onChange={() => {
                                  const current = variant.activeDates;
                                  const next = current.includes(date.key)
                                    ? current.filter((key) => key !== date.key)
                                    : [...current, date.key];
                                  updateDraftVariant(pIndex, vIndex, { activeDates: next });
                                }}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right">
                            <button
                              className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                              onClick={() =>
                                updateDraftProduct(pIndex, {
                                  variants: product.variants.filter((_, idx) => idx !== vIndex),
                                })
                              }
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <button
                    className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold"
                    onClick={() =>
                      updateDraftProduct(pIndex, {
                        variants: [...product.variants, createDraftVariant()],
                      })
                    }
                  >
                    Ajouter une variante
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink/20 pt-4">
            <div className="flex gap-2">
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                disabled={flowIndex <= 0}
                onClick={() => goToStep(Math.max(flowIndex - 1, 0))}
              >
                Precedent
              </button>
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                disabled={flowIndex >= flowProducerIds.length - 1}
                onClick={() => goToStep(Math.min(flowIndex + 1, flowProducerIds.length - 1))}
              >
                Suivant
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-ink/25 px-4 py-2 text-sm font-semibold"
                onClick={saveDraft}
                disabled={saving}
              >
                Enregistrer ce producteur
              </button>
              <button
                className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={saveAndValidate}
                disabled={saving || !currentRow}
              >
                Enregistrer et valider
              </button>
            </div>
          </div>

        </section>
      ) : null}
    </div>
  );
}
