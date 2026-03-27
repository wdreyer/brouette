"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel } from "@/lib/distributions";

type FireDate = { toDate?: () => Date };

type DistributionDoc = {
  id: string;
  status?: string;
  dates?: FireDate[];
};

type ProducerDoc = {
  id: string;
  name?: string;
};

type CalendarProducerDoc = {
  producerId?: string;
  active?: boolean;
  activeDateKeys?: string[];
};

type DateColumn = {
  distributionId: string;
  dateKey: string;
  label: string;
  isStart: boolean;
};

type DistributionView = {
  id: string;
  label: string;
  status: string;
  dateKeys: string[];
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
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
  return value.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function isUpcomingOrCurrentDistribution(distribution: DistributionDoc, now: Date) {
  const status = String(distribution.status ?? "").toLowerCase();
  if (status === "open" || status === "planned") return true;
  const dates = (distribution.dates ?? [])
    .map((item) => item.toDate?.())
    .filter(Boolean) as Date[];
  return dates.some((date) => date.getTime() >= now.getTime());
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "open") {
    return {
      label: "Vente ouverte",
      className: "border border-moss/35 bg-moss/10 text-moss",
    };
  }
  if (normalized === "planned") {
    return {
      label: "Preparation",
      className: "border border-honey/40 bg-honey/20 text-ink/75",
    };
  }
  return {
    label: "Planifiee",
    className: "border border-ink/20 bg-stone text-ink/70",
  };
}

