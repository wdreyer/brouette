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

export default function ProducersEditor({
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

  const cardFields = useMemo(() => fields.filter((field) => field.table), [fields]);

  const load = async () => {
    setLoading(true);
    const q = query(collection(firebaseDb, collectionName), limit(100));
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
      setMessage("Producteur mis a jour.");
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
      setMessage("Producteur cree.");
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
          Nouveau producteur
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {docs.map((entry) => (
            <button
              key={entry.id}
              className="flex h-full flex-col gap-4 rounded-3xl border border-clay/70 bg-white/90 p-6 text-left shadow-card transition hover:-translate-y-1 hover:border-ink/30"
              onClick={() => openEdit(entry)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                    Producteur
                  </p>
                  <h3 className="font-serif text-2xl">{String(getByPath(entry.data, "name") ?? "-")}</h3>
                </div>
                <span className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink/70">
                  {String(getByPath(entry.data, "coopStatus") ?? "-")}
                </span>
              </div>
              <p className="text-sm text-ink/70">
                {String(getByPath(entry.data, "notes") ?? "Aucune note pour ce producteur.")}
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-ink/60">
                {cardFields
                  .filter((field) => field.path !== "name")
                  .map((field) => (
                    <span key={field.path} className="rounded-full bg-clay/70 px-3 py-1">
                      {field.label}: {String(getByPath(entry.data, field.path) ?? "-")}
                    </span>
                  ))}
              </div>
              <span className="mt-auto text-xs font-semibold text-ink/50">Cliquer pour editer</span>
            </button>
          ))}
        </div>
      )}

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {editingId ? (
        <div className="rounded-3xl border border-clay/70 bg-white/95 p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Edition producteur
              </p>
              <h3 className="font-serif text-3xl">
                {String(getByPath(editDraft, "name") ?? "Producteur")}
              </h3>
            </div>
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
              onClick={() => setEditingId(null)}
            >
              Fermer
            </button>
          </div>

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
              Annuler
            </button>
          </div>
        </div>
      ) : null}

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
