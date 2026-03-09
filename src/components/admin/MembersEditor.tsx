"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";

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
  referentId?: string | null;
  referentName?: string | null;
  referentPhone?: string | null;
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

function formatMembershipStatus(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "active" || normalized === "adherent") return "Actif";
  if (normalized === "inactive" || normalized === "non-adherent" || normalized === "non") return "Non";
  return displayValue(value);
}

function formatRole(value: unknown) {
  if (value === "admin") return "Admin";
  if (value === "referent") return "Referent";
  if (value === "member") return "Membre";
  return displayValue(value);
}

export default function MembersEditor({
  collectionName,
  title,
  description,
  fields,
}: EditorProps) {
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "referent";
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [viewingEntry, setViewingEntry] = useState<DocEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [selectedProducerIds, setSelectedProducerIds] = useState<string[]>([]);
  const [producerSearch, setProducerSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const tableFields = useMemo(() => fields.filter((field) => field.table), [fields]);

  const load = async () => {
    setLoading(true);
    const [membersSnap, producersSnap] = await Promise.all([
      getDocs(query(collection(firebaseDb, collectionName), limit(50))),
      getDocs(collection(firebaseDb, "producers")),
    ]);
    const items = membersSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() as Record<string, unknown>,
    }));
    const producerItems = producersSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Producer, "id">),
    }));
    setDocs(items);
    setProducers(producerItems);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [collectionName]);

  const openView = (entry: DocEntry) => {
    setViewingEntry(entry);
    setMessage("");
  };

  const openEdit = (entry: DocEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.data);
    setMessage("");
    setProducerSearch("");
    const assigned = producers
      .filter((producer) => producer.referentId === entry.id)
      .map((producer) => producer.id);
    setSelectedProducerIds(assigned);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await setDoc(doc(firebaseDb, collectionName, editingId), editDraft, { merge: true });
      const roleValue = String(getByPath(editDraft, "auth.role") ?? "member");
      const firstName = String(getByPath(editDraft, "firstName") ?? "");
      const lastName = String(getByPath(editDraft, "lastName") ?? "");
      const phone = String(getByPath(editDraft, "phone") ?? "");
      const referentName = `${firstName} ${lastName}`.trim();
      const batch = writeBatch(firebaseDb);

      if (roleValue === "referent") {
        producers.forEach((producer) => {
          const isSelected = selectedProducerIds.includes(producer.id);
          const isCurrent = producer.referentId === editingId;
          if (isSelected || isCurrent) {
            batch.set(
              doc(firebaseDb, "producers", producer.id),
              isSelected
                ? {
                    referentId: editingId,
                    referentName: referentName || null,
                    referentPhone: phone || null,
                  }
                : {
                    referentId: null,
                    referentName: null,
                    referentPhone: null,
                  },
              { merge: true },
            );
          }
        });
      } else {
        producers.forEach((producer) => {
          if (producer.referentId === editingId) {
            batch.set(
              doc(firebaseDb, "producers", producer.id),
              { referentId: null, referentName: null, referentPhone: null },
              { merge: true },
            );
          }
        });
      }
      await batch.commit();
      setMessage("Adherent mis a jour.");
      setEditingId(null);
      setViewingEntry(null);
      setSelectedProducerIds([]);
      setProducerSearch("");
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
          <option value="inactive">Non</option>
        </select>
        <select
          className="rounded-full border border-ink/20 bg-white px-3 py-2 text-sm"
          value={filterRole}
          onChange={(event) => setFilterRole(event.target.value)}
        >
          <option value="all">Tous les roles</option>
          <option value="member">Membre</option>
          <option value="referent">Referent</option>
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
                  <th className="px-3 py-1.5 text-xs font-semibold text-ink">Producteurs</th>
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="cursor-pointer border-b border-clay/50 hover:bg-stone/60"
                    onClick={() => openView(entry)}
                  >
                    {tableFields.map((field) => (
                      <td key={field.path} className="px-3 py-1.5 text-xs text-ink/70">
                        {field.path === "membershipStatus"
                          ? formatMembershipStatus(getByPath(entry.data, field.path))
                          : field.path === "auth.role"
                            ? formatRole(getByPath(entry.data, field.path))
                            : displayValue(getByPath(entry.data, field.path))}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-xs text-ink/70">
                      {producers.filter((producer) => producer.referentId === entry.id).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {viewingEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Fiche adherent</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Nom</p>
                <p className="text-sm text-ink">
                  {`${String(getByPath(viewingEntry.data, "firstName") ?? "")} ${String(
                    getByPath(viewingEntry.data, "lastName") ?? "",
                  )}`.trim() || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Email</p>
                <p className="text-sm text-ink">{String(getByPath(viewingEntry.data, "email") ?? "-")}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Telephone</p>
                <p className="text-sm text-ink">{String(getByPath(viewingEntry.data, "phone") ?? "-")}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adhesion</p>
                <p className="text-sm text-ink">
                  {formatMembershipStatus(getByPath(viewingEntry.data, "membershipStatus"))}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Role</p>
                <p className="text-sm text-ink">
                  {formatRole(getByPath(viewingEntry.data, "auth.role") ?? "member")}
                </p>
              </div>
            </div>

            {String(getByPath(viewingEntry.data, "auth.role") ?? "") === "referent" ? (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                  Producteurs
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink/70">
                  {producers
                    .filter((producer) => producer.referentId === viewingEntry.id)
                    .map((producer) => (
                      <a
                        key={producer.id}
                        href={`/admin/producers/${producer.id}`}
                        className="rounded-full border border-ink/15 px-3 py-1"
                      >
                        {producer.name ?? "Producteur"}
                      </a>
                    ))}
                  {!producers.some((producer) => producer.referentId === viewingEntry.id) ? (
                    <span className="text-xs text-ink/60">Aucun producteur attribue.</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-3">
              {isAdmin ? (
                <button
                  className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white"
                  onClick={() => {
                    setViewingEntry(null);
                    openEdit(viewingEntry);
                  }}
                >
                  Editer
                </button>
              ) : null}
              <button
                className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                onClick={() => setViewingEntry(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[88vh] w-full max-w-6xl flex-col rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Editer adherent</h3>
            <div className="mt-4 grid flex-1 gap-6 overflow-y-auto pr-1 xl:grid-cols-[1.1fr_1fr]">
              <div className="grid gap-4 md:grid-cols-2">
                {fields.map((field) => {
                  const value = getByPath(editDraft, field.path);
                  const inputValue = toInputValue(value, field.type);
                  return (
                    <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                      {field.label}
                      {field.path === "auth.role" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue || "member")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                        >
                          <option value="member">Membre</option>
                          <option value="referent">Referent</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : field.path === "membershipStatus" ? (
                        <select
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={String(inputValue || "active")}
                          onChange={(event) => {
                            const next = { ...editDraft };
                            setByPath(next, field.path, event.target.value);
                            setEditDraft(next);
                          }}
                        >
                          <option value="active">Actif</option>
                          <option value="inactive">Non</option>
                        </select>
                      ) : field.type === "boolean" ? (
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

              {String(getByPath(editDraft, "auth.role") ?? "") === "referent" ? (
                <div className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-stone/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                    Producteurs geres
                  </p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-ink/70">
                        Attribues ({selectedProducerIds.length})
                      </p>
                      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-ink/10 bg-white">
                        {producers
                          .filter((producer) => selectedProducerIds.includes(producer.id))
                          .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
                          .map((producer) => (
                            <div
                              key={producer.id}
                              className="flex items-center justify-between border-b border-ink/5 px-3 py-2 text-xs"
                            >
                              <a
                                href={`/admin/producers/${producer.id}`}
                                className="truncate text-ink/80 hover:underline"
                              >
                                {producer.name ?? "Producteur"}
                              </a>
                              <button
                                className="ml-3 rounded-md border border-ink/20 px-2 py-1 text-[11px] font-semibold text-ink/70 hover:bg-stone"
                                onClick={() =>
                                  setSelectedProducerIds((prev) =>
                                    prev.filter((id) => id !== producer.id),
                                  )
                                }
                              >
                                Supprimer
                              </button>
                            </div>
                          ))}
                        {!selectedProducerIds.length ? (
                          <p className="px-3 py-2 text-xs text-ink/50">Aucun producteur attribue.</p>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                        Ajouter un producteur
                        <input
                          className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm normal-case"
                          placeholder="Rechercher..."
                          value={producerSearch}
                          onChange={(event) => setProducerSearch(event.target.value)}
                        />
                      </label>
                      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-ink/10 bg-white">
                        {producers
                          .filter((producer) => !selectedProducerIds.includes(producer.id))
                          .filter((producer) =>
                            producerSearch
                              ? String(producer.name ?? "")
                                  .toLowerCase()
                                  .includes(producerSearch.toLowerCase())
                              : true,
                          )
                          .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
                          .map((producer) => (
                            <button
                              key={producer.id}
                              className="flex w-full items-center justify-between border-b border-ink/5 px-3 py-2 text-left text-xs text-ink/70 hover:bg-stone/60"
                              onClick={() =>
                                setSelectedProducerIds((prev) =>
                                  prev.includes(producer.id) ? prev : [...prev, producer.id],
                                )
                              }
                            >
                              <span className="truncate">{producer.name ?? "Producteur"}</span>
                              <span className="text-[11px] font-semibold text-ink/55">Ajouter</span>
                            </button>
                          ))}
                        {!producers.filter((producer) => !selectedProducerIds.includes(producer.id)).length ? (
                          <p className="px-3 py-2 text-xs text-ink/50">Tout est deja attribue.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex items-center gap-3 border-t border-ink/10 pt-4">
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
                  {field.path === "auth.role" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(toInputValue(getByPath(createDraft, field.path), field.type) || "member")}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value);
                        setCreateDraft(next);
                      }}
                    >
                      <option value="member">Membre</option>
                      <option value="referent">Referent</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : field.path === "membershipStatus" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(toInputValue(getByPath(createDraft, field.path), field.type) || "active")}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, event.target.value);
                        setCreateDraft(next);
                      }}
                    >
                      <option value="active">Actif</option>
                      <option value="inactive">Non</option>
                    </select>
                  ) : field.type === "boolean" ? (
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
