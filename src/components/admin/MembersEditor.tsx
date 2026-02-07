"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, limit, query, setDoc, Timestamp } from "firebase/firestore";
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

function fromInputValue(value: string, type: FieldType) {
  if (type === "number") return value === "" ? null : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "date" && value) return Timestamp.fromDate(new Date(`${value}T00:00:00`));
  if (type === "datetime" && value) return Timestamp.fromDate(new Date(value));
  return value;
}

function displayValue(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export default function MembersEditor({
  collectionName,
  title,
  description,
  fields,
}: EditorProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [filter, setFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const tableFields = useMemo(() => fields.filter((field) => field.table), [fields]);

  const load = async () => {
    setLoading(true);
    const q = query(collection(firebaseDb, collectionName), limit(50));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    setDocs(items);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

  const openEdit = (entry: DocEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.data);
    setMessage("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await setDoc(doc(firebaseDb, collectionName, editingId), editDraft, { merge: true });
      setMessage("Adherent mis a jour.");
      setEditingId(null);
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const handleCreate = async () => {
    try {
      await addDoc(collection(firebaseDb, collectionName), createDraft);
      setCreateDraft({});
      setCreateOpen(false);
      setMessage("Adherent cree.");
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const filteredDocs = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return docs.filter((entry) => {
      const status = String(getByPath(entry.data, "membershipStatus") ?? "");
      const role = String(getByPath(entry.data, "auth.role") ?? "");
      if (filterStatus !== "all" && status !== filterStatus) return false;
      if (filterRole !== "all" && role !== filterRole) return false;
      if (!term) return true;
      const haystack = [
        entry.id,
        getByPath(entry.data, "firstName"),
        getByPath(entry.data, "lastName"),
        getByPath(entry.data, "email"),
        getByPath(entry.data, "membershipStatus"),
        getByPath(entry.data, "auth.role"),
      ]
        .map((value) => (value ? String(value).toLowerCase() : ""))
        .join(" ");
      return haystack.includes(term);
    });
  }, [docs, filter, filterRole, filterStatus]);

  const sortedDocs = useMemo(() => {
    const items = [...filteredDocs];
    items.sort((a, b) => {
      const aValue = getByPath(a.data, sortKey);
      const bValue = getByPath(b.data, sortKey);
      const aText = aValue instanceof Timestamp ? aValue.toDate().getTime() : String(aValue ?? "");
      const bText = bValue instanceof Timestamp ? bValue.toDate().getTime() : String(bValue ?? "");
      if (aText < bText) return sortDir === "asc" ? -1 : 1;
      if (aText > bText) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return items;
  }, [filteredDocs, sortDir, sortKey]);

  const toggleSort = (path: string) => {
    if (sortKey === path) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(path);
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
          placeholder="Rechercher un adherent..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value)}
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
        </select>
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterRole}
          onChange={(event) => setFilterRole(event.target.value)}
        >
          <option value="all">Tous les roles</option>
          <option value="member">Adherent</option>
          <option value="admin">Admin</option>
        </select>
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
          onClick={() => {
            setFilter("");
            setFilterStatus("all");
            setFilterRole("all");
          }}
        >
          Reset
        </button>
        <button
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={() => setCreateOpen(true)}
        >
          Nouveau
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
                  {tableFields.map((field) => (
                    <th
                      key={field.path}
                      className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-ink"
                      onClick={() => toggleSort(field.path)}
                    >
                      {field.label}
                      {sortKey === field.path ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                  <th className="px-3 py-1.5 text-xs font-semibold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map((entry) => (
                  <tr key={entry.id} className="border-b border-clay/50">
                    {tableFields.map((field) => (
                      <td key={field.path} className="px-3 py-1.5 text-xs text-ink/70">
                        {displayValue(getByPath(entry.data, field.path))}
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      <button
                        className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                        onClick={() => openEdit(entry)}
                      >
                        Editer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Editer adherent</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {fields.map((field) => {
                const value = getByPath(editDraft, field.path);
                const inputValue = toInputValue(value, field.type);
                return (
                  <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                    {field.label}
                    {field.type === "boolean" ? (
                      <select
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={String(inputValue)}
                        onChange={(event) => {
                          const next = { ...editDraft };
                          setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                          setEditDraft(next);
                        }}
                      >
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    ) : field.type === "date" || field.type === "datetime" ? (
                      <input
                        type={field.type === "date" ? "date" : "datetime-local"}
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={String(inputValue)}
                        onChange={(event) => {
                          const next = { ...editDraft };
                          setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                          setEditDraft(next);
                        }}
                      />
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={String(inputValue)}
                        onChange={(event) => {
                          const next = { ...editDraft };
                          setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                          setEditDraft(next);
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            <div className="mt-6 flex items-center gap-3">
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
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Nouvel adherent</h3>
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
        </div>
      ) : null}
    </div>
  );
}
