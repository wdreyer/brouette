"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Timestamp, collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseDb } from "@/lib/firebase/client";
import {
  distributionLabel,
  distributionStatusLabel,
  distributionStatusSelectValue,
  isArchivedStatus,
} from "@/lib/distributions";

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

type FireDate = { toDate?: () => Date };

type DistributionDoc = {
  id: string;
  status?: string;
  dates?: FireDate[];
};

type ProducerDoc = {
  id: string;
  name?: string;
  referentId?: string | null;
  referentName?: string | null;
};

type CalendarProducerDoc = {
  producerId?: string;
  activeDateKeys?: string[];
};

function toDate(value?: FireDate) {
  return value?.toDate?.() ?? null;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fromDateKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function formatDate(value: Date | null) {
  if (!value) return "-";
  return value.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatShortDateKey(key: string) {
  return formatDate(fromDateKey(key));
}

function plusDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export default function DistributionsEditor({ title, description }: EditorProps) {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === "admin";
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const [rows, setRows] = useState<
    Array<{ distribution: DistributionDoc; checkedProducers: number }>
  >([]);
  const [producers, setProducers] = useState<ProducerDoc[]>([]);

  const [editingDistribution, setEditingDistribution] = useState<DistributionDoc | null>(null);
  const [editingKeys, setEditingKeys] = useState<string[]>([]);
  const [editingSelection, setEditingSelection] = useState<Record<string, Record<string, boolean>>>({});
  const [editingExistingCalendarIds, setEditingExistingCalendarIds] = useState<Set<string>>(new Set());
  const [savingModal, setSavingModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    const now = new Date();
    const oneYearLater = new Date(now);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    const [distSnap, producerSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates")),
      getDocs(collection(firebaseDb, "producers")),
    ]);

    const producerRows = producerSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ProducerDoc, "id">) }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr"));
    setProducers(producerRows);

    const distributions = distSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<DistributionDoc, "id">) }))
      .filter((distribution) => {
        if (isArchivedStatus(distribution.status)) return false;
        const firstDate = toDate(distribution.dates?.[0]);
        if (!firstDate) return false;
        return firstDate >= now && firstDate <= oneYearLater;
      })
      .sort((left, right) => {
        const a = toDate(left.dates?.[0]) ?? new Date(0);
        const b = toDate(right.dates?.[0]) ?? new Date(0);
        return a.getTime() - b.getTime();
      });

    const nextRows: Array<{ distribution: DistributionDoc; checkedProducers: number }> = [];
    for (const distribution of distributions) {
      const calendarSnap = await getDocs(
        collection(firebaseDb, "distributionDates", distribution.id, "calendarProducers"),
      );
      const distributionDateKeys = (distribution.dates ?? [])
        .slice(0, 3)
        .map((value) => value.toDate?.())
        .filter(Boolean)
        .map((value) => dateKey(value as Date));
      const checkedProducers = calendarSnap.docs.reduce((sum, docSnap) => {
        const data = docSnap.data() as CalendarProducerDoc;
        const activeDateKeys = Array.isArray(data.activeDateKeys)
          ? data.activeDateKeys.filter((key): key is string => typeof key === "string")
          : [];
        const hasCheckedDate = activeDateKeys.some((key) => distributionDateKeys.includes(key));
        return hasCheckedDate ? sum + 1 : sum;
      }, 0);
      nextRows.push({
        distribution,
        checkedProducers,
      });
    }
    setRows(nextRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const openEditModal = async (distribution: DistributionDoc) => {
    const distSnap = await getDoc(doc(firebaseDb, "distributionDates", distribution.id));
    if (!distSnap.exists()) return;

    const freshDistribution = {
      id: distSnap.id,
      ...(distSnap.data() as Omit<DistributionDoc, "id">),
    };
    const keys = (freshDistribution.dates ?? [])
      .slice(0, 3)
      .map((date) => date.toDate?.())
      .filter(Boolean)
      .map((date) => dateKey(date as Date));

    const [calendarSnap, producerRowsSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates", freshDistribution.id, "calendarProducers")),
      getDocs(collection(firebaseDb, "distributionDates", freshDistribution.id, "producers")),
    ]);

    const fromRows = new Map<string, string[]>();
    calendarSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as CalendarProducerDoc;
      const producerId = String(data.producerId ?? docSnap.id);
      const activeDateKeys = Array.isArray(data.activeDateKeys)
        ? data.activeDateKeys.filter((key): key is string => typeof key === "string")
        : [];
      fromRows.set(producerId, activeDateKeys);
    });
    producerRowsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as CalendarProducerDoc;
      const producerId = String(data.producerId ?? docSnap.id);
      if (fromRows.has(producerId)) return;
      const activeDateKeys = Array.isArray(data.activeDateKeys)
        ? data.activeDateKeys.filter((key): key is string => typeof key === "string")
        : [];
      fromRows.set(producerId, activeDateKeys);
    });

    const selection: Record<string, Record<string, boolean>> = {};
    producers.forEach((producer) => {
      const producerKeys = fromRows.get(producer.id) ?? [];
      selection[producer.id] = {};
      keys.forEach((key) => {
        selection[producer.id][key] = producerKeys.includes(key);
      });
    });

    setEditingDistribution(freshDistribution);
    setEditingKeys(keys);
    setEditingSelection(selection);
    setEditingExistingCalendarIds(new Set(calendarSnap.docs.map((docSnap) => docSnap.id)));
  };

  const closeModal = () => {
    setEditingDistribution(null);
    setEditingKeys([]);
    setEditingSelection({});
    setEditingExistingCalendarIds(new Set());
  };

  const toggleProducerDate = (producerId: string, key: string) => {
    setEditingSelection((prev) => ({
      ...prev,
      [producerId]: {
        ...(prev[producerId] ?? {}),
        [key]: !Boolean(prev[producerId]?.[key]),
      },
    }));
  };

  const saveModal = async () => {
    if (!editingDistribution) return;
    setSavingModal(true);
    setMessage("");
    try {
      const now = Timestamp.now();
      const batch = writeBatch(firebaseDb);

      producers.forEach((producer) => {
        const activeDateKeys = editingKeys.filter((key) => Boolean(editingSelection[producer.id]?.[key]));

        const calendarRef = doc(
          firebaseDb,
          "distributionDates",
          editingDistribution.id,
          "calendarProducers",
          producer.id,
        );
        const producerRef = doc(firebaseDb, "distributionDates", editingDistribution.id, "producers", producer.id);

        batch.set(
          producerRef,
          {
            producerId: producer.id,
            referentId: producer.referentId ?? null,
            referentName: producer.referentName ?? null,
            active: activeDateKeys.length > 0,
            activeDateKeys,
            validatedByReferent: false,
            validatedAt: null,
            updatedAt: now,
          },
          { merge: true },
        );

        if (activeDateKeys.length > 0) {
          batch.set(
            calendarRef,
            {
              producerId: producer.id,
              active: true,
              activeDateKeys,
              updatedAt: now,
            },
            { merge: true },
          );
        } else if (editingExistingCalendarIds.has(producer.id)) {
          batch.delete(calendarRef);
        }
      });

      await batch.commit();
      setMessage("Distribution mise a jour.");
      closeModal();
      await load();
    } catch {
      setMessage("Impossible d'enregistrer la distribution.");
    } finally {
      setSavingModal(false);
    }
  };

  const addDistribution = async () => {
    setAdding(true);
    setMessage("");
    try {
      const allDates = rows
        .flatMap((row) => row.distribution.dates ?? [])
        .map((date) => date.toDate?.())
        .filter(Boolean) as Date[];
      const sorted = [...allDates].sort((a, b) => a.getTime() - b.getTime());
      const baseDate = sorted.length ? sorted[sorted.length - 1] : new Date();
      const d1 = plusDays(baseDate, 14);
      const d2 = plusDays(d1, 14);
      const d3 = plusDays(d2, 14);

      await setDoc(
        doc(collection(firebaseDb, "distributionDates")),
        {
          status: "planned",
          dates: [d1, d2, d3].map((date) => Timestamp.fromDate(date)),
          createdAt: Timestamp.now(),
        },
        { merge: true },
      );
      setMessage("Distribution ajoutee.");
      await load();
    } catch {
      setMessage("Impossible d'ajouter la distribution.");
    } finally {
      setAdding(false);
    }
  };

  const updateDistributionStatus = async (
    distributionId: string,
    nextStatus: "planned" | "open" | "finished",
  ) => {
    if (!isAdmin) return;
    try {
      setUpdatingStatusId(distributionId);
      setMessage("");
      const payload: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: Timestamp.now(),
      };
      if (nextStatus === "open") {
        payload.openedAt = Timestamp.now();
      } else if (nextStatus === "finished") {
        payload.closedAt = Timestamp.now();
      } else {
        payload.openedAt = null;
        payload.closedAt = null;
      }
      await setDoc(doc(firebaseDb, "distributionDates", distributionId), payload, { merge: true });
      setRows((prev) =>
        prev.map((row) =>
          row.distribution.id === distributionId
            ? { ...row, distribution: { ...row.distribution, status: nextStatus } }
            : row,
        ),
      );
      setMessage("Statut de la distribution mis a jour.");
    } catch {
      setMessage("Impossible de mettre a jour le statut.");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows.length]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[10px] border border-clay/90 bg-stone p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-3xl">{title}</h2>
            <p className="mt-2 text-sm text-ink/70">
              {description ?? "Liste des distributions sur l annee a venir."}
            </p>
          </div>
          <button
            className="rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={addDistribution}
            disabled={adding}
          >
            Ajouter une distribution (3 dates)
          </button>
        </div>
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-stone p-4">
        {loading ? (
          <p className="text-sm text-ink/70">Chargement...</p>
        ) : empty ? (
          <p className="text-sm text-ink/70">Aucune distribution sur l annee a venir.</p>
        ) : (
          <div className="overflow-auto border border-ink/15 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-ink/15 bg-ink text-stone">
                <tr>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Distribution</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Date 1</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Date 2</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Date 3</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Statut</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Producteurs avec au moins une date cochee</th>
                  <th className="px-3 py-2 text-xs uppercase tracking-[0.12em]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.distribution.id} className="border-b border-ink/10">
                    <td className="px-3 py-2 text-xs font-semibold">{distributionLabel(row.distribution)}</td>
                    <td className="px-3 py-2 text-xs text-ink/70">{formatDate(toDate(row.distribution.dates?.[0]))}</td>
                    <td className="px-3 py-2 text-xs text-ink/70">{formatDate(toDate(row.distribution.dates?.[1]))}</td>
                    <td className="px-3 py-2 text-xs text-ink/70">{formatDate(toDate(row.distribution.dates?.[2]))}</td>
                    <td className="px-3 py-2 text-xs text-ink/70">
                      {isAdmin ? (
                        <select
                          className="min-w-[130px] rounded-md border border-ink/20 bg-white px-2 py-1 text-xs"
                          value={distributionStatusSelectValue(row.distribution.status)}
                          onChange={(event) =>
                            updateDistributionStatus(
                              row.distribution.id,
                              event.target.value as "planned" | "open" | "finished",
                            ).catch(() => undefined)
                          }
                          disabled={updatingStatusId === row.distribution.id}
                        >
                          <option value="planned">Planifiee</option>
                          <option value="open">Ouverte</option>
                          <option value="finished">Finie</option>
                        </select>
                      ) : (
                        distributionStatusLabel(row.distribution.status)
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/70">
                      {row.checkedProducers}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded-md border border-ink/20 bg-white px-3 py-1 text-xs font-semibold"
                        onClick={() => openEditModal(row.distribution).catch(() => undefined)}
                      >
                        Voir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {editingDistribution ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto border border-ink/15 bg-stone p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Distribution</p>
                <h3 className="font-serif text-2xl">{distributionLabel(editingDistribution)}</h3>
                <p className="text-xs text-ink/60">
                  {editingKeys.map((key) => formatShortDateKey(key)).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-ink/20 bg-white px-3 py-2 text-xs font-semibold"
                  onClick={closeModal}
                >
                  Fermer
                </button>
                <button
                  className="rounded-md bg-forest px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() => saveModal().catch(() => undefined)}
                  disabled={savingModal}
                >
                  Enregistrer
                </button>
              </div>
            </div>

            <div className="mt-3 overflow-auto border border-ink/15 bg-white">
              <table className="min-w-[900px] text-left text-sm">
                <thead className="border-b border-ink/15 bg-ink text-stone">
                  <tr>
                    <th className="sticky left-0 top-0 z-20 border-r border-ink/20 bg-ink px-3 py-2 text-xs uppercase tracking-[0.12em]">
                      Producteur
                    </th>
                    {editingKeys.map((key) => (
                      <th key={key} className="sticky top-0 z-10 px-2 py-2 text-center text-xs uppercase tracking-[0.12em]">
                        {formatShortDateKey(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {producers.map((producer) => (
                    <tr key={producer.id} className="border-b border-ink/10">
                      <td className="sticky left-0 z-10 border-r border-ink/10 bg-white px-3 py-2 text-xs font-semibold">
                        {producer.name ?? "Producteur"}
                      </td>
                      {editingKeys.map((key) => (
                        <td key={`${producer.id}-${key}`} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(editingSelection[producer.id]?.[key])}
                            onChange={() => toggleProducerDate(producer.id, key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