export default function ProducerAnnualCalendarPublic() {
  const [loading, setLoading] = useState(true);
  const [distributions, setDistributions] = useState<DistributionView[]>([]);
  const [producerRows, setProducerRows] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedByProducer, setSelectedByProducer] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const [distributionsSnap, producersSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "distributionDates")),
        getDocs(collection(firebaseDb, "producers")),
      ]);

      const producerNameById: Record<string, string> = {};
      producersSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as ProducerDoc;
        producerNameById[docSnap.id] = String(data.name ?? docSnap.id);
      });

      const distributionDocs = distributionsSnap.docs
        .map(
          (docSnap) =>
            ({ id: docSnap.id, ...(docSnap.data() as Omit<DistributionDoc, "id">) }) as DistributionDoc,
        )
        .filter((distribution) => isUpcomingOrCurrentDistribution(distribution, new Date()))
        .sort((a, b) => {
          const left = a.dates?.[0]?.toDate?.() ?? new Date(0);
          const right = b.dates?.[0]?.toDate?.() ?? new Date(0);
          return left.getTime() - right.getTime();
        });

      const nextDistributions: DistributionView[] = [];
      const nextSelectedByProducer: Record<string, Record<string, boolean>> = {};

      await Promise.all(
        distributionDocs.map(async (distribution) => {
          const keys = sortDateKeys(
            (distribution.dates ?? [])
              .slice(0, 3)
              .map((item) => item.toDate?.())
              .filter(Boolean)
              .map((value) => dateKey(value as Date)),
          );
          if (!keys.length) return;

          const activeByDate: Record<string, Set<string>> = {};
          keys.forEach((key) => {
            activeByDate[key] = new Set<string>();
          });

          const calendarSnap = await getDocs(
            collection(firebaseDb, "distributionDates", distribution.id, "calendarProducers"),
          );
          calendarSnap.docs.forEach((docSnap) => {
            const data = docSnap.data() as CalendarProducerDoc;
            if (data.active === false) return;
            const producerId = String(data.producerId ?? docSnap.id);
            const activeDateKeys = Array.isArray(data.activeDateKeys) ? data.activeDateKeys : [];
            activeDateKeys.forEach((key) => {
              if (!activeByDate[key]) return;
              activeByDate[key].add(producerId);
            });
          });

          const hasCheckedProducer = keys.some((key) => (activeByDate[key]?.size ?? 0) > 0);
          if (!hasCheckedProducer) return;

          keys.forEach((key) => {
            Array.from(activeByDate[key] ?? []).forEach((producerId) => {
              if (!nextSelectedByProducer[producerId]) {
                nextSelectedByProducer[producerId] = {};
              }
              nextSelectedByProducer[producerId][`${distribution.id}::${key}`] = true;
            });
          });

          nextDistributions.push({
            id: distribution.id,
            label: distributionLabel(distribution),
            status: String(distribution.status ?? "planned"),
            dateKeys: keys,
          });
        }),
      );

      nextDistributions.sort((a, b) => {
        const left = toDateFromKey(a.dateKeys[0] ?? "1970-01-01");
        const right = toDateFromKey(b.dateKeys[0] ?? "1970-01-01");
        return left.getTime() - right.getTime();
      });

      const rows = Object.keys(nextSelectedByProducer)
        .map((producerId) => ({
          id: producerId,
          name: producerNameById[producerId] ?? producerId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));

      setDistributions(nextDistributions);
      setProducerRows(rows);
      setSelectedByProducer(nextSelectedByProducer);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, []);

  const dateColumns = useMemo(() => {
    const columns: DateColumn[] = [];
    distributions.forEach((distribution) => {
      distribution.dateKeys.forEach((key, index) => {
        columns.push({
          distributionId: distribution.id,
          dateKey: key,
          label: formatDateLabel(toDateFromKey(key)),
          isStart: index === 0,
        });
      });
    });
    return columns;
  }, [distributions]);

  const totalChecked = useMemo(() => {
    return dateColumns.reduce((sum, column) => {
      const key = `${column.distributionId}::${column.dateKey}`;
      const count = producerRows.filter((row) => Boolean(selectedByProducer[row.id]?.[key])).length;
      return sum + count;
    }, 0);
  }, [dateColumns, producerRows, selectedByProducer]);

  if (loading) {
    return <p className="text-sm text-ink/70">Chargement du calendrier...</p>;
  }

  if (!distributions.length || !producerRows.length || !dateColumns.length) {
    return (
      <div className="rounded-xl border border-clay/70 bg-white/90 p-6 shadow-card">
        <p className="text-sm text-ink/70">Aucun producteur coche sur les distributions a venir.</p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-[10px] border border-clay/90 bg-stone p-4">
        <h2 className="font-serif text-3xl">Calendrier annuel producteurs</h2>
        <p className="mt-2 text-sm text-ink/70">
          Vue lecture seule des producteurs coches, sous forme chronologique.
        </p>
        <p className="mt-2 text-xs text-ink/60">
          {distributions.length} distributions · {producerRows.length} producteurs · {totalChecked} presences
        </p>
      </div>

      <section className="rounded-[10px] border border-clay/90 bg-stone p-4">
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          {distributions.map((distribution) => {
            const badge = statusBadge(distribution.status);
            return (
              <div
                key={distribution.id}
                className="flex items-center justify-between gap-3 border border-ink/15 bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-ink">{distribution.label}</p>
                  <p className="text-xs text-ink/60">
                    {distribution.dateKeys
                      .map((key) =>
                        toDateFromKey(key).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
                      )
                      .join(" / ")}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="max-h-[70vh] overflow-auto border border-ink/20 bg-white">
          <table className="min-w-[980px] text-left text-sm">
            <thead className="border-b border-ink/20 bg-ink text-stone">
              <tr>
                <th className="sticky left-0 top-0 z-30 h-10 border-r border-ink/20 bg-ink px-3 py-2 text-xs uppercase tracking-[0.12em]">
                  Producteur
                </th>
                {distributions.map((distribution) => (
                  <th
                    key={`dist-${distribution.id}`}
                    colSpan={distribution.dateKeys.length || 1}
                    className="sticky top-0 z-20 h-10 border-l-2 border-stone/40 bg-ink px-2 py-2 text-center text-[11px] uppercase tracking-[0.12em]"
                  >
                    {distribution.label}
                  </th>
                ))}
              </tr>
              <tr className="border-t border-stone/20">
                <th className="sticky left-0 top-10 z-30 h-10 border-r border-ink/20 bg-ink px-3 py-2 text-[11px] text-stone/80">
                  Presence
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
              {producerRows.map((producer) => (
                <tr key={producer.id} className="border-b border-ink/10">
                  <td className="sticky left-0 z-10 border-r border-ink/10 bg-white px-3 py-2">
                    <p className="font-semibold text-ink">{producer.name}</p>
                  </td>
                  {dateColumns.map((column) => {
                    const key = `${column.distributionId}::${column.dateKey}`;
                    const checked = Boolean(selectedByProducer[producer.id]?.[key]);
                    return (
                      <td
                        key={`${producer.id}-${column.distributionId}-${column.dateKey}`}
                        className={`px-2 py-2 text-center ${column.isStart ? "border-l-2 border-ink/15" : ""}`}
                      >
                        {checked ? (
                          <span className="inline-flex items-center rounded-full border border-moss/35 bg-moss/10 px-2 py-0.5 text-[11px] font-semibold text-moss">
                            Present
                          </span>
                        ) : (
                          <span className="text-xs text-ink/35">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
