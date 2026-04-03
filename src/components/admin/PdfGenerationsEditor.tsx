"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { distributionLabel, resolveDistributionStatus } from "@/lib/distributions";

type Order = {
  id: string;
  memberId?: string | null;
};

type Member = {
  id: string;
  firstName?: string;
  lastName?: string;
};

type OrderItem = {
  saleDateKey?: string | null;
  producerId?: string | null;
  productId?: string | null;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  label?: string;
  variantLabel?: string;
};

type Producer = {
  id: string;
  name?: string;
};

type Distribution = {
  id: string;
  status?: string;
  dates?: Array<{ toDate?: () => Date }>;
};

type DateOption = {
  key: string;
  label: string;
  distributionId?: string;
  distributionName?: string;
};

type ProductLineAgg = {
  key: string;
  label: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type ProducerDateAgg = {
  orderIds: Set<string>;
  totalQuantity: number;
  totalAmount: number;
  lines: Map<string, ProductLineAgg>;
};

type ProducerRow = {
  producerId: string;
  producerName: string;
  ordersCount: number;
  totalQuantity: number;
  totalAmount: number;
  lines: ProductLineAgg[];
};

type ProducerDateRow = {
  dateKey: string;
  dateLabel: string;
  ordersCount: number;
  totalQuantity: number;
  totalAmount: number;
  lines: ProductLineAgg[];
};

type ProducerDistributionRow = {
  producerId: string;
  producerName: string;
  ordersCount: number;
  totalQuantity: number;
  totalAmount: number;
  lines: ProductLineAgg[];
  dateRows: ProducerDateRow[];
};

type ProducerMatrixColumn = {
  key: string;
  title: string;
  unitPrice: number;
};

type ProducerMatrixRow = {
  memberId: string;
  memberLabel: string;
  quantitiesByProduct: Record<string, number>;
  totalQuantity: number;
};

type ProducerMatrix = {
  producerId: string;
  producerName: string;
  columns: ProducerMatrixColumn[];
  rows: ProducerMatrixRow[];
  totalsByProduct: Record<string, number>;
  grandTotal: number;
};

let cachedLogoDataUrl: string | null | undefined;

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(key: string) {
  const date = parseDateKey(key);
  if (!date) return key;
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateForFileName(key: string) {
  const date = parseDateKey(key);
  if (!date) return key;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatMoney(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

function sanitizeFileNamePart(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function memberLabel(member?: Member | null, fallback = "Adherent inconnu") {
  if (!member) return fallback;
  const first = String(member.firstName ?? "").trim();
  const last = String(member.lastName ?? "").trim();
  const label = `${last.toUpperCase()} ${first}`.trim();
  return label || fallback;
}

function isStatusOpenOrFinished(status?: string) {
  const value = resolveDistributionStatus(status);
  return value === "open" || value === "finished";
}

async function ensureLogoDataUrl() {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  try {
    const response = await fetch("/brand/brouette_no_bg.png");
    if (!response.ok) {
      cachedLogoDataUrl = null;
      return null;
    }
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("logo-read-failed"));
      reader.readAsDataURL(blob);
    });
    cachedLogoDataUrl = dataUrl;
    return dataUrl;
  } catch {
    cachedLogoDataUrl = null;
    return null;
  }
}

export default function PdfGenerationsEditor() {
  const [loading, setLoading] = useState(true);
  const [exportingProducerId, setExportingProducerId] = useState<string | null>(null);
  const [exportingBdcDateKey, setExportingBdcDateKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [orders, setOrders] = useState<Order[]>([]);
  const [membersById, setMembersById] = useState<Record<string, Member>>({});
  const [orderItemsByOrder, setOrderItemsByOrder] = useState<Record<string, OrderItem[]>>({});
  const [producersById, setProducersById] = useState<Record<string, Producer>>({});
  const [distributions, setDistributions] = useState<Distribution[]>([]);

  const [selectedDistributionId, setSelectedDistributionId] = useState("");
  const [selectedBdcDistributionId, setSelectedBdcDistributionId] = useState("all");
  const [previewProducerId, setPreviewProducerId] = useState<string | null>(null);
  const [previewBdcDateKey, setPreviewBdcDateKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [ordersSnap, membersSnap, producersSnap, distSnap] = await Promise.all([
        getDocs(query(collection(firebaseDb, "orders"), orderBy("createdAt", "desc"))),
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
        getDocs(collection(firebaseDb, "distributionDates")),
      ]);

      const nextOrders = ordersSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Order, "id">),
      }));
      setOrders(nextOrders);

      const nextMembers: Record<string, Member> = {};
      membersSnap.docs.forEach((docSnap) => {
        nextMembers[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Member, "id">) };
      });
      setMembersById(nextMembers);

      const nextProducers: Record<string, Producer> = {};
      producersSnap.docs.forEach((docSnap) => {
        nextProducers[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Omit<Producer, "id">) };
      });
      setProducersById(nextProducers);

      const nextDistributions = distSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }))
        .filter((distribution) => isStatusOpenOrFinished(distribution.status))
        .sort((a, b) => {
          const left = a.dates?.[0]?.toDate?.() ?? new Date(0);
          const right = b.dates?.[0]?.toDate?.() ?? new Date(0);
          return left.getTime() - right.getTime();
        });
      setDistributions(nextDistributions);

      const nextItemsByOrder: Record<string, OrderItem[]> = {};
      await Promise.all(
        nextOrders.map(async (order) => {
          const itemsSnap = await getDocs(collection(firebaseDb, "orders", order.id, "items"));
          nextItemsByOrder[order.id] = itemsSnap.docs.map((docSnap) => docSnap.data() as OrderItem);
        }),
      );
      setOrderItemsByOrder(nextItemsByOrder);
      setLoading(false);
    };

    load().catch(() => {
      setLoading(false);
      setMessage("Impossible de charger les donnees PDF.");
    });
  }, []);

  const dateOptions = useMemo(() => {
    const map = new Map<string, DateOption>();

    distributions.forEach((distribution) => {
      const distName = distributionLabel(distribution);
      (distribution.dates ?? []).slice(0, 3).forEach((value) => {
        const date = value.toDate?.();
        if (!date) return;
        const key = toDateKey(date);
        map.set(key, {
          key,
          label: formatDateKey(key),
          distributionId: distribution.id,
          distributionName: distName,
        });
      });
    });

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [distributions]);

  const bdcFilteredDateOptions = useMemo(
    () =>
      selectedBdcDistributionId === "all"
        ? dateOptions
        : dateOptions.filter((date) => date.distributionId === selectedBdcDistributionId),
    [dateOptions, selectedBdcDistributionId],
  );

  useEffect(() => {
    if (!distributions.length) {
      setSelectedDistributionId("");
      return;
    }
    if (!selectedDistributionId || !distributions.some((distribution) => distribution.id === selectedDistributionId)) {
      setSelectedDistributionId(distributions[0].id);
    }
  }, [distributions, selectedDistributionId]);

  useEffect(() => {
    if (selectedBdcDistributionId === "all") return;
    const exists = distributions.some((distribution) => distribution.id === selectedBdcDistributionId);
    if (!exists) {
      setSelectedBdcDistributionId("all");
    }
  }, [distributions, selectedBdcDistributionId]);

  const producerAggByDate = useMemo(() => {
    const byDate = new Map<string, Map<string, ProducerDateAgg>>();

    orders.forEach((order) => {
      const items = orderItemsByOrder[order.id] ?? [];
      items.forEach((item) => {
        const dKey = String(item.saleDateKey ?? "").trim();
        if (!dKey) return;

        if (!byDate.has(dKey)) byDate.set(dKey, new Map<string, ProducerDateAgg>());
        const byProducer = byDate.get(dKey)!;

        const producerId = String(item.producerId ?? "unknown");
        if (!byProducer.has(producerId)) {
          byProducer.set(producerId, {
            orderIds: new Set<string>(),
            totalQuantity: 0,
            totalAmount: 0,
            lines: new Map<string, ProductLineAgg>(),
          });
        }

        const producerAgg = byProducer.get(producerId)!;
        producerAgg.orderIds.add(order.id);

        const quantity = Number(item.quantity ?? 0);
        const unitPrice = Number(item.unitPrice ?? 0);
        const lineTotal = Number(item.lineTotal ?? quantity * unitPrice);

        producerAgg.totalQuantity += quantity;
        producerAgg.totalAmount += lineTotal;

        const label = String(item.label ?? "Produit");
        const variantLabel = String(item.variantLabel ?? "");
        const productKey = [String(item.productId ?? ""), label, variantLabel, String(unitPrice)].join("||");

        if (!producerAgg.lines.has(productKey)) {
          producerAgg.lines.set(productKey, {
            key: productKey,
            label,
            variantLabel,
            quantity: 0,
            unitPrice,
            lineTotal: 0,
          });
        }
        const lineAgg = producerAgg.lines.get(productKey)!;
        lineAgg.quantity += quantity;
        lineAgg.lineTotal += lineTotal;
      });
    });

    return byDate;
  }, [orders, orderItemsByOrder]);

  const selectedDistribution = useMemo(
    () => distributions.find((distribution) => distribution.id === selectedDistributionId) ?? null,
    [distributions, selectedDistributionId],
  );

  const selectedDistributionDates = useMemo(
    () => dateOptions.filter((date) => date.distributionId === selectedDistributionId),
    [dateOptions, selectedDistributionId],
  );

  const buildProducerRowsForDate = (targetDateKey: string) => {
    const byProducer = producerAggByDate.get(targetDateKey);
    if (!byProducer) return [] as ProducerRow[];

    const rows = Array.from(byProducer.entries()).map(([producerId, agg]) => {
      const producerName =
        producerId === "unknown" ? "Producteur inconnu" : producersById[producerId]?.name ?? producerId;
      const lines = Array.from(agg.lines.values()).sort((a, b) => {
        const left = `${a.label} ${a.variantLabel}`.trim();
        const right = `${b.label} ${b.variantLabel}`.trim();
        return left.localeCompare(right, "fr", { sensitivity: "base" });
      });

      return {
        producerId,
        producerName,
        ordersCount: agg.orderIds.size,
        totalQuantity: agg.totalQuantity,
        totalAmount: agg.totalAmount,
        lines,
      };
    });

    return rows.sort((a, b) => a.producerName.localeCompare(b.producerName, "fr", { sensitivity: "base" }));
  };

  const buildProducerRowsForDistribution = (dates: DateOption[]) => {
    const byProducer = new Map<
      string,
      {
        producerName: string;
        orderIds: Set<string>;
        totalQuantity: number;
        totalAmount: number;
        lines: Map<string, ProductLineAgg>;
        byDate: Map<string, ProducerDateRow>;
      }
    >();

    dates.forEach((date) => {
      const byProducerForDate = producerAggByDate.get(date.key);
      if (!byProducerForDate) return;

      byProducerForDate.forEach((agg, producerId) => {
        if (!byProducer.has(producerId)) {
          const producerName =
            producerId === "unknown" ? "Producteur inconnu" : producersById[producerId]?.name ?? producerId;
          byProducer.set(producerId, {
            producerName,
            orderIds: new Set<string>(),
            totalQuantity: 0,
            totalAmount: 0,
            lines: new Map<string, ProductLineAgg>(),
            byDate: new Map<string, ProducerDateRow>(),
          });
        }
        const bucket = byProducer.get(producerId)!;

        agg.orderIds.forEach((orderId) => bucket.orderIds.add(orderId));
        bucket.totalQuantity += agg.totalQuantity;
        bucket.totalAmount += agg.totalAmount;

        agg.lines.forEach((line, lineKey) => {
          if (!bucket.lines.has(lineKey)) {
            bucket.lines.set(lineKey, { ...line });
            return;
          }
          const current = bucket.lines.get(lineKey)!;
          current.quantity += line.quantity;
          current.lineTotal += line.lineTotal;
        });

        const dateLines = Array.from(agg.lines.values())
          .map((line) => ({ ...line }))
          .sort((a, b) => {
            const left = `${a.label} ${a.variantLabel}`.trim();
            const right = `${b.label} ${b.variantLabel}`.trim();
            return left.localeCompare(right, "fr", { sensitivity: "base" });
          });

        bucket.byDate.set(date.key, {
          dateKey: date.key,
          dateLabel: date.label,
          ordersCount: agg.orderIds.size,
          totalQuantity: agg.totalQuantity,
          totalAmount: agg.totalAmount,
          lines: dateLines,
        });
      });
    });

    return Array.from(byProducer.entries())
      .map(([producerId, bucket]) => {
        const lines = Array.from(bucket.lines.values()).sort((a, b) => {
          const left = `${a.label} ${a.variantLabel}`.trim();
          const right = `${b.label} ${b.variantLabel}`.trim();
          return left.localeCompare(right, "fr", { sensitivity: "base" });
        });
        const dateRows = dates
          .map(
            (date) =>
              bucket.byDate.get(date.key) ?? {
                dateKey: date.key,
                dateLabel: date.label,
                ordersCount: 0,
                totalQuantity: 0,
                totalAmount: 0,
                lines: [],
              },
          )
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

        return {
          producerId,
          producerName: bucket.producerName,
          ordersCount: bucket.orderIds.size,
          totalQuantity: bucket.totalQuantity,
          totalAmount: bucket.totalAmount,
          lines,
          dateRows,
        } satisfies ProducerDistributionRow;
      })
      .filter((row) => row.totalQuantity > 0)
      .sort((a, b) => a.producerName.localeCompare(b.producerName, "fr", { sensitivity: "base" }));
  };

  const buildProducerMatrixForDate = (targetDateKey: string): ProducerMatrix[] => {
    const producerBuckets = new Map<
      string,
      {
        producerName: string;
        columns: Map<string, ProducerMatrixColumn>;
        rowsByMember: Map<string, ProducerMatrixRow>;
      }
    >();

    orders.forEach((order) => {
      const memberId = String(order.memberId ?? "unknown");
      const member = order.memberId ? membersById[order.memberId] : undefined;
      const memberName = memberLabel(member);
      const items = orderItemsByOrder[order.id] ?? [];
      items.forEach((item) => {
        if (String(item.saleDateKey ?? "").trim() !== targetDateKey) return;

        const producerId = String(item.producerId ?? "unknown");
        const producerName =
          producerId === "unknown" ? "Producteur inconnu" : producersById[producerId]?.name ?? producerId;
        if (!producerBuckets.has(producerId)) {
          producerBuckets.set(producerId, {
            producerName,
            columns: new Map<string, ProducerMatrixColumn>(),
            rowsByMember: new Map<string, ProducerMatrixRow>(),
          });
        }
        const producerBucket = producerBuckets.get(producerId)!;

        const label = String(item.label ?? "Produit");
        const variantLabel = String(item.variantLabel ?? "").trim();
        const unitPrice = Number(item.unitPrice ?? 0);
        const productKey = [String(item.productId ?? ""), label, variantLabel, String(unitPrice)].join("||");
        const title = variantLabel ? `${label}\n${variantLabel}` : label;
        if (!producerBucket.columns.has(productKey)) {
          producerBucket.columns.set(productKey, { key: productKey, title, unitPrice });
        }

        if (!producerBucket.rowsByMember.has(memberId)) {
          producerBucket.rowsByMember.set(memberId, {
            memberId,
            memberLabel: memberName,
            quantitiesByProduct: {},
            totalQuantity: 0,
          });
        }
        const row = producerBucket.rowsByMember.get(memberId)!;
        const qty = Number(item.quantity ?? 0);
        row.quantitiesByProduct[productKey] = (row.quantitiesByProduct[productKey] ?? 0) + qty;
        row.totalQuantity += qty;
      });
    });

    return Array.from(producerBuckets.entries())
      .map(([producerId, bucket]) => {
        const columns = Array.from(bucket.columns.values()).sort((a, b) =>
          a.title.localeCompare(b.title, "fr", { sensitivity: "base" }),
        );
        const rows = Array.from(bucket.rowsByMember.values())
          .sort((a, b) => a.memberLabel.localeCompare(b.memberLabel, "fr", { sensitivity: "base" }))
          .filter((row) => row.totalQuantity > 0);

        const totalsByProduct: Record<string, number> = {};
        rows.forEach((row) => {
          columns.forEach((column) => {
            totalsByProduct[column.key] = (totalsByProduct[column.key] ?? 0) + Number(row.quantitiesByProduct[column.key] ?? 0);
          });
        });
        const grandTotal = rows.reduce((sum, row) => sum + row.totalQuantity, 0);

        return {
          producerId,
          producerName: bucket.producerName,
          columns,
          rows,
          totalsByProduct,
          grandTotal,
        };
      })
      .sort((a, b) => a.producerName.localeCompare(b.producerName, "fr", { sensitivity: "base" }));
  };

  const producerRows = useMemo(() => {
    if (!selectedDistributionDates.length) return [] as ProducerDistributionRow[];
    return buildProducerRowsForDistribution(selectedDistributionDates);
  }, [producerAggByDate, producersById, selectedDistributionDates]);

  const previewRow = useMemo(
    () => producerRows.find((row) => row.producerId === previewProducerId) ?? null,
    [previewProducerId, producerRows],
  );

  const matrixRevenue = (matrix: ProducerMatrix) =>
    matrix.rows.reduce(
      (sum, row) =>
        sum +
        matrix.columns.reduce(
          (rowSum, column) =>
            rowSum + Number(row.quantitiesByProduct[column.key] ?? 0) * Number(column.unitPrice ?? 0),
          0,
        ),
      0,
    );

  const previewBdcDateOption = useMemo(
    () => bdcFilteredDateOptions.find((date) => date.key === previewBdcDateKey) ?? null,
    [bdcFilteredDateOptions, previewBdcDateKey],
  );

  useEffect(() => {
    if (!previewBdcDateKey) return;
    if (!bdcFilteredDateOptions.some((date) => date.key === previewBdcDateKey)) {
      setPreviewBdcDateKey(null);
    }
  }, [bdcFilteredDateOptions, previewBdcDateKey]);

  const previewBdcMatrices = useMemo(
    () => (previewBdcDateOption ? buildProducerMatrixForDate(previewBdcDateOption.key) : []),
    [previewBdcDateOption, producerAggByDate, producersById, orders, orderItemsByOrder, membersById],
  );

  const exportProducerDistributionPdf = async (
    distribution: Distribution,
    distributionDates: DateOption[],
    row: ProducerDistributionRow,
  ) => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const logoDataUrl = await ensureLogoDataUrl();

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
      putOnlyUsedFonts: true,
    });

    if (logoDataUrl) {
      const imageType = logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      pdf.addImage(logoDataUrl, imageType, 14, 10, 28, 18);
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Commandes producteurs", 46, 18);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.text(distributionLabel(distribution), 46, 24);

    const datesLabel = distributionDates.map((date) => date.label).join("  •  ");
    if (datesLabel) {
      pdf.setFontSize(9);
      pdf.text(datesLabel, 46, 29);
    }

    pdf.setFontSize(9.5);
    pdf.text(`Producteur: ${row.producerName}`, 14, 39);
    pdf.text(
      `Commandes: ${row.ordersCount}   Quantite: ${formatQuantity(row.totalQuantity)}   Total: ${formatMoney(row.totalAmount)} EUR`,
      14,
      44,
    );

    let cursorY = 50;
    row.dateRows.forEach((dateRow) => {
      if (cursorY > 250) {
        pdf.addPage("a4", "portrait");
        cursorY = 20;
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text(dateRow.dateLabel, 14, cursorY);
      cursorY += 5;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(
        `Commandes: ${dateRow.ordersCount}   Quantite: ${formatQuantity(dateRow.totalQuantity)}   Total: ${formatMoney(dateRow.totalAmount)} EUR`,
        14,
        cursorY,
      );
      cursorY += 4;

      if (!dateRow.lines.length) {
        pdf.setFontSize(8.5);
        pdf.text("Aucune commande sur cette date.", 14, cursorY + 3);
        cursorY += 10;
        return;
      }

      const body = dateRow.lines.map((line) => [
        line.label,
        line.variantLabel || "-",
        formatQuantity(line.quantity),
        formatMoney(line.unitPrice),
        formatMoney(line.lineTotal),
      ]);

      autoTable(pdf, {
        startY: cursorY + 2,
        head: [["Produit", "Variante", "Quantite", "PU", "Total"]],
        body,
        theme: "plain",
        styles: {
          fontSize: 9,
          cellPadding: 1.5,
          textColor: [35, 32, 28],
        },
        headStyles: {
          fontStyle: "bold",
          textColor: [35, 32, 28],
        },
        columnStyles: {
          0: { cellWidth: 68 },
          1: { cellWidth: 44 },
          2: { halign: "right", cellWidth: 22 },
          3: { halign: "right", cellWidth: 22 },
          4: { halign: "right", cellWidth: 24 },
        },
        margin: { left: 14, right: 14 },
        didDrawCell: (hook) => {
          if (hook.section === "head") {
            const y = hook.cell.y + hook.cell.height;
            hook.doc.setDrawColor(190, 186, 178);
            hook.doc.line(
              hook.table.settings.margin.left,
              y,
              hook.doc.internal.pageSize.getWidth() - hook.table.settings.margin.right,
              y,
            );
          }
        },
      });
      const finalY = (
        pdf as unknown as { lastAutoTable?: { finalY?: number } }
      ).lastAutoTable?.finalY;
      cursorY = (finalY ?? cursorY + 2) + 8;
    });

    const producerName = sanitizeFileNamePart(row.producerName || row.producerId || "Producteur");
    const firstDate = distributionDates[0]?.key ? sanitizeFileNamePart(formatDateForFileName(distributionDates[0].key)) : "";
    const lastDate = distributionDates[distributionDates.length - 1]?.key
      ? sanitizeFileNamePart(formatDateForFileName(distributionDates[distributionDates.length - 1].key))
      : "";
    const fileNameSuffix = firstDate && lastDate && firstDate !== lastDate ? `${firstDate} - ${lastDate}` : firstDate || distributionLabel(distribution);
    const fileName = `Commandes producteurs ${producerName} ${sanitizeFileNamePart(fileNameSuffix)}.pdf`;
    pdf.save(fileName);
  };

  const handleExportProducer = async (row: ProducerDistributionRow) => {
    if (!selectedDistribution || selectedDistributionDates.length === 0) return;
    setExportingProducerId(row.producerId);
    setMessage("");
    try {
      await exportProducerDistributionPdf(selectedDistribution, selectedDistributionDates, row);
      setMessage(`PDF exporte: ${row.producerName} (${distributionLabel(selectedDistribution)})`);
    } catch {
      setMessage("Erreur pendant la generation du PDF.");
    } finally {
      setExportingProducerId(null);
    }
  };

  const exportBonDeCommandeByDate = async (date: DateOption) => {
    const matrices = buildProducerMatrixForDate(date.key);
    if (matrices.length === 0) {
      setMessage("Aucune commande pour cette date.");
      return;
    }

    setExportingBdcDateKey(date.key);
    setMessage("");
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const logoDataUrl = await ensureLogoDataUrl();
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
        compress: true,
        putOnlyUsedFonts: true,
      });

      if (logoDataUrl) {
        const imageType = logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        pdf.addImage(logoDataUrl, imageType, 14, 10, 28, 18);
      }

      const totalQty = matrices.reduce((sum, matrix) => sum + matrix.grandTotal, 0);
      const totalCa = matrices.reduce((sum, matrix) => sum + matrixRevenue(matrix), 0);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(17);
      pdf.text("Bon de commande", 46, 18);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(`${date.distributionName ?? "Distribution"} - ${date.label}`, 46, 24);

      pdf.setFontSize(9.5);
      pdf.text(
        `Producteurs: ${matrices.length}   Quantite totale: ${formatQuantity(totalQty)}   CA total: ${formatMoney(totalCa)} EUR`,
        14,
        39,
      );
      pdf.text("Sommaire producteurs", 14, 46);

      autoTable(pdf, {
        startY: 49,
        head: [["Producteur", "Quantites vendues", "CA (EUR)"]],
        body: matrices.map((matrix) => {
          const producerCa = matrixRevenue(matrix);
          return [
            matrix.producerName,
            formatQuantity(matrix.grandTotal),
            formatMoney(producerCa),
          ];
        }),
        theme: "plain",
        styles: {
          fontSize: 9,
          cellPadding: 1.5,
          textColor: [35, 32, 28],
          fontStyle: "bold",
        },
        headStyles: {
          fontStyle: "bold",
          textColor: [35, 32, 28],
        },
        columnStyles: {
          0: { cellWidth: 110 },
          1: { halign: "right", cellWidth: 34 },
          2: { halign: "right", cellWidth: 34 },
        },
        margin: { left: 14, right: 14 },
        didDrawCell: (hook) => {
          if (hook.section === "head") {
            const y = hook.cell.y + hook.cell.height;
            hook.doc.setDrawColor(190, 186, 178);
            hook.doc.line(
              hook.table.settings.margin.left,
              y,
              hook.doc.internal.pageSize.getWidth() - hook.table.settings.margin.right,
              y,
            );
          }
        },
      });

      matrices.forEach((matrix) => {
        pdf.addPage("a4", "landscape");
        if (logoDataUrl) {
          const imageType = logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          pdf.addImage(logoDataUrl, imageType, 14, 10, 22, 14);
        }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.text(matrix.producerName, 40, 18);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text(`${date.distributionName ?? "Distribution"} - ${date.label}`, 40, 23);

        const producerCa = matrixRevenue(matrix);
        pdf.text(
          `Produits vendus: ${formatQuantity(matrix.grandTotal)}   CA: ${formatMoney(producerCa)} EUR`,
          14,
          32,
        );

        const pageWidth = pdf.internal.pageSize.getWidth();
        const marginLeft = 10;
        const marginRight = 10;
        const firstColWidth = 52;
        const totalColWidth = 16;
        const availableWidth = pageWidth - marginLeft - marginRight - firstColWidth - totalColWidth;
        const perProductColWidth = Math.max(
          10,
          Math.min(26, Math.floor(availableWidth / Math.max(1, matrix.columns.length))),
        );

        const headRow = [
          "",
          ...matrix.columns.map((column) => column.title),
          "Total",
        ];
        const priceRow = [
          "PRIX UNITAIRE",
          ...matrix.columns.map((column) => `${formatMoney(column.unitPrice)} €`),
          "",
        ];
        const memberRows = matrix.rows.map((row) => [
          row.memberLabel,
          ...matrix.columns.map((column) => {
            const qty = Number(row.quantitiesByProduct[column.key] ?? 0);
            return qty > 0 ? formatQuantity(qty) : "";
          }),
          formatQuantity(row.totalQuantity),
        ]);
        const totalRow = [
          "Total général",
          ...matrix.columns.map((column) => formatQuantity(Number(matrix.totalsByProduct[column.key] ?? 0))),
          formatQuantity(matrix.grandTotal),
        ];

        autoTable(pdf, {
          startY: 36,
          head: [headRow],
          body: [priceRow, ...memberRows, totalRow],
          theme: "grid",
          styles: {
            fontSize: 8.5,
            cellPadding: 1.2,
            textColor: [35, 32, 28],
            valign: "middle",
            fontStyle: "bold",
            lineColor: [40, 40, 40],
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: [255, 255, 255],
            fontStyle: "bold",
            textColor: [35, 32, 28],
            lineColor: [40, 40, 40],
            lineWidth: 0.2,
          },
          bodyStyles: {
            lineColor: [40, 40, 40],
            lineWidth: 0.2,
          },
          columnStyles: Object.fromEntries([
            [0, { cellWidth: firstColWidth, halign: "left", fontStyle: "bold" }],
            ...matrix.columns.map((_, index) => [
              index + 1,
              { cellWidth: perProductColWidth, halign: "center" },
            ]),
            [matrix.columns.length + 1, { cellWidth: totalColWidth, halign: "center", fontStyle: "bold" }],
          ]),
          margin: { left: marginLeft, right: marginRight },
          didDrawCell: (hook) => {
            const raw = hook.cell.raw;
            if (
              hook.section === "body" &&
              Array.isArray(raw) &&
              (raw[0] === "PRIX UNITAIRE" || raw[0] === "Total général")
            ) {
              hook.cell.styles.fontStyle = "bold";
            }
          },
        });
      });

      const dateLabel = sanitizeFileNamePart(formatDateForFileName(date.key));
      const fileName = `Bon de commande ${dateLabel}.pdf`;
      pdf.save(fileName);
      setMessage(`Bon de commande exporte: ${date.label}`);
    } catch {
      setMessage("Erreur pendant l'export du bon de commande.");
    } finally {
      setExportingBdcDateKey(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-ink/70">Chargement...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-clay/70 bg-white/90 p-5 shadow-card">
        <h2 className="font-serif text-3xl">Générations PDF</h2>
        <p className="mt-2 text-sm text-ink/70">
          Selectionne une distribution, puis exporte producteur par producteur (un PDF avec les 3 dates).
        </p>
        <p className="mt-1 text-xs text-ink/60">Affichage limite aux distributions ouvertes ou finies.</p>
      </section>

      <section className="rounded-2xl border border-clay/70 bg-white/90 p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-serif text-2xl">Récap producteurs</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-1">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink/80">
            Distribution
            <select
              value={selectedDistributionId}
              onChange={(event) => {
                setSelectedDistributionId(event.target.value);
                setPreviewProducerId(null);
              }}
              className="rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-normal"
            >
              {distributions.map((distribution) => (
                <option key={distribution.id} value={distribution.id}>
                  {distributionLabel(distribution)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {selectedDistributionDates.map((date, index) => (
            <span
              key={`producer-date-${date.key}`}
              className="rounded-full border border-clay/80 bg-stone px-3 py-1 text-xs font-semibold text-ink/80"
            >
              Date {index + 1}: {date.label}
            </span>
          ))}
          {selectedDistributionDates.length === 0 ? (
            <span className="text-xs text-ink/65">Aucune date pour cette distribution.</span>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto border border-clay/70 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-clay/70 bg-stone/80">
              <tr>
                <th className="px-3 py-2 font-semibold text-ink">Producteur</th>
                <th className="px-3 py-2 font-semibold text-ink">Commandes</th>
                <th className="px-3 py-2 font-semibold text-ink">Quantite</th>
                <th className="px-3 py-2 font-semibold text-ink">Total</th>
                <th className="px-3 py-2 font-semibold text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {producerRows.map((row) => (
                <tr key={row.producerId} className="border-b border-clay/50">
                  <td className="px-3 py-2">{row.producerName}</td>
                  <td className="px-3 py-2">{row.ordersCount}</td>
                  <td className="px-3 py-2">{formatQuantity(row.totalQuantity)}</td>
                  <td className="px-3 py-2">{formatMoney(row.totalAmount)} EUR</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Voir ${row.producerName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-clay/80 bg-white text-ink transition hover:border-forest/60 hover:text-forest"
                        onClick={() => setPreviewProducerId(row.producerId)}
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
                        aria-label={`Exporter ${row.producerName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ink/20 bg-white text-ink transition hover:border-forest/60 hover:text-forest disabled:opacity-50"
                        onClick={() => handleExportProducer(row).catch(() => undefined)}
                        disabled={Boolean(exportingProducerId)}
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
                          <path d="M12 3v12" />
                          <path d="M7 10l5 5 5-5" />
                          <path d="M4 20h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {producerRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-ink/60">
                    Aucun producteur commande sur cette distribution.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {message ? <p className="mt-3 text-sm text-ink/70">{message}</p> : null}
      </section>

      <section className="rounded-2xl border border-clay/70 bg-white/90 p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl">Bon de commande</h3>
            <p className="mt-1 text-sm text-ink/70">
              Un PDF multi-pages par date: page 1 sommaire producteurs, puis recap produit x adherent par producteur.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink/80">
            Distribution
            <select
              value={selectedBdcDistributionId}
              onChange={(event) => {
                setSelectedBdcDistributionId(event.target.value);
                setPreviewBdcDateKey(null);
              }}
              className="rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-normal"
            >
              <option value="all">Toutes les distributions ouvertes ou finies</option>
              {distributions.map((distribution) => (
                <option key={`bdc-filter-${distribution.id}`} value={distribution.id}>
                  {distributionLabel(distribution)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto border border-clay/70 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-clay/70 bg-stone/80">
              <tr>
                <th className="px-3 py-2 font-semibold text-ink">Date</th>
                <th className="px-3 py-2 font-semibold text-ink">Distribution</th>
                <th className="px-3 py-2 font-semibold text-ink">Producteurs</th>
                <th className="px-3 py-2 font-semibold text-ink">CA total</th>
                <th className="px-3 py-2 font-semibold text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bdcFilteredDateOptions.map((date) => {
                const rows = buildProducerRowsForDate(date.key);
                const totalCa = rows.reduce((sum, row) => sum + row.totalAmount, 0);
                return (
                  <tr key={`bdc-${date.key}`} className="border-b border-clay/50">
                    <td className="px-3 py-2">{date.label}</td>
                    <td className="px-3 py-2">{date.distributionName ?? "-"}</td>
                    <td className="px-3 py-2">{rows.length}</td>
                    <td className="px-3 py-2">{formatMoney(totalCa)} EUR</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Apercu bon de commande ${date.label}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-clay/80 bg-white text-ink transition hover:border-forest/60 hover:text-forest disabled:opacity-50"
                          onClick={() => setPreviewBdcDateKey(date.key)}
                          disabled={rows.length === 0}
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
                          className="rounded-md border border-ink/20 bg-white px-3 py-1 text-xs font-semibold text-ink disabled:opacity-50"
                          onClick={() => exportBonDeCommandeByDate(date).catch(() => undefined)}
                          disabled={rows.length === 0 || Boolean(exportingBdcDateKey)}
                        >
                          {exportingBdcDateKey === date.key ? "Export..." : "Exporter bon de commande"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {bdcFilteredDateOptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-ink/60">
                    Aucune date disponible.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {previewRow && selectedDistribution ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-clay/80 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-clay/70 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Apercu producteur</p>
                <h3 className="mt-1 font-serif text-2xl text-ink">{previewRow.producerName}</h3>
                <p className="mt-1 text-sm text-ink/70">{distributionLabel(selectedDistribution)}</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-clay/80 px-3 py-1 text-sm font-semibold text-ink hover:border-ink/40"
                onClick={() => setPreviewProducerId(null)}
              >
                Fermer
              </button>
            </div>

            <div className="grid gap-3 border-b border-clay/70 px-5 py-3 text-sm text-ink/80 md:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Commandes</p>
                <p className="font-semibold">{previewRow.ordersCount}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Quantite</p>
                <p className="font-semibold">{formatQuantity(previewRow.totalQuantity)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink/55">Total</p>
                <p className="font-semibold">{formatMoney(previewRow.totalAmount)} EUR</p>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-auto p-4">
              <div className="flex flex-col gap-4">
                {previewRow.dateRows.map((dateRow) => (
                  <div key={`preview-producer-date-${dateRow.dateKey}`} className="rounded-lg border border-clay/70 bg-stone/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{dateRow.dateLabel}</p>
                      <p className="text-xs font-semibold text-ink/80">
                        Commandes: {dateRow.ordersCount} · Quantite: {formatQuantity(dateRow.totalQuantity)} · Total: {formatMoney(dateRow.totalAmount)} EUR
                      </p>
                    </div>
                    {dateRow.lines.length ? (
                      <div className="overflow-x-auto border border-clay/70 bg-white">
                        <table className="min-w-full text-left text-sm">
                          <thead className="border-b border-clay/70 bg-stone/80">
                            <tr>
                              <th className="px-3 py-2 font-semibold text-ink">Produit</th>
                              <th className="px-3 py-2 font-semibold text-ink">Variante</th>
                              <th className="px-3 py-2 font-semibold text-ink">Quantite</th>
                              <th className="px-3 py-2 font-semibold text-ink">Prix unitaire</th>
                              <th className="px-3 py-2 font-semibold text-ink">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dateRow.lines.map((line) => (
                              <tr key={`${dateRow.dateKey}-${line.key}`} className="border-b border-clay/50">
                                <td className="px-3 py-2">{line.label}</td>
                                <td className="px-3 py-2">{line.variantLabel || "-"}</td>
                                <td className="px-3 py-2">{formatQuantity(line.quantity)}</td>
                                <td className="px-3 py-2">{formatMoney(line.unitPrice)} EUR</td>
                                <td className="px-3 py-2">{formatMoney(line.lineTotal)} EUR</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-ink/65">Aucune commande sur cette date.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewBdcDateOption ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 px-4 py-8">
          <div className="max-h-[92vh] w-full max-w-[1300px] overflow-hidden rounded-xl border border-clay/80 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-clay/70 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Apercu bon de commande</p>
                <h3 className="mt-1 font-serif text-2xl text-ink">
                  {previewBdcDateOption.distributionName ?? "Distribution"} - {previewBdcDateOption.label}
                </h3>
              </div>
              <button
                type="button"
                className="rounded-full border border-clay/80 px-3 py-1 text-sm font-semibold text-ink hover:border-ink/40"
                onClick={() => setPreviewBdcDateKey(null)}
              >
                Fermer
              </button>
            </div>

            <div className="max-h-[80vh] overflow-auto p-4">
              <div className="mb-4 overflow-x-auto border border-clay/70 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-clay/70 bg-stone/80">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-ink">Producteur</th>
                      <th className="px-3 py-2 font-semibold text-ink">Quantites vendues</th>
                      <th className="px-3 py-2 font-semibold text-ink">CA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewBdcMatrices.map((matrix) => (
                      <tr key={`preview-sum-${matrix.producerId}`} className="border-b border-clay/50">
                        <td className="px-3 py-2">{matrix.producerName}</td>
                        <td className="px-3 py-2">{formatQuantity(matrix.grandTotal)}</td>
                        <td className="px-3 py-2">{formatMoney(matrixRevenue(matrix))} EUR</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4">
                {previewBdcMatrices.map((matrix) => (
                  <div key={`preview-matrix-${matrix.producerId}`} className="rounded-lg border border-clay/70 bg-stone/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{matrix.producerName}</p>
                      <p className="text-xs font-semibold text-ink/80">
                        Quantites: {formatQuantity(matrix.grandTotal)} · CA: {formatMoney(matrixRevenue(matrix))} EUR
                      </p>
                    </div>
                    <div className="overflow-x-auto border border-clay/70 bg-white">
                      <table className="min-w-[900px] text-left text-sm">
                        <thead className="border-b border-clay/70 bg-stone/80">
                          <tr>
                            <th className="px-2 py-2 font-semibold text-ink">Adherent</th>
                            {matrix.columns.map((column) => (
                              <th key={`head-${matrix.producerId}-${column.key}`} className="px-2 py-2 text-center font-semibold text-ink whitespace-pre-line">
                                {column.title}
                              </th>
                            ))}
                            <th className="px-2 py-2 text-center font-semibold text-ink">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-clay/50 bg-stone/40 font-semibold">
                            <td className="px-2 py-1.5">PRIX UNITAIRE</td>
                            {matrix.columns.map((column) => (
                              <td key={`price-${matrix.producerId}-${column.key}`} className="px-2 py-1.5 text-center">
                                {formatMoney(column.unitPrice)} €
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-center">-</td>
                          </tr>
                          {matrix.rows.map((row) => (
                            <tr key={`member-${matrix.producerId}-${row.memberId}`} className="border-b border-clay/50">
                              <td className="px-2 py-1.5">{row.memberLabel}</td>
                              {matrix.columns.map((column) => {
                                const qty = Number(row.quantitiesByProduct[column.key] ?? 0);
                                return (
                                  <td key={`qty-${matrix.producerId}-${row.memberId}-${column.key}`} className="px-2 py-1.5 text-center">
                                    {qty > 0 ? formatQuantity(qty) : ""}
                                  </td>
                                );
                              })}
                              <td className="px-2 py-1.5 text-center font-semibold">{formatQuantity(row.totalQuantity)}</td>
                            </tr>
                          ))}
                          <tr className="bg-stone/40 font-semibold">
                            <td className="px-2 py-1.5">Total general</td>
                            {matrix.columns.map((column) => (
                              <td key={`total-${matrix.producerId}-${column.key}`} className="px-2 py-1.5 text-center">
                                {formatQuantity(Number(matrix.totalsByProduct[column.key] ?? 0))}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-center">{formatQuantity(matrix.grandTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
