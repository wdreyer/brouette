"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, limit, query, setDoc, Timestamp } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel } from "@/lib/distributions";

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

export default function CollectionEditor({
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
  const [distributionOptions, setDistributionOptions] = useState<{ id: string; label: string }[]>([]);

  const tableFields = useMemo(() => fields.filter((field) => field.table), [fields]);
  const hasDistributionField = useMemo(
    () => fields.some((field) => field.path === "distributionId"),
    [fields],
  );

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

  useEffect(() => {
    if (!hasDistributionField) return;
    const loadDistributions = async () => {
      const snapshot = await getDocs(collection(firebaseDb, "distributionDates"));
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        label: distributionLabel({
          id: docSnap.id,
          dates: (docSnap.data() as { dates?: { toDate?: () => Date }[] }).dates,
        }),
      }));
      setDistributionOptions(items);
    };
    loadDistributions().catch(() => setDistributionOptions([]));
  }, [hasDistributionField]);

  const openEdit = (entry: DocEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.data);
    setMessage("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await setDoc(doc(firebaseDb, collectionName, editingId), editDraft, { merge: true });
      setMessage("Document mis a jour.");
      setEditingId(null);
      await load();
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    }
  };

  const saveRow = async (entry: DocEntry, rowDraft: Record<string, unknown>) => {
    try {
      await setDoc(doc(firebaseDb, collectionName, entry.id), rowDraft, { merge: true });
      setMessage("Ligne mise a jour.");
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
      setMessage("Document cree.");
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
          onClick={() => setCreateOpen(true)}
        >
          Nouveau document
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
                    <th key={field.path} className="px-4 py-3 font-semibold text-ink">
                      {field.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((entry) => {
                  const rowDraft: Record<string, unknown> = {};
                  return (
                    <tr key={entry.id} className="border-b border-clay/50">
                    {tableFields.map((field) => {
                      const value = getByPath(entry.data, field.path);
                        const inputValue = toInputValue(value, field.type);
                        const fieldId = `${entry.id}-${field.path}`;
                        return (
                          <td key={field.path} className="px-4 py-3">
                            {field.path === "distributionId" ? (
                              <select
                                id={fieldId}
                                className="w-48 rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                                defaultValue={String(inputValue)}
                                onChange={(event) =>
                                  setByPath(rowDraft, field.path, fromInputValue(event.target.value, field.type))
                                }
                              >
                                <option value="">Distribution</option>
                                {distributionOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : field.type === "boolean" ? (
                              <select
                                id={fieldId}
                                className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                                defaultValue={String(inputValue)}
                                onChange={(event) =>
                                  setByPath(rowDraft, field.path, fromInputValue(event.target.value, field.type))
                                }
                              >
                                <option value="true">Oui</option>
                                <option value="false">Non</option>
                              </select>
                            ) : field.type === "date" || field.type === "datetime" ? (
                              <input
                                id={fieldId}
                                type={field.type === "date" ? "date" : "datetime-local"}
                                className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                                defaultValue={String(inputValue)}
                                onChange={(event) =>
                                  setByPath(rowDraft, field.path, fromInputValue(event.target.value, field.type))
                                }
                              />
                            ) : (
                              <input
                                id={fieldId}
                                type={field.type === "number" ? "number" : "text"}
                                className="w-44 rounded-full border border-ink/20 bg-white px-3 py-2 text-xs"
                                defaultValue={String(inputValue)}
                                onChange={(event) =>
                                  setByPath(rowDraft, field.path, fromInputValue(event.target.value, field.type))
                                }
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => saveRow(entry, rowDraft)}
                          >
                            Enregistrer
                          </button>
                          <button
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => openEdit(entry)}
                          >
                            Details
                          </button>
                        </div>
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

      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-3xl border border-clay/70 bg-white p-6 shadow-card">
            <h3 className="font-serif text-2xl">Modifier</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {fields.map((field) => {
                const value = getByPath(editDraft, field.path);
                const inputValue = toInputValue(value, field.type);
                return (
                  <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                    {field.label}
                    {field.path === "distributionId" ? (
                      <select
                        className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={String(inputValue)}
                        onChange={(event) => {
                          const next = { ...editDraft };
                          setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                          setEditDraft(next);
                        }}
                      >
                        <option value="">Distribution</option>
                        {distributionOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
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
            <h3 className="font-serif text-2xl">Nouveau document</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.path} className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  {field.label}
                  {field.path === "distributionId" ? (
                    <select
                      className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                      value={String(toInputValue(getByPath(createDraft, field.path), field.type))}
                      onChange={(event) => {
                        const next = { ...createDraft };
                        setByPath(next, field.path, fromInputValue(event.target.value, field.type));
                        setCreateDraft(next);
                      }}
                    >
                      <option value="">Distribution</option>
                      {distributionOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
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
