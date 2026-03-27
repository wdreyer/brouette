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
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseDb, firebaseStorage } from "@/lib/firebase/client";

type FieldType = "text" | "number" | "boolean" | "date" | "datetime";

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

function toInputValue(value: unknown, type: FieldType) {
  if (type === "boolean") return Boolean(value);
  if (type === "number") return value === undefined || value === null ? "" : String(value);
  if (value instanceof Timestamp) {
    const date = value.toDate();
    return type === "date"
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 16);
  }
  if (value instanceof Date) {
    return type === "date" ? value.toISOString().slice(0, 10) : value.toISOString().slice(0, 16);
  }
  return value === undefined || value === null ? "" : String(value);
}

function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function shortText(value: unknown, max = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "-";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseNullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export default function ProductsEditor({
  collectionName,
  title,
  description,
  fields,
}: EditorProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [editTags, setEditTags] = useState("");
  const [editVariants, setEditVariants] = useState<VariantDraft[]>([]);
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [createTags, setCreateTags] = useState("");
  const [filter, setFilter] = useState("");
  const [producerFilter, setProducerFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [saleFilter, setSaleFilter] = useState<"all" | "on_sale">("all");
  const [organicFilter, setOrganicFilter] = useState<"all" | "bio" | "conv">("all");
  const [sortBy, setSortBy] = useState<"name" | "producer" | "category">("name");
  const [openSaleProductIds, setOpenSaleProductIds] = useState<string[]>([]);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [uploadingEditImage, setUploadingEditImage] = useState(false);
  const [uploadingCreateImage, setUploadingCreateImage] = useState(false);

  const cardFields = useMemo(() => fields.filter((field) => field.table), [fields]);

  const load = async () => {
    setLoading(true);
    const [productsSnap, producersSnap, categoriesSnap, openDistSnap] = await Promise.all([
      getDocs(collection(firebaseDb, collectionName)),
      getDocs(collection(firebaseDb, "producers")),
      getDocs(collection(firebaseDb, "categories")),
      getDocs(query(collection(firebaseDb, "distributionDates"), where("status", "==", "open"), limit(1))),
    ]);
    const items = productsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    setDocs(items);
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
    if (!openDistSnap.empty) {
      const openDistId = openDistSnap.docs[0].id;
      const offerSnap = await getDocs(collection(firebaseDb, "distributionDates", openDistId, "offerItems"));
      const productIds = Array.from(
        new Set(
          offerSnap.docs
            .map((docSnap) => String((docSnap.data() as { productId?: string }).productId ?? ""))
            .filter(Boolean),
        ),
      );
      setOpenSaleProductIds(productIds);
    } else {
      setOpenSaleProductIds([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

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

  const producerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    producerOptions.forEach((producer) => {
      map.set(producer.id, producer.label);
    });
    return map;
  }, [producerOptions]);

  const categoryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    categoryOptions.forEach((category) => {
      map.set(category.id, category.label);
    });
    return map;
  }, [categoryOptions]);

  const openSaleProductIdSet = useMemo(() => new Set(openSaleProductIds), [openSaleProductIds]);

  const docsMeta = useMemo(
    () =>
      docs.map((entry) => {
        const producerId = String(getByPath(entry.data, "producerId") ?? "");
        const categoryId = String(getByPath(entry.data, "categoryId") ?? "");
        const name = String(getByPath(entry.data, "name") ?? "");
        const producerLabel = producerLabelById.get(producerId) ?? producerId;
        const categoryLabel = categoryLabelById.get(categoryId) ?? categoryId;
        const isOrganic = Boolean(getByPath(entry.data, "isOrganic"));
        const isOnSale = openSaleProductIdSet.has(entry.id);
        const searchable = [
          entry.id,
          name,
          producerLabel,
          categoryLabel,
          String(getByPath(entry.data, "description") ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return {
          entry,
          producerId,
          categoryId,
          name,
          producerLabel,
          categoryLabel,
          isOrganic,
          isOnSale,
          searchable,
        };
      }),
    [docs, producerLabelById, categoryLabelById, openSaleProductIdSet],
  );

  const onSaleDocsCount = useMemo(
    () => docsMeta.filter((item) => item.isOnSale).length,
    [docsMeta],
  );

  const filteredDocs = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = docsMeta.filter((item) => {
      if (producerFilter !== "all" && item.producerId !== producerFilter) return false;
      if (categoryFilter !== "all") {
        if (item.categoryId !== categoryFilter) return false;
      }
      if (saleFilter === "on_sale" && !item.isOnSale) return false;
      if (organicFilter === "bio" && !item.isOrganic) return false;
      if (organicFilter === "conv" && item.isOrganic) return false;
      if (!term) return true;
      return item.searchable.includes(term);
    });
    filtered.sort((a, b) => {
      if (sortBy === "producer") {
        const byProducer = a.producerLabel.localeCompare(b.producerLabel, "fr");
        if (byProducer !== 0) return byProducer;
      }
      if (sortBy === "category") {
        const byCategory = a.categoryLabel.localeCompare(b.categoryLabel, "fr");
        if (byCategory !== 0) return byCategory;
      }
      return a.name.localeCompare(b.name, "fr");
    });
    return filtered.map((item) => item.entry);
  }, [docsMeta, filter, producerFilter, categoryFilter, saleFilter, organicFilter, sortBy]);

  const producerCounts = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const counts = new Map<string, number>();
    docsMeta.forEach((item) => {
      if (categoryFilter !== "all" && item.categoryId !== categoryFilter) return;
      if (saleFilter === "on_sale" && !item.isOnSale) return;
      if (organicFilter === "bio" && !item.isOrganic) return;
      if (organicFilter === "conv" && item.isOrganic) return;
      if (term && !item.searchable.includes(term)) return;
      counts.set(item.producerId, (counts.get(item.producerId) ?? 0) + 1);
    });
    return counts;
  }, [docsMeta, filter, categoryFilter, saleFilter, organicFilter]);

  const categoryCounts = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const counts = new Map<string, number>();
    docsMeta.forEach((item) => {
      if (producerFilter !== "all" && item.producerId !== producerFilter) return;
      if (saleFilter === "on_sale" && !item.isOnSale) return;
      if (organicFilter === "bio" && !item.isOrganic) return;
      if (organicFilter === "conv" && item.isOrganic) return;
      if (term && !item.searchable.includes(term)) return;
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    });
    return counts;
  }, [docsMeta, filter, producerFilter, saleFilter, organicFilter]);

  const producerTotalInScope = useMemo(
    () => Array.from(producerCounts.values()).reduce((sum, value) => sum + value, 0),
    [producerCounts],
  );
  const categoryTotalInScope = useMemo(
    () => Array.from(categoryCounts.values()).reduce((sum, value) => sum + value, 0),
    [categoryCounts],
  );

  const openEdit = async (entry: DocEntry) => {
    setEditingId(entry.id);
    setEditDraft({
      ...entry.data,
      isSoldByWeight: Boolean(entry.data.isSoldByWeight),
      estimatedPriceMin: parseNullableNumber(entry.data.estimatedPriceMin),
      estimatedPriceMax: parseNullableNumber(entry.data.estimatedPriceMax),
    });
    const tags = (entry.data.tags as string[] | undefined) ?? [];
    setEditTags(tags.join(", "));

    const variantSnap = await getDocs(
      query(collection(firebaseDb, "products", entry.id, "variants"), limit(50)),
    );
    const variantItems = variantSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<VariantDraft, "id">),
    }));
    const variants: VariantDraft[] = variantItems.map((variant) => ({
      id: variant.id,
      label: variant.label ?? "",
      type: variant.type ?? "",
      unit: variant.unit ?? "",
      price: Number(variant.price ?? 0),
    }));
    setEditVariants(variants);
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
      next.splice(index, 1);
      return next;
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const payload = { ...editDraft };
      payload.tags = parseTags(editTags);
      const isSoldByWeight = Boolean(payload.isSoldByWeight);
      payload.isSoldByWeight = isSoldByWeight;
      payload.estimatedPriceMin = isSoldByWeight
        ? parseNullableNumber(payload.estimatedPriceMin)
        : null;
      payload.estimatedPriceMax = isSoldByWeight
        ? parseNullableNumber(payload.estimatedPriceMax)
        : null;
      await setDoc(doc(firebaseDb, collectionName, editingId), payload, { merge: true });

      for (const variantId of removedVariantIds) {
        await deleteDoc(doc(firebaseDb, "products", editingId, "variants", variantId));
      }

      for (const variant of editVariants) {
        const data = {
          label: variant.label,
          type: variant.type,
          unit: variant.unit,
          price: Number(variant.price || 0),
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

  const uploadImage = async (
    file: File,
    mode: "edit" | "create",
    productId?: string,
  ) => {
    if (!file) return;
    try {
      setMessage("");
      if (mode === "edit") setUploadingEditImage(true);
      if (mode === "create") setUploadingCreateImage(true);

      const ownerId = productId || `draft_${Date.now()}`;
      const path = `products/${ownerId}/${Date.now()}_${safeFileName(file.name)}`;
      const storageRef = ref(firebaseStorage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      if (mode === "edit") {
        const next = { ...editDraft };
        setByPath(next, "imageUrl", url);
        setEditDraft(next);
      } else {
        const next = { ...createDraft };
        setByPath(next, "imageUrl", url);
        setCreateDraft(next);
      }
      setMessage("Image uploadee.");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(`Upload image impossible: ${err}`);
    } finally {
      if (mode === "edit") setUploadingEditImage(false);
      if (mode === "create") setUploadingCreateImage(false);
    }
  };

  const handleCreate = async () => {
    try {
      const payload = { ...createDraft };
      payload.tags = parseTags(createTags);
      const isSoldByWeight = Boolean(payload.isSoldByWeight);
      payload.isSoldByWeight = isSoldByWeight;
      payload.estimatedPriceMin = isSoldByWeight
        ? parseNullableNumber(payload.estimatedPriceMin)
        : null;
      payload.estimatedPriceMax = isSoldByWeight
        ? parseNullableNumber(payload.estimatedPriceMax)
        : null;
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

  const deleteProduct = async (entry: DocEntry) => {
    const name = String(getByPath(entry.data, "name") ?? "ce produit");
    const confirmDelete =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Supprimer "${name}" ? Cette action supprime aussi ses variantes et ses offres de distribution.`,
          );
    if (!confirmDelete) return;

    try {
      setDeletingProductId(entry.id);
      setMessage("");

      const [variantsSnap, distributionsSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "products", entry.id, "variants")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      const deleteTasks: Promise<unknown>[] = [];
      variantsSnap.docs.forEach((variantDoc) => {
        deleteTasks.push(deleteDoc(variantDoc.ref));
      });

      for (const distDoc of distributionsSnap.docs) {
        const offerSnap = await getDocs(
          query(
            collection(firebaseDb, "distributionDates", distDoc.id, "offerItems"),
            where("productId", "==", entry.id),
          ),
        );
        offerSnap.docs.forEach((offerDoc) => {
          deleteTasks.push(deleteDoc(offerDoc.ref));
        });
      }

      if (deleteTasks.length) {
        await Promise.all(deleteTasks);
      }

      await deleteDoc(doc(firebaseDb, collectionName, entry.id));
      if (editingId === entry.id) {
        setEditingId(null);
      }
      setMessage("Produit supprimé.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setDeletingProductId(null);
    }
  };

  const updateRowCategory = async (productId: string, categoryId: string) => {
    try {
      setSavingCategoryId(productId);
      await setDoc(
        doc(firebaseDb, collectionName, productId),
        {
          categoryId: categoryId || null,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      setDocs((prev) =>
        prev.map((entry) =>
          entry.id === productId
            ? { ...entry, data: { ...entry.data, categoryId: categoryId || null } }
            : entry,
        ),
      );
      setMessage("Catégorie mise à jour.");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setSavingCategoryId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-clay/70 bg-white/80 p-6 shadow-card">
        <h2 className="font-serif text-2xl">{title}</h2>
        {description ? <p className="mt-2 text-sm text-ink/70">{description}</p> : null}
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/80 p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-moss/15 px-3 py-1 font-semibold text-moss">
              {filteredDocs.length} trouves
            </span>
            <span className="text-ink/65">sur {docs.length} produits</span>
          </div>
          <button
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
            onClick={() => {
              setCreateDraft({
                isOrganic: false,
                isSoldByWeight: false,
                estimatedPriceMin: null,
                estimatedPriceMax: null,
              });
              setCreateTags("");
              setCreateOpen(true);
            }}
          >
            Nouveau produit
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-full min-w-[220px] flex-1 rounded-full border border-ink/20 bg-white px-4 py-2 text-sm"
            placeholder="Rechercher: nom, producteur, categorie..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <select
            className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
            value={producerFilter}
            onChange={(event) => setProducerFilter(event.target.value)}
          >
            <option value="all">Tous les producteurs ({producerTotalInScope})</option>
            {producerOptions.map((producer) => (
              <option key={producer.id} value={producer.id}>
                {producer.label} ({producerCounts.get(producer.id) ?? 0})
              </option>
            ))}
          </select>
          <select
            className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">Toutes les categories ({categoryTotalInScope})</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label} ({categoryCounts.get(category.id) ?? 0})
              </option>
            ))}
          </select>
          <select
            className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
            value={organicFilter}
            onChange={(event) => setOrganicFilter(event.target.value as "all" | "bio" | "conv")}
          >
            <option value="all">Tous (Bio + Conv.)</option>
            <option value="bio">Bio uniquement</option>
            <option value="conv">Conventionnel</option>
          </select>
          <select
            className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
            value={saleFilter}
            onChange={(event) => setSaleFilter(event.target.value as "all" | "on_sale")}
          >
            <option value="all">Tous les produits</option>
            <option value="on_sale">Produits en vente actuellement ({onSaleDocsCount})</option>
          </select>
          <select
            className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as "name" | "producer" | "category")}
          >
            <option value="name">Tri: Nom</option>
            <option value="producer">Tri: Producteur</option>
            <option value="category">Tri: Catégorie</option>
          </select>
          <button
            className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
            onClick={() => {
              setFilter("");
              setProducerFilter("all");
              setCategoryFilter("all");
              setSaleFilter("all");
              setOrganicFilter("all");
              setSortBy("name");
            }}
          >
            Reinitialiser
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
          {editingId ? (
            <div className="fixed inset-0 z-50 bg-ink/40" onClick={() => setEditingId(null)}>
              <aside
                className="absolute inset-y-0 right-0 w-full max-w-[1040px] overflow-x-hidden overflow-y-auto border-l border-clay/70 bg-white p-6 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
              <div className="flex flex-col gap-6">
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
                  <div className="overflow-hidden rounded-xl border border-clay/70 bg-white">
                    {String(getByPath(editDraft, "imageUrl") ?? "") ? (
                      <img
                        src={String(getByPath(editDraft, "imageUrl") ?? "")}
                        alt={String(getByPath(editDraft, "name") ?? "Produit")}
                        className="h-44 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-44 items-center justify-center text-xs text-ink/50">
                        Aucune image
                      </div>
                    )}
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
                    {Boolean(getByPath(editDraft, "isSoldByWeight")) ? (
                      <span className="rounded-full bg-white px-3 py-1 text-ink/85">
                        Produit au poids
                      </span>
                    ) : null}
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
                      {field.path === "imageUrl" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center rounded-xl border border-ink/20 bg-white px-3 py-2 text-xs font-semibold text-ink">
                            {uploadingEditImage ? "Upload..." : "Uploader un fichier"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingEditImage}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  uploadImage(file, "edit", editingId ?? undefined);
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {String(getByPath(editDraft, "imageUrl") ?? "") ? (
                            <a
                              href={String(getByPath(editDraft, "imageUrl") ?? "")}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold text-ink/70 underline"
                            >
                              Ouvrir l'image
                            </a>
                          ) : null}
                        </div>
                      ) : null}
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
                  <div className="md:col-span-2 rounded-xl border border-clay/70 bg-stone/40 p-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={Boolean(getByPath(editDraft, "isSoldByWeight"))}
                        onChange={(event) => {
                          const next = { ...editDraft };
                          setByPath(next, "isSoldByWeight", event.target.checked);
                          if (!event.target.checked) {
                            setByPath(next, "estimatedPriceMin", null);
                            setByPath(next, "estimatedPriceMax", null);
                          }
                          setEditDraft(next);
                        }}
                      />
                      Produit au poids (prix final apres pesee)
                    </label>
                    {Boolean(getByPath(editDraft, "isSoldByWeight")) ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                          Prix estime min
                          <input
                            className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(toInputValue(getByPath(editDraft, "estimatedPriceMin"), "number"))}
                            onChange={(event) => {
                              const next = { ...editDraft };
                              setByPath(next, "estimatedPriceMin", event.target.value);
                              setEditDraft(next);
                            }}
                            placeholder="Ex: 12.00"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                          Prix estime max
                          <input
                            className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(toInputValue(getByPath(editDraft, "estimatedPriceMax"), "number"))}
                            onChange={(event) => {
                              const next = { ...editDraft };
                              setByPath(next, "estimatedPriceMax", event.target.value);
                              setEditDraft(next);
                            }}
                            placeholder="Ex: 18.00"
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink/70">Variantes</p>
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
                      gridTemplateColumns: "1.8fr 0.8fr 0.6fr",
                      gap: "12px",
                    }}
                  >
                    <span>Variante</span>
                    <span className="text-[10px] tracking-[0.18em]">Prix</span>
                    <span>Actions</span>
                  </div>
                  <div className="divide-y divide-clay/70">
                    {editVariants.map((variant, index) => {
                      const variantKey = variant.id ?? variant.tempId ?? String(index);
                      return (
                        <div
                          key={variantKey}
                          className="min-w-[720px] px-4 py-2"
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.8fr 0.8fr 0.6fr",
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
              </aside>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-3xl border border-clay/70 bg-white/90 shadow-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/70 text-[11px] uppercase tracking-[0.2em] text-ink/60">
                <tr>
                  <th className="px-4 py-3">Produit</th>
                  <th className="px-4 py-3">Producteur</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3">Bio</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink/60">
                      Aucun produit pour ces filtres.
                    </td>
                  </tr>
                ) : (
                  filteredDocs.map((entry) => {
                  const producerLabel =
                    producerOptions.find(
                      (producer) => producer.id === String(getByPath(entry.data, "producerId") ?? ""),
                    )?.label ?? "";
                  const categoryId = String(getByPath(entry.data, "categoryId") ?? "");
                  const categoryLabel = categories.find((category) => category.id === categoryId)?.name ?? "";
                  const isOrganic = Boolean(getByPath(entry.data, "isOrganic"));
                  return (
                    <tr
                      key={entry.id}
                      className="cursor-pointer border-b border-clay/60 hover:bg-stone/50"
                      onClick={() => openEdit(entry)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-clay/60 bg-stone">
                            {String(getByPath(entry.data, "imageUrl") ?? "") ? (
                              <img
                                src={String(getByPath(entry.data, "imageUrl") ?? "")}
                                alt={String(getByPath(entry.data, "name") ?? "Produit")}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-ink/45">
                                No img
                              </div>
                            )}
                          </div>
                          <p className="font-semibold text-ink">
                            {String(getByPath(entry.data, "name") ?? "-")}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/70">{producerLabel}</td>
                      <td className="px-4 py-3 text-xs text-ink/70">
                        <select
                          className="min-w-[170px] rounded-md border border-ink/20 bg-white px-2 py-1.5 text-xs"
                          value={categoryId}
                          disabled={savingCategoryId === entry.id}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            event.stopPropagation();
                            updateRowCategory(entry.id, event.target.value);
                          }}
                        >
                          <option value="">{categoryLabel ? "Sans categorie" : "Selectionner"}</option>
                          {categoryOptions.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/70">
                        {isOrganic ? "Bio" : "Conv."}
                      </td>
                      <td className="max-w-[360px] px-4 py-3 text-xs text-ink/60" title={String(getByPath(entry.data, "description") ?? "")}>
                        <span className="block truncate">{shortText(getByPath(entry.data, "description"))}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            title="Ouvrir la fiche"
                            aria-label="Ouvrir la fiche"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 text-ink transition hover:border-forest/60 hover:text-forest"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(entry);
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4"
                            >
                              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Supprimer"
                            aria-label="Supprimer"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ember/35 text-ember transition hover:bg-ember/10 disabled:opacity-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteProduct(entry).catch(() => undefined);
                            }}
                            disabled={deletingProductId === entry.id}
                          >
                            {deletingProductId === entry.id ? (
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4 animate-spin"
                              >
                                <path d="M21 12a9 9 0 1 1-4.2-7.6" />
                              </svg>
                            ) : (
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                  })
                )}
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
                  {field.path === "imageUrl" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center rounded-xl border border-ink/20 bg-white px-3 py-2 text-xs font-semibold text-ink">
                        {uploadingCreateImage ? "Upload..." : "Uploader un fichier"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingCreateImage}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              uploadImage(file, "create");
                            }
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      {String(getByPath(createDraft, "imageUrl") ?? "") ? (
                        <a
                          href={String(getByPath(createDraft, "imageUrl") ?? "")}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-ink/70 underline"
                        >
                          Ouvrir l'image
                        </a>
                      ) : null}
                    </div>
                  ) : null}
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
              <div className="md:col-span-2 rounded-xl border border-clay/70 bg-stone/40 p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={Boolean(getByPath(createDraft, "isSoldByWeight"))}
                    onChange={(event) => {
                      const next = { ...createDraft };
                      setByPath(next, "isSoldByWeight", event.target.checked);
                      if (!event.target.checked) {
                        setByPath(next, "estimatedPriceMin", null);
                        setByPath(next, "estimatedPriceMax", null);
                      }
                      setCreateDraft(next);
                    }}
                  />
                  Produit au poids (prix final apres pesee)
                </label>
                {Boolean(getByPath(createDraft, "isSoldByWeight")) ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                      Prix estime min
                      <input
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(toInputValue(getByPath(createDraft, "estimatedPriceMin"), "number"))}
                        onChange={(event) => {
                          const next = { ...createDraft };
                          setByPath(next, "estimatedPriceMin", event.target.value);
                          setCreateDraft(next);
                        }}
                        placeholder="Ex: 12.00"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">
                      Prix estime max
                      <input
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(toInputValue(getByPath(createDraft, "estimatedPriceMax"), "number"))}
                        onChange={(event) => {
                          const next = { ...createDraft };
                          setByPath(next, "estimatedPriceMax", event.target.value);
                          setCreateDraft(next);
                        }}
                        placeholder="Ex: 18.00"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
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
