"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Timestamp, collection, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import {
  distributionLabel,
  distributionStatusLabel,
  distributionStatusSelectValue,
  isArchivedStatus,
  isOpenStatus,
  normalizeDistributionStatus,
  resolveDistributionStatus,
} from "@/lib/distributions";

type FireDate = { toDate?: () => Date };

type DistributionDoc = {
  id: string;
  status?: string;
  dates?: FireDate[];
  archivedAt?: FireDate | null;
  archivedFromStatus?: string | null;
};

type ProducerDoc = {
  id: string;
  name?: string;
};

type ProductDoc = {
  producerId?: string;
};

type CalendarProducerDoc = {
  producerId?: string;
  activeDateKeys?: string[];
};

type DateColumn = {
  distributionId: string;
  dateKey: string;
  label: string;
  isStart: boolean;
};

function selectionKey(distributionId: string, dateKeyValue: string) {
  return `${distributionId}::${dateKeyValue}`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toDateFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function sortDateKeys(keys: string[]) {
  return [...new Set(keys)]
    .filter(Boolean)
    .sort((left, right) => toDateFromKey(left).getTime() - toDateFromKey(right).getTime());
}

function formatDateLabel(value: Date) {
  return value.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export default function AnnualCalendarEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const [distributions, setDistributions] = useState<DistributionDoc[]>([]);
  const [producers, setProducers] = useState<ProducerDoc[]>([]);
  const [productCountByProducer, setProductCountByProducer] = useState<Record<string, number>>({});
  const [distributionDateKeys, setDistributionDateKeys] = useState<Record<string, string[]>>({});
  const [selectedByProducer, setSelectedByProducer] = useState<Record<string, Record<string, boolean>>>({});
  const [existingCalendarDocs, setExistingCalendarDocs] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDates, setCreateDates] = useState({ date1: "", date2: "", date3: "" });
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    const [distSnap, producerSnap, productSnap] = await Promise.all([
      getDocs(collection(firebaseDb, "distributionDates")),
      getDocs(collection(firebaseDb, "producers")),
      getDocs(collection(firebaseDb, "products")),
    ]);

    const nextDistributions = distSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<DistributionDoc, "id">) }))
      .sort((a, b) => {
        const left = a.dates?.[0]?.toDate?.() ?? new Date(0);
        const right = b.dates?.[0]?.toDate?.() ?? new Date(0);
        return left.getTime() - right.getTime();
      });

    const nextProducers = producerSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ProducerDoc, "id">) }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr"));

    const counts: Record<string, number> = {};
    nextProducers.forEach((producer) => {
      counts[producer.id] = 0;
    });
    productSnap.docs.forEach((docSnap) => {
      const producerId = String((docSnap.data() as ProductDoc).producerId ?? "");
      if (!producerId) return;
      counts[producerId] = (counts[producerId] ?? 0) + 1;
    });

    const dateKeysByDistribution: Record<string, string[]> = {};
    nextDistributions.forEach((distribution) => {
      dateKeysByDistribution[distribution.id] = sortDateKeys(
        (distribution.dates ?? [])
          .map((date) => date.toDate?.())
          .filter(Boolean)
          .map((date) => dateKey(date as Date)),
      );
    });

    const existingByDistribution: Record<string, string[]> = {};
    const selected: Record<string, Record<string, boolean>> = {};
    nextProducers.forEach((producer) => {
      selected[producer.id] = {};
    });

    for (const distribution of nextDistributions) {
      const keys = dateKeysByDistribution[distribution.id] ?? [];
      const calendarSnap = await getDocs(
        collection(firebaseDb, "distributionDates", distribution.id, "calendarProducers"),
      );
      const rows: Record<string, string[]> = {};
      const existingIds: string[] = [];
      calendarSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as CalendarProducerDoc;
        const producerId = String(data.producerId ?? docSnap.id);
        const activeKeys = Array.isArray(data.activeDateKeys)
          ? data.activeDateKeys.filter((key): key is string => typeof key === "string")
          : [];
        rows[producerId] = activeKeys;
        existingIds.push(producerId);
      });
      existingByDistribution[distribution.id] = existingIds;

      nextProducers.forEach((producer) => {
        const producerKeys = rows[producer.id] ?? [];
        keys.forEach((key) => {
          selected[producer.id][selectionKey(distribution.id, key)] = producerKeys.includes(key);
        });
      });
    }

    setDistributions(nextDistributions);
    setProducers(nextProducers);
    setProductCountByProducer(counts);
    setDistributionDateKeys(dateKeysByDistribution);
    setSelectedByProducer(selected);
    setExistingCalendarDocs(existingByDistribution);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const dateColumns = useMemo(() => {
    const columns: DateColumn[] = [];
    distributions
      .filter((distribution) => !isArchivedStatus(distribution.status))
      .forEach((distribution) => {
      const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
      keys.forEach((key, index) => {
        columns.push({
          distributionId: distribution.id,
          dateKey: key,
          label: formatDateLabel(toDateFromKey(key)),
          isStart: index === 0,
        });
      });
      });
    return columns;
  }, [distributionDateKeys, distributions]);

  const activeDistributions = useMemo(
    () => distributions.filter((distribution) => !isArchivedStatus(distribution.status)),
    [distributions],
  );

  const archivedDistributions = useMemo(
    () => distributions.filter((distribution) => isArchivedStatus(distribution.status)),
    [distributions],
  );

  const checkedProducersByDistribution = useMemo(() => {
    const next: Record<string, number> = {};
    activeDistributions.forEach((distribution) => {
      const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
      let count = 0;
      producers.forEach((producer) => {
        const isChecked = keys.some((key) =>
          Boolean(selectedByProducer[producer.id]?.[selectionKey(distribution.id, key)]),
        );
        if (isChecked) count += 1;
      });
      next[distribution.id] = count;
    });
    return next;
  }, [activeDistributions, distributionDateKeys, producers, selectedByProducer]);

  const updateDistributionStatus = async (
    distribution: DistributionDoc,
    nextStatus: "planned" | "open" | "finished",
  ) => {
    if (
      nextStatus === "open" &&
      activeDistributions.some((item) => item.id !== distribution.id && isOpenStatus(item.status))
    ) {
      setMessage("Une seule distribution peut etre ouverte a la fois.");
      return;
    }

    setUpdatingStatusId(distribution.id);
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: Timestamp.now(),
      };
      if (nextStatus === "open") {
        payload.openedAt = Timestamp.now();
        payload.closedAt = null;
      } else if (nextStatus === "finished") {
        payload.closedAt = Timestamp.now();
      } else {
        payload.openedAt = null;
        payload.closedAt = null;
      }
      await setDoc(doc(firebaseDb, "distributionDates", distribution.id), payload, { merge: true });
      setDistributions((prev) =>
        prev.map((item) => (item.id === distribution.id ? { ...item, status: nextStatus } : item)),
      );
      setMessage("Statut de la distribution mis a jour.");
    } catch {
      setMessage("Impossible de mettre a jour le statut.");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const openCreateDistribution = () => {
    setCreateDates({
      date1: "",
      date2: "",
      date3: "",
    });
    setCreateOpen(true);
  };

  const archiveDistribution = async (distribution: DistributionDoc) => {
    if (isOpenStatus(distribution.status)) {
      setMessage("Impossible d'archiver une vente ouverte. Ferme la vente d'abord.");
      return;
    }
    if (
      !window.confirm(
        "Archiver cette distribution ? Les donnees sont conservees et visibles dans les archives.",
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await setDoc(
        doc(firebaseDb, "distributionDates", distribution.id),
        {
          status: "archived",
          archivedAt: Timestamp.now(),
          archivedFromStatus: normalizeDistributionStatus(distribution.status) || "planned",
        },
        { merge: true },
      );
      setMessage("Distribution archivee.");
      setShowArchived(true);
      await load();
    } catch {
      setMessage("Impossible d'archiver la distribution.");
    } finally {
      setSaving(false);
    }
  };

  const restoreDistribution = async (distribution: DistributionDoc) => {
    if (!window.confirm("Restaurer cette distribution dans le planning actif ?")) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const restoredStatus = resolveDistributionStatus(distribution.archivedFromStatus ?? "");
      const allowedStatus: "planned" | "finished" = restoredStatus === "finished" ? "finished" : "planned";
      await setDoc(
        doc(firebaseDb, "distributionDates", distribution.id),
        {
          status: allowedStatus,
          archivedAt: null,
          archivedFromStatus: null,
        },
        { merge: true },
      );
      setMessage("Distribution restauree.");
      await load();
    } catch {
      setMessage("Impossible de restaurer la distribution.");
    } finally {
      setSaving(false);
    }
  };

  const addDistribution = async () => {
    setSaving(true);
    setMessage("");
    try {
      const rawDates = [createDates.date1, createDates.date2, createDates.date3];
      if (rawDates.some((value) => !value)) {
        setMessage("Renseigne les 3 dates de la distribution.");
        setSaving(false);
        return;
      }

      const parsedDates = rawDates.map((value) => new Date(`${value}T00:00:00.000Z`));
      if (parsedDates.some((value) => Number.isNaN(value.getTime()))) {
        setMessage("Une des dates est invalide.");
        setSaving(false);
        return;
      }
      if (!(parsedDates[0] < parsedDates[1] && parsedDates[1] < parsedDates[2])) {
        setMessage("Les dates doivent etre dans l'ordre croissant.");
        setSaving(false);
        return;
      }

      const distributionRef = doc(collection(firebaseDb, "distributionDates"));
      await setDoc(
        distributionRef,
        {
          status: "planned",
          dates: parsedDates.map((date) => Timestamp.fromDate(date)),
          createdAt: Timestamp.now(),
        },
        { merge: true },
      );
      setCreateOpen(false);
      setMessage("Distribution ajoutee (3 dates).");
      await load();
    } catch {
      setMessage("Impossible d'ajouter la distribution.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDate = (producerId: string, date: DateColumn) => {
    const key = selectionKey(date.distributionId, date.dateKey);
    const nextValue = !Boolean(selectedByProducer[producerId]?.[key]);
    setSelectedByProducer((prev) => ({
      ...prev,
      [producerId]: {
        ...(prev[producerId] ?? {}),
        [key]: nextValue,
      },
    }));
  };

  const saveCalendar = async () => {
    setSaving(true);
    setMessage("");
    const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    const now = Timestamp.now();

    activeDistributions.forEach((distribution) => {
      const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
      const existing = new Set(existingCalendarDocs[distribution.id] ?? []);
      const distributionRef = doc(firebaseDb, "distributionDates", distribution.id);

      operations.push((batch) =>
        batch.set(
          distributionRef,
          {
            dates: keys.map((key) => Timestamp.fromDate(toDateFromKey(key))),
          },
          { merge: true },
        ),
      );

      producers.forEach((producer) => {
        const activeDateKeys = keys.filter(
          (key) => selectedByProducer[producer.id]?.[selectionKey(distribution.id, key)],
        );
        const calendarRef = doc(
          firebaseDb,
          "distributionDates",
          distribution.id,
          "calendarProducers",
          producer.id,
        );
        const producerRef = doc(firebaseDb, "distributionDates", distribution.id, "producers", producer.id);

        if (activeDateKeys.length > 0) {
          operations.push((batch) =>
            batch.set(
              calendarRef,
              {
                producerId: producer.id,
                active: true,
                activeDateKeys,
                updatedAt: now,
              },
              { merge: true },
            ),
          );
          operations.push((batch) =>
            batch.set(
              producerRef,
              {
                producerId: producer.id,
                active: true,
                activeDateKeys,
              },
              { merge: true },
            ),
          );
          return;
        }

        if (existing.has(producer.id)) {
          operations.push((batch) => batch.delete(calendarRef));
          operations.push((batch) =>
            batch.set(
              producerRef,
              {
                producerId: producer.id,
                active: false,
                activeDateKeys: [],
                validatedByReferent: false,
                validatedAt: null,
              },
              { merge: true },
            ),
          );
        }
      });
    });

    const chunkSize = 350;
    for (let index = 0; index < operations.length; index += chunkSize) {
      const batch = writeBatch(firebaseDb);
      operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
      await batch.commit();
    }

    const nextExisting: Record<string, string[]> = { ...existingCalendarDocs };
    activeDistributions.forEach((distribution) => {
      const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
      nextExisting[distribution.id] = producers
        .filter((producer) =>
          keys.some((key) => selectedByProducer[producer.id]?.[selectionKey(distribution.id, key)]),
        )
        .map((producer) => producer.id);
    });
    setExistingCalendarDocs(nextExisting);
    setSaving(false);
    setMessage("Calendrier enregistré.");
  };

  const producersWithoutProductsCount = producers.filter(
    (producer) => (productCountByProducer[producer.id] ?? 0) === 0,
  ).length;

  if (loading) {
    return <div className="rounded-[10px] border border-clay/80 bg-stone p-4 text-sm text-ink/70">Chargement...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[10px] border border-clay/90 bg-stone p-4">
        <h2 className="font-serif text-3xl">Calendrier annuel producteurs</h2>
        <p className="mt-2 text-sm text-ink/70">
          Tu ajoutes uniquement des distributions complÃ¨tes (3 dates), puis tu coches les producteurs par date.
        </p>
        <p className="mt-2 text-xs text-ink/60">Producteurs sans produits inclus: {producersWithoutProductsCount}</p>
      </section>

      <section className="rounded-[10px] border border-clay/90 bg-stone p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Planning producteurs x dates</p>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-semibold"
              onClick={openCreateDistribution}
              disabled={saving}
            >
              Ajouter une distribution (3 dates)
            </button>
            <button
              className="rounded-md bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={saveCalendar}
              disabled={saving || dateColumns.length === 0}
            >
              Enregistrer le calendrier
            </button>
          </div>
        </div>

        {activeDistributions.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {activeDistributions.map((distribution) => {
              const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
              return (
                <div
                  key={`manage-${distribution.id}`}
                  className="flex items-center justify-between gap-3 border border-ink/15 bg-white px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">{distributionLabel(distribution)}</p>
                    <p className="text-xs text-ink/60">
                      {keys.map((key) => formatDateLabel(toDateFromKey(key))).join(" / ")}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/65">
                      <span>Statut</span>
                      <select
                        className="rounded-md border border-ink/20 bg-white px-2 py-1 text-xs font-semibold text-ink"
                        value={distributionStatusSelectValue(distribution.status)}
                        onChange={(event) =>
                          updateDistributionStatus(
                            distribution,
                            event.target.value as "planned" | "open" | "finished",
                          ).catch(() => undefined)
                        }
                        disabled={saving || updatingStatusId === distribution.id}
                      >
                        <option value="planned">Planifiee</option>
                        <option value="open">Ouverte</option>
                        <option value="finished">Finie</option>
                      </select>
                      <span className="text-ink/55">
                        Producteurs coches: {checkedProducersByDistribution[distribution.id] ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] font-semibold text-ink/60">{distributionStatusLabel(distribution.status)}</span>
                    <button
                      className="rounded-md border border-ink/20 bg-stone px-2 py-1 text-xs font-semibold text-ink disabled:opacity-50"
                      onClick={() => archiveDistribution(distribution)}
                      disabled={saving || updatingStatusId === distribution.id}
                    >
                      Archiver
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {archivedDistributions.length > 0 ? (
          <div className="mt-3 border border-ink/15 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                Archives ({archivedDistributions.length})
              </p>
              <button
                className="rounded-md border border-ink/20 bg-white px-3 py-1 text-xs font-semibold"
                onClick={() => setShowArchived((prev) => !prev)}
              >
                {showArchived ? "Masquer" : "Voir les archives"}
              </button>
            </div>
            {showArchived ? (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {archivedDistributions.map((distribution) => {
                  const keys = sortDateKeys(distributionDateKeys[distribution.id] ?? []);
                  const archivedAt = distribution.archivedAt?.toDate?.();
                  return (
                    <div
                      key={`archived-${distribution.id}`}
                      className="flex items-center justify-between gap-3 border border-ink/15 bg-stone px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink">{distributionLabel(distribution)}</p>
                        <p className="text-xs text-ink/60">
                          {keys.map((key) => formatDateLabel(toDateFromKey(key))).join(" / ")}
                        </p>
                        <p className="text-[11px] text-ink/55">
                          Archivee {archivedAt ? `le ${archivedAt.toLocaleDateString("fr-FR")}` : ""}
                        </p>
                        <p className="text-[11px] text-ink/55">
                          Ancien statut: {distributionStatusLabel(distribution.archivedFromStatus ?? distribution.status)}
                        </p>
                      </div>
                      <button
                        className="rounded-md border border-ink/20 bg-white px-2 py-1 text-xs font-semibold text-ink disabled:opacity-50"
                        onClick={() => restoreDistribution(distribution)}
                        disabled={saving}
                      >
                        Restaurer
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {createOpen ? (
          <div className="mt-3 grid gap-2 border border-ink/15 bg-white p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink/70">
              Date 1
              <input
                type="date"
                value={createDates.date1}
                onChange={(event) =>
                  setCreateDates((prev) => ({
                    ...prev,
                    date1: event.target.value,
                  }))
                }
                className="rounded-md border border-ink/20 px-2 py-2 text-sm font-normal text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink/70">
              Date 2
              <input
                type="date"
                value={createDates.date2}
                onChange={(event) =>
                  setCreateDates((prev) => ({
                    ...prev,
                    date2: event.target.value,
                  }))
                }
                className="rounded-md border border-ink/20 px-2 py-2 text-sm font-normal text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink/70">
              Date 3
              <input
                type="date"
                value={createDates.date3}
                onChange={(event) =>
                  setCreateDates((prev) => ({
                    ...prev,
                    date3: event.target.value,
                  }))
                }
                className="rounded-md border border-ink/20 px-2 py-2 text-sm font-normal text-ink"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={addDistribution}
                disabled={saving}
              >
                Ajouter
              </button>
              <button
                className="rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-semibold"
                onClick={() => setCreateOpen(false)}
                disabled={saving}
              >
                Annuler
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-3 max-h-[70vh] overflow-auto border border-ink/20 bg-white">
          <table className="min-w-[980px] text-left text-sm">
            <thead className="border-b border-ink/20 bg-ink text-stone">
              <tr>
                <th className="sticky left-0 top-0 z-30 h-10 border-r border-ink/20 bg-ink px-3 py-2 text-xs uppercase tracking-[0.12em]">
                  Producteur
                </th>
                {activeDistributions.map((distribution) => (
                  <th
                    key={`dist-${distribution.id}`}
                    colSpan={(distributionDateKeys[distribution.id] ?? []).length || 1}
                    className="sticky top-0 z-20 h-10 border-l-2 border-stone/40 bg-ink px-2 py-2 text-center text-[11px] uppercase tracking-[0.12em]"
                  >
                    {distributionLabel(distribution)}
                  </th>
                ))}
              </tr>
              <tr className="border-t border-stone/20">
                <th className="sticky left-0 top-10 z-30 h-10 border-r border-ink/20 bg-ink px-3 py-2 text-[11px] text-stone/80">
                  Produit(s)
                </th>
                {dateColumns.map((column) => (
                  <th
                    key={`${column.distributionId}-${column.dateKey}`}
                    className={`sticky top-10 z-20 h-10 bg-ink px-2 py-2 text-center text-[11px] text-stone/85 ${
                      column.isStart ? "border-l-2 border-stone/40" : ""
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {producers.map((producer) => (
                <tr
                  key={producer.id}
                  className={`border-b border-ink/10 ${
                    (productCountByProducer[producer.id] ?? 0) === 0 ? "bg-stone/60" : ""
                  }`}
                >
                  <td className="sticky left-0 z-10 border-r border-ink/10 bg-white px-3 py-2">
                    <p className="font-semibold text-ink">{producer.name ?? "Producteur"}</p>
                    <p className="text-xs text-ink/60">{productCountByProducer[producer.id] ?? 0} produits</p>
                  </td>
                  {dateColumns.map((column) => (
                    <td
                      key={`${producer.id}-${column.dateKey}`}
                      className={`px-2 py-2 text-center ${column.isStart ? "border-l-2 border-ink/15" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(
                          selectedByProducer[producer.id]?.[
                            selectionKey(column.distributionId, column.dateKey)
                          ],
                        )}
                        onChange={() => toggleDate(producer.id, column)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {message ? <p className="text-sm text-ink/70">{message}</p> : null}
    </div>
  );
}

