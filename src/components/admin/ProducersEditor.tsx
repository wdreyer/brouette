"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

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

type Referent = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
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
    return type === "date" ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 16);
  }
  if (value instanceof Date) {
    return type === "date" ? value.toISOString().slice(0, 10) : value.toISOString().slice(0, 16);
  }
  return value === undefined || value === null ? "" : String(value);
}

function fromInputValue(value: string, type: FieldType) {
  if (type === "number") return value === "" ? null : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "date" && value) return Timestamp.fromDate(new Date(`${value}T00:00:00`));
  if (type === "datetime" && value) return Timestamp.fromDate(new Date(value));
  return value;
}

function referentLabel(referent?: Referent | null) {
  if (!referent) return "Sans référent";
  const value = `${referent.firstName ?? ""} ${referent.lastName ?? ""}`.trim();
  return value || "Référent";
}

export default function ProducersEditor({
  collectionName,
  title,
  description,
  fields,
}: EditorProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [referents, setReferents] = useState<Referent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [productCountByProducerId, setProductCountByProducerId] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [filter, setFilter] = useState("");
  const [filterReferent, setFilterReferent] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"name" | "products" | "referent" | "email" | "address">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const load = async () => {
    setLoading(true);
    const [snapshot, referentSnap, productsSnap] = await Promise.all([
      getDocs(query(collection(firebaseDb, collectionName), limit(200))),
      getDocs(query(collection(firebaseDb, "members"), where("auth.role", "==", "referent"))),
      getDocs(collection(firebaseDb, "products")),
    ]);
    const items = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    const referentItems = referentSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Referent, "id">) }))
      .sort((a, b) => referentLabel(a).localeCompare(referentLabel(b)));
    const countsById = new Map<string, number>();
    const countsByName = new Map<string, number>();
    productsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const producerId = String(data.producerId ?? "").trim();
      if (producerId) {
        countsById.set(producerId, (countsById.get(producerId) ?? 0) + 1);
      }
      const producerName = String(data.producerName ?? data.producer ?? "").trim().toLowerCase();
      if (producerName) {
        countsByName.set(producerName, (countsByName.get(producerName) ?? 0) + 1);
      }
    });
    const nextCounts: Record<string, number> = {};
    items.forEach((item) => {
      const producerName = String(getByPath(item.data, "name") ?? "").trim().toLowerCase();
      nextCounts[item.id] = countsById.get(item.id) ?? countsByName.get(producerName) ?? 0;
    });
    setDocs(items);
    setReferents(referentItems);
    setProductCountByProducerId(nextCounts);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

  const handleCreate = async () => {
    try {
      await addDoc(collection(firebaseDb, collectionName), {
        ...createDraft,
      });
      setCreateDraft({});
      setCreateOpen(false);
      setMessage("Producteur cree.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const updateReferent = async (entry: DocEntry, referentId: string) => {
    try {
      setSavingId(entry.id);
      const referent = referents.find((item) => item.id === referentId) ?? null;
      await setDoc(
        doc(firebaseDb, collectionName, entry.id),
        {
          referentId: referent ? referent.id : null,
          referentName: referent ? referentLabel(referent) : null,
          referentPhone: referent?.phone ?? null,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      setDocs((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                data: {
                  ...item.data,
                  referentId: referent ? referent.id : null,
                  referentName: referent ? referentLabel(referent) : null,
                  referentPhone: referent?.phone ?? null,
                },
              }
            : item,
        ),
      );
      setMessage("Référent mis à jour.");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setSavingId(null);
    }
  };

  const sortedDocs = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = docs.filter((entry) => {
      const referentId = String(getByPath(entry.data, "referentId") ?? "");
      if (filterReferent === "none" && referentId) return false;
      if (filterReferent !== "all" && filterReferent !== "none" && referentId !== filterReferent) return false;
      if (!term) return true;
      const haystack = [
        entry.id,
        getByPath(entry.data, "name"),
        getByPath(entry.data, "email"),
        getByPath(entry.data, "referentName"),
        getByPath(entry.data, "address.street"),
        getByPath(entry.data, "address.postalCode"),
        getByPath(entry.data, "address.city"),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(term);
    });

    const next = [...filtered];
    next.sort((a, b) => {
      if (sortKey === "products") {
        const aValue = productCountByProducerId[a.id] ?? 0;
        const bValue = productCountByProducerId[b.id] ?? 0;
        if (aValue < bValue) return sortDir === "asc" ? -1 : 1;
        if (aValue > bValue) return sortDir === "asc" ? 1 : -1;
        return 0;
      }
      const getValue = (entry: DocEntry) => {
        if (sortKey === "name") return String(getByPath(entry.data, "name") ?? "").toLowerCase();
        if (sortKey === "referent") return String(getByPath(entry.data, "referentName") ?? "Sans référent").toLowerCase();
        if (sortKey === "email") return String(getByPath(entry.data, "email") ?? "").toLowerCase();
        return [
          String(getByPath(entry.data, "address.street") ?? ""),
          String(getByPath(entry.data, "address.postalCode") ?? ""),
          String(getByPath(entry.data, "address.city") ?? ""),
        ]
          .join(" ")
          .toLowerCase();
      };
      const aValue = getValue(a);
      const bValue = getValue(b);
      if (aValue < bValue) return sortDir === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return next;
  }, [docs, filter, filterReferent, productCountByProducerId, sortDir, sortKey]);

  const toggleSort = (key: "name" | "products" | "referent" | "email" | "address") => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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
          placeholder="Rechercher un producteur..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterReferent}
          onChange={(event) => setFilterReferent(event.target.value)}
        >
          <option value="all">Tous les référents</option>
          <option value="none">Sans référent</option>
          {referents.map((ref) => (
            <option key={ref.id} value={ref.id}>
              {referentLabel(ref)}
            </option>
          ))}
        </select>
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
          onClick={() => {
            setFilter("");
            setFilterReferent("all");
          }}
        >
          Reset
        </button>
        <button
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={() => setCreateOpen(true)}
        >
          Nouveau producteur
        </button>
      </div>

      <div className="rounded-2xl border border-clay/70 bg-white/80 shadow-card">
        {loading ? (
          <p className="p-6 text-sm text-ink/70">Chargement...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/70 bg-stone/80">
                <tr>
                  <th className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink" onClick={() => toggleSort("name")}>Producteur{sortKey === "name" ? (sortDir === "asc" ? " ^" : " v") : ""}</th>
                  <th className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink" onClick={() => toggleSort("products")}>Produits{sortKey === "products" ? (sortDir === "asc" ? " ^" : " v") : ""}</th>
                  <th className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink" onClick={() => toggleSort("referent")}>Référent{sortKey === "referent" ? (sortDir === "asc" ? " ^" : " v") : ""}</th>
                  <th className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink" onClick={() => toggleSort("email")}>Email{sortKey === "email" ? (sortDir === "asc" ? " ^" : " v") : ""}</th>
                  <th className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink" onClick={() => toggleSort("address")}>Adresse{sortKey === "address" ? (sortDir === "asc" ? " ^" : " v") : ""}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map((entry) => {
                  const referentId = String(getByPath(entry.data, "referentId") ?? "");
                  const hasReferent = Boolean(referentId);
                  return (
                    <tr key={entry.id} className={`border-b border-clay/50 ${hasReferent ? "hover:bg-stone/60" : "bg-ember/5 hover:bg-ember/10"}`}>
                      <td className="px-3 py-2 text-xs text-ink/80">
                        <Link href={`/admin/producers/${entry.id}`} className="font-semibold hover:underline">
                          {String(getByPath(entry.data, "name") ?? "-")}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-ink/80">
                        {productCountByProducerId[entry.id] ?? 0}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            className="min-w-[200px] rounded-md border border-ink/20 bg-white px-2 py-1.5 text-xs"
                            value={referentId}
                            onChange={(event) => updateReferent(entry, event.target.value)}
                            disabled={savingId === entry.id}
                          >
                            <option value="">Sans référent</option>
                            {referents.map((ref) => (
                              <option key={ref.id} value={ref.id}>
                                {referentLabel(ref)}
                              </option>
                            ))}
                          </select>
                          {!referentId ? (
                            <span className="rounded-full border border-ember/25 bg-ember/10 px-2 py-0.5 text-[10px] font-semibold text-ember">
                              Sans référent
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink/70">{String(getByPath(entry.data, "email") ?? "-")}</td>
                      <td className="px-3 py-2 text-xs text-ink/70">
                        {[
                          String(getByPath(entry.data, "address.street") ?? "").trim(),
                          [String(getByPath(entry.data, "address.postalCode") ?? "").trim(), String(getByPath(entry.data, "address.city") ?? "").trim()]
                            .filter(Boolean)
                            .join(" "),
                        ]
                          .filter(Boolean)
                          .join(", ") || "-"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/admin/producers/${entry.id}`} className="rounded-md border border-ink/20 px-3 py-1 text-xs font-semibold text-ink hover:bg-stone">
                          Ouvrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {createOpen ? (
        <div className="rounded-3xl border border-clay/70 bg-white/95 p-6 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-serif text-2xl">Nouveau producteur</h3>
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
              onClick={() => setCreateOpen(false)}
            >
              Fermer
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                {field.label}
                {field.type === "boolean" ? (
                  <select
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                    onChange={(event) => {
                      const next = { ...createDraft };
                      setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                      setCreateDraft(next);
                    }}
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                ) : field.type === "date" || field.type === "datetime" ? (
                  <input
                    type={field.type === "date" ? "date" : "datetime-local"}
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                    onChange={(event) => {
                      const next = { ...createDraft };
                      setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                      setCreateDraft(next);
                    }}
                  />
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                    onChange={(event) => {
                      const next = { ...createDraft };
                      setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                      setCreateDraft(next);
                    }}
                  />
                )}
              </label>
            ))}
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
      ) : null}
    </div>
  );
}
