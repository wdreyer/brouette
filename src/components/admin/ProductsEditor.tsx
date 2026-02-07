"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type FieldType = "text" | "number" | "boolean";

type FieldConfig = {
  label: string;
  path: string;
  type: FieldType;
  table?: boolean;
};

type EditorProps = {
  collectionName: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
};

type DocEntry = {
  id: string;
  data: Record<string, unknown>;
};

type Distribution = {
  id: string;
  dates?: { toDate: () => Date }[];
  status?: string;
};

type Producer = {
  id: string;
  name?: string;
};

type Category = {
  id: string;
  name?: string;
};

type VariantDraft = {
  id?: string;
  tempId?: string;
  label: string;
  type?: string;
  unit?: string;
  price: number;
  activeDates?: string[];
  isNew?: boolean;
  toDelete?: boolean;
};

function getByPath(obj: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function toInputValue(value: unknown, type: FieldType) {
  if (type === "boolean") return Boolean(value);
  if (type === "number") return value === undefined || value === null ? "" : String(value);
  return value === undefined || value === null ? "" : String(value);
}

function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export default function ProductsEditor({
  collectionName,
  title,
  description,
  fields,
}: EditorProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [editTags, setEditTags] = useState("");
  const [editVariants, setEditVariants] = useState<VariantDraft[]>([]);
  const [editVariantDates, setEditVariantDates] = useState<Record<string, string[]>>({});
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);
  const [openPeriodDates, setOpenPeriodDates] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [createTags, setCreateTags] = useState("");
  const [filter, setFilter] = useState("");
  const [producerFilter, setProducerFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const cardFields = useMemo(() => fields.filter((field) => field.table), [fields]);

  const load = async () => {
    setLoading(true);
    const [productsSnap, distributionsSnap, openDistSnap, producersSnap, categoriesSnap] = await Promise.all([
      getDocs(query(collection(firebaseDb, collectionName), limit(100))),
      getDocs(query(collection(firebaseDb, "distributionDates"), limit(50))),
      getDocs(query(collection(firebaseDb, "distributionDates"), where("status", "==", "open"), limit(1))),
      getDocs(query(collection(firebaseDb, "producers"), limit(100))),
      getDocs(query(collection(firebaseDb, "categories"), limit(100))),
    ]);
    const items = productsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    const periods = distributionsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Distribution, "id">),
    }));
    periods.sort((a, b) => {
      const aDate = a.dates?.[0]?.toDate?.() ?? new Date(0);
      const bDate = b.dates?.[0]?.toDate?.() ?? new Date(0);
      return aDate.getTime() - bDate.getTime();
    });
    setDocs(items);
    setDistributions(periods);
    setProducers(
      producersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Producer, "id">),
      })),
    );
    setCategories(
      categoriesSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Category, "id">),
      })),
    );
    const openDist = openDistSnap.docs[0]?.data() as Distribution | undefined;
    const openDates = (openDist?.dates ?? []).map((date) => dateKey(date.toDate()));
    setOpenPeriodDates(openDates);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

  const activePeriodDates = useMemo(() => {
    if (openPeriodDates.length > 0) return openPeriodDates;
    return distributions
      .flatMap((dist) => (dist.dates ?? []).map((date) => dateKey(date.toDate())))
      .sort((a, b) => a.localeCompare(b));
  }, [openPeriodDates, distributions]);

  const activePeriodLabels = useMemo(
    () => activePeriodDates.map((key) => formatDate(dateFromKey(key))),
    [activePeriodDates],
  );

  const producerOptions = useMemo(() => {
    if (producers.length > 0) {
      return producers
        .map((producer) => ({
          id: producer.id,
          label: producer.name ? `${producer.name}` : producer.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    const ids = Array.from(new Set(docs.map((doc) => String(getByPath(doc.data, "producerId") ?? ""))));
    return ids
      .filter(Boolean)
      .map((id) => ({ id, label: id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [docs, producers]);

  const categoryOptions = useMemo(() => {
    if (categories.length > 0) {
      return categories
        .map((category) => ({
          id: category.id,
          label: category.name ? `${category.name}` : category.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return [];
  }, [categories]);

  const filteredDocs = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return docs.filter((entry) => {
      const producerId = String(getByPath(entry.data, "producerId") ?? "");
      if (producerFilter !== "all" && producerId !== producerFilter) return false;
      if (categoryFilter !== "all") {
        const categoryId = String(getByPath(entry.data, "categoryId") ?? "");
        if (categoryId !== categoryFilter) return false;
      }
      if (!term) return true;
      const haystack = [
        entry.id,
        getByPath(entry.data, "name"),
        getByPath(entry.data, "producerId"),
      ]
        .map((value) => (value ? String(value).toLowerCase() : ""))
        .join(" ");
      return haystack.includes(term);
    });
  }, [docs, filter, producerFilter, categoryFilter]);

  const openEdit = async (entry: DocEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.data);
    const tags = (entry.data.tags as string[] | undefined) ?? [];
    setEditTags(tags.join(", "));
    const saleDates = ((entry.data.saleDates as Timestamp[] | undefined) ?? []).map((date) =>
      dateKey(date.toDate()),
    );

    const variantSnap = await getDocs(
      query(collection(firebaseDb, "products", entry.id, "variants"), limit(50)),
    );
    const variantItems = variantSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<VariantDraft, "id">),
    }));
    const variants = variantItems.map((variant) => ({
      id: variant.id,
      label: variant.label ?? "",
      type: variant.type ?? "",
      unit: variant.unit ?? "",
      price: Number(variant.price ?? 0),
      activeDates: (variant as VariantDraft).activeDates ?? [],
    }));
    setEditVariants(variants);
    const dateMap: Record<string, string[]> = {};
    variants.forEach((variant) => {
      const key = variant.id ?? variant.tempId ?? "";
      if (!key) return;
      dateMap[key] = Array.isArray(variant.activeDates) ? variant.activeDates : saleDates;
    });
    setEditVariantDates(dateMap);
    setRemovedVariantIds([]);
    setMessage("");
  };

  const addVariant = () => {
    const tempId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tmp_${Date.now()}`;
    setEditVariants((prev) => [
      ...prev,
      {
        label: "",
        type: "",
        unit: "",
        price: 0,
        isNew: true,
        tempId,
      },
    ]);
    setEditVariantDates((prev) => ({ ...prev, [tempId]: activePeriodDates }));
  };

  const updateVariant = (index: number, patch: Partial<VariantDraft>) => {
    setEditVariants((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeVariant = (index: number) => {
    setEditVariants((prev) => {
      const next = [...prev];
      const target = next[index];
      if (!target) return prev;
      if (target.id) {
        setRemovedVariantIds((ids) => Array.from(new Set([...ids, target.id!]))); 
      }
      const key = target.id ?? target.tempId ?? String(index);
      setEditVariantDates((prevDates) => {
        const copy = { ...prevDates };
        delete copy[key];
        return copy;
      });
      next.splice(index, 1);
      return next;
    });
  };

  const toggleVariantDate = (variantKey: string, key: string) => {
    setEditVariantDates((prev) => {
      const current = prev[variantKey] ?? [];
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      return { ...prev, [variantKey]: next };
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const payload = { ...editDraft };
      payload.tags = parseTags(editTags);
      const allDates = Object.values(editVariantDates).flat();
      const uniqueDates = Array.from(new Set(allDates));
      payload.saleDates = uniqueDates.map((key) => Timestamp.fromDate(dateFromKey(key)));
      await setDoc(doc(firebaseDb, collectionName, editingId), payload, { merge: true });

      for (const variantId of removedVariantIds) {
        await deleteDoc(doc(firebaseDb, "products", editingId, "variants", variantId));
      }

      for (const variant of editVariants) {
        const key = variant.id ?? variant.tempId ?? "";
        const data = {
          label: variant.label,
          type: variant.type,
          unit: variant.unit,
          price: Number(variant.price || 0),
          activeDates: key ? editVariantDates[key] ?? [] : [],
        };
        if (variant.id) {
          await setDoc(doc(firebaseDb, "products", editingId, "variants", variant.id), data, {
            merge: true,
          });
        } else {
          await addDoc(collection(firebaseDb, "products", editingId, "variants"), data);
        }
      }

      setMessage("Produit mis a jour.");
      setEditingId(null);
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const handleCreate = async () => {
    try {
      const payload = { ...createDraft };
      payload.tags = parseTags(createTags);
      payload.saleDates = activePeriodDates.map((key) => Timestamp.fromDate(dateFromKey(key)));
      await addDoc(collection(firebaseDb, collectionName), payload);
      setCreateDraft({});
      setCreateTags("");
      setCreateOpen(false);
      setMessage("Produit cree.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">{title}</h2>
        {description ? <p className="mt-2 text-sm text-ink/70">{description}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-clay/70 bg-white/80 p-4 shadow-card">
        <input
          className="w-full max-w-sm rounded-full border border-ink/20 bg-white px-4 py-2 text-sm"
          placeholder="Rechercher un produit..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={producerFilter}
          onChange={(event) => setProducerFilter(event.target.value)}
        >
          <option value="all">Tous les producteurs</option>
          {producerOptions.map((producer) => (
            <option key={producer.id} value={producer.id}>
              {producer.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
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
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
          onClick={() => {
            setFilter("");
            setProducerFilter("all");
            setCategoryFilter("all");
          }}
        >
          Reset
        </button>
        <button
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={() => setCreateOpen(true)}
        >
          Nouveau produit
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
          {editingId ? (
            <div className="flex flex-col gap-6 rounded-3xl border border-clay/70 bg-white/90 p-6 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                    Fiche produit
                  </p>
                  <h3 className="font-serif text-3xl">
                    {String(getByPath(editDraft, "name") ?? "")}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    href={`/products/${editingId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Voir le produit
                  </a>
                  <button
                    className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                    onClick={() => setEditingId(null)}
                  >
                    Fermer
                  </button>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
                  <div className="flex flex-col gap-4 rounded-2xl border border-clay/70 bg-stone p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Apercu</p>
                    </div>
                  <p className="text-sm text-ink/70">
                    {String(getByPath(editDraft, "description") ?? "")}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-ink/70">
                    <span className="rounded-full bg-white px-3 py-1">
                      Producteur{" "}
                      {producerOptions.find(
                        (producer) => producer.id === String(getByPath(editDraft, "producerId") ?? ""),
                      )?.label ?? "-"}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1">
                      {String(getByPath(editDraft, "isOrganic") ?? false) === "true" ? "Bio" : "Conventionnel"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {fields.map((field) => (
                    <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                      {field.label}
                      {field.path === "producerId" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(getByPath(editDraft, field.path) ?? "")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                        >
                          <option value="">Selectionner un producteur</option>
                          {producerOptions.map((producer) => (
                            <option key={producer.id} value={producer.id}>
                              {producer.label}
                            </option>
                          ))}
                        </select>
                      ) : field.path === "categoryId" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(getByPath(editDraft, field.path) ?? "")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                        >
                          <option value="">Selectionner une categorie</option>
                          {categoryOptions.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      ) : field.path === "description" ? (
                        <>
                          <textarea
                            className="min-h-[140px] rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                            value={String(toInputValue(getByPath(editDraft, field.path), field.type))}
                            onChange={(event) => {
                              const next = { ...editDraft };
                              setByPath(next, field.path, event.target.value);
                              setEditDraft(next);
                            }}
                          />
                          <span className="text-[11px] font-normal text-ink/50">
                            Mise en forme simple: **gras**, *italique*, listes avec "-".
                          </span>
                        </>
                      ) : field.type === "boolean" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(toInputValue(getByPath(editDraft, field.path), field.type))}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value === "true");
                            setEditDraft(next);
                          }}
                        >
                          <option value="true">Oui</option>
                          <option value="false">Non</option>
                        </select>
                      ) : (
                        <input
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(toInputValue(getByPath(editDraft, field.path), field.type))}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                        />
                      )}
                    </label>
                  ))}
                  <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                    Tags (separes par virgule)
                    <input
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={editTags}
                      onChange={(event) => setEditTags(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink/70">Variantes & dates actives</p>
                  <button
                    className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                    onClick={addVariant}
                  >
                    Ajouter une option
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-clay/70 bg-white">
                  <div
                    className="min-w-[720px] border-b border-clay/70 bg-stone px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `1.4fr 0.6fr repeat(${activePeriodLabels.length || 1}, minmax(80px, 1fr)) 0.6fr`,
                      gap: "12px",
                    }}
                  >
                    <span>Variante</span>
                    <span className="text-[10px] tracking-[0.18em]">Prix</span>
                    {(activePeriodLabels.length ? activePeriodLabels : ["Dates"]).map((label, index) => (
                      <span key={`${label}-${index}`}>{label}</span>
                    ))}
                    <span>Actions</span>
                  </div>
                  <div className="divide-y divide-clay/70">
                    {editVariants.map((variant, index) => {
                      const variantKey = variant.id ?? variant.tempId ?? String(index);
                      const selectedDates = editVariantDates[variantKey] ?? [];
                      return (
                        <div
                          key={variantKey}
                          className="min-w-[720px] px-4 py-2"
                          style={{
                            display: "grid",
                            gridTemplateColumns: `1.4fr 0.6fr repeat(${activePeriodLabels.length || 1}, minmax(80px, 1fr)) 0.6fr`,
                            gap: "12px",
                          }}
                        >
                          <div className="grid gap-2">
                            <input
                              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                              placeholder="Libelle"
                              value={variant.label}
                              onChange={(event) => updateVariant(index, { label: event.target.value })}
                            />
                          </div>
                          <input
                            className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-xs"
                            placeholder="Prix"
                            type="number"
                            min={0}
                            step="0.1"
                            value={String(variant.price ?? 0)}
                            onChange={(event) => updateVariant(index, { price: Number(event.target.value) || 0 })}
                          />
                          {activePeriodDates.length ? (
                            activePeriodDates.map((dateKeyItem) => (
                              <div key={dateKeyItem} className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={selectedDates.includes(dateKeyItem)}
                                  onChange={() => toggleVariantDate(variantKey, dateKeyItem)}
                                />
                              </div>
                            ))
                          ) : (
                            <span className="text-xs text-ink/60">Aucune date</span>
                          )}
                          <button
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => removeVariant(index)}
                          >
                            {variant.id ? "Retirer" : "Supprimer"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
                  onClick={saveEdit}
                >
                  Enregistrer
                </button>
                <button
                  className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                  onClick={() => setEditingId(null)}
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-3xl border border-clay/70 bg-white/90 shadow-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/70 text-[11px] uppercase tracking-[0.2em] text-ink/60">
                <tr>
                  <th className="px-4 py-3">Produit</th>
                  <th className="px-4 py-3">Producteur</th>
                  <th className="px-4 py-3">Categorie</th>
                  <th className="px-4 py-3">Bio</th>
                  <th className="px-4 py-3">Tags</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((entry) => {
                  const producerLabel =
                    producerOptions.find(
                      (producer) => producer.id === String(getByPath(entry.data, "producerId") ?? ""),
                    )?.label ?? "";
                  const categoryId = String(getByPath(entry.data, "categoryId") ?? "");
                  const categoryLabel = categories.find((category) => category.id === categoryId)?.name ?? "";
                  const tags = Array.isArray(getByPath(entry.data, "tags"))
                    ? (getByPath(entry.data, "tags") as string[])
                    : [];
                  const isOrganic = Boolean(getByPath(entry.data, "isOrganic"));
                  return (
                    <tr key={entry.id} className="border-b border-clay/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">
                          {String(getByPath(entry.data, "name") ?? "-")}
                        </p>
                        <p className="text-xs text-ink/60">
                          {String(getByPath(entry.data, "description") ?? "")}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/70">{producerLabel}</td>
                      <td className="px-4 py-3 text-xs text-ink/70">{categoryLabel || "-"}</td>
                      <td className="px-4 py-3 text-xs text-ink/70">
                        {isOrganic ? "Bio" : "Conv."}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 text-[10px] text-ink/60">
                          {tags.length ? tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-clay/70 px-2 py-0.5">
                              {tag}
                            </span>
                          )) : <span>-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink"
                          onClick={() => openEdit(entry)}
                        >
                          Ouvrir la fiche
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-3xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Nouveau produit</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  {field.label}
                  {field.path === "producerId" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(getByPath(createDraft, field.path) ?? "")}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value);
                        setCreateDraft(next);
                      }}
                    >
                      <option value="">Selectionner un producteur</option>
                      {producerOptions.map((producer) => (
                        <option key={producer.id} value={producer.id}>
                          {producer.label}
                        </option>
                      ))}
                    </select>
                  ) : field.path === "categoryId" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(getByPath(createDraft, field.path) ?? "")}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value);
                        setCreateDraft(next);
                      }}
                    >
                      <option value="">Selectionner une categorie</option>
                      {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  ) : field.path === "description" ? (
                    <>
                      <textarea
                        className="min-h-[140px] rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                        onChange={(event) => {
                          const next = { ...createDraft };
                          setByPath(next, field.path, event.target.value);
                          setCreateDraft(next);
                        }}
                      />
                      <span className="text-[11px] font-normal text-ink/50">
                        Mise en forme simple: **gras**, *italique*, listes avec "-".
                      </span>
                    </>
                  ) : field.type === "boolean" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value === "true");
                        setCreateDraft(next);
                      }}
                    >
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  ) : (
                    <input
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value);
                        setCreateDraft(next);
                      }}
                    />
                  )}
                </label>
              ))}
              <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                Tags (separes par virgule)
                <input
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                  value={createTags}
                  onChange={(event) => setCreateTags(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                onClick={handleCreate}
              >
                Creer
              </button>
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setCreateOpen(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
