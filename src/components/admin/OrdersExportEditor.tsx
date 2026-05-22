"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type OrderItem = {
  saleDateKey?: string | null;
  saleDateLabel?: string | null;
  producerId?: string | null;
  label?: string | null;
  variantLabel?: string | null;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  isSoldByWeight?: boolean;
};

type Order = {
  id: string;
  createdAt?: Timestamp | null;
  memberId?: string | null;
  memberSnapshot?: { email?: string | null } | null;
  status?: string | null;
};

type Member = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type Producer = {
  id: string;
  name?: string;
};

function formatDateKey(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function memberLabel(member?: Member | null) {
  if (!member) return "";
  const first = String(member.firstName ?? "").trim();
  const last = String(member.lastName ?? "").trim();
  return `${last} ${first}`.trim();
}

function escapeCsv(value: string) {
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(
  rows: Array<{
    orderDate: string;
    member: string;
    memberEmail: string;
    retrait: string;
    producer: string;
    product: string;
    variant: string;
    qty: number;
    unitPrice: number;
    total: number;
  }>,
): string {
  const headers = [
    "Date commande",
    "Adhérent",
    "Email",
    "Date retrait",
    "Producteur",
    "Produit",
    "Variante",
    "Quantité",
    "Prix unitaire (EUR)",
    "Total (EUR)",
  ];

  const lines = [
    headers.map(escapeCsv).join(";"),
    ...rows.map((row) =>
      [
        escapeCsv(row.orderDate),
        escapeCsv(row.member),
        escapeCsv(row.memberEmail),
        escapeCsv(row.retrait),
        escapeCsv(row.producer),
        escapeCsv(row.product),
        escapeCsv(row.variant),
        String(row.qty),
        row.unitPrice.toFixed(2).replace(".", ","),
        row.total.toFixed(2).replace(".", ","),
      ].join(";"),
    ),
  ];
  return lines.join("\r\n");
}

function downloadCsv(content: string, fileName: string) {
  const bom = "﻿";
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function OrdersExportEditor() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [membersById, setMembersById] = useState<Record<string, Member>>({});
  const [producersById, setProducersById] = useState<Record<string, Producer>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [membersSnap, producersSnap] = await Promise.all([
        getDocs(collection(firebaseDb, "members")),
        getDocs(collection(firebaseDb, "producers")),
      ]);
      const members: Record<string, Member> = {};
      membersSnap.docs.forEach((doc) => {
        members[doc.id] = { id: doc.id, ...(doc.data() as Omit<Member, "id">) };
      });
      const producers: Record<string, Producer> = {};
      producersSnap.docs.forEach((doc) => {
        producers[doc.id] = { id: doc.id, ...(doc.data() as Omit<Producer, "id">) };
      });
      setMembersById(members);
      setProducersById(producers);
      setLoaded(true);
    };
    load().catch(() => setLoaded(true));
  }, []);

  const handleExport = async () => {
    if (!from || !to) {
      setMessage("Veuillez sélectionner une période.");
      return;
    }

    setExporting(true);
    setMessage("");

    try {
      const fromDate = new Date(`${from}T00:00:00.000Z`);
      const toDate = new Date(`${to}T23:59:59.999Z`);
      const fromTs = Timestamp.fromDate(fromDate);
      const toTs = Timestamp.fromDate(toDate);

      const ordersSnap = await getDocs(
        query(
          collection(firebaseDb, "orders"),
          where("createdAt", ">=", fromTs),
          where("createdAt", "<=", toTs),
          orderBy("createdAt", "asc"),
        ),
      );

      const orders = ordersSnap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Order, "id">),
      }));

      if (orders.length === 0) {
        setMessage("Aucune commande sur cette période.");
        setExporting(false);
        return;
      }

      const itemsByOrder: Record<string, OrderItem[]> = {};
      await Promise.all(
        orders.map(async (order) => {
          const itemsSnap = await getDocs(collection(firebaseDb, "orders", order.id, "items"));
          itemsByOrder[order.id] = itemsSnap.docs.map((doc) => doc.data() as OrderItem);
        }),
      );

      const rows: Parameters<typeof buildCsv>[0] = [];

      for (const order of orders) {
        const member = order.memberId ? membersById[order.memberId] ?? null : null;
        const memberName = memberLabel(member) || String(order.memberSnapshot?.email ?? "");
        const memberEmail = member?.email ?? String(order.memberSnapshot?.email ?? "");
        const orderDate = order.createdAt
          ? order.createdAt.toDate().toLocaleDateString("fr-FR")
          : "";

        const items = itemsByOrder[order.id] ?? [];
        for (const item of items) {
          if (item.isSoldByWeight) continue;

          const producer = item.producerId ? producersById[item.producerId] : null;
          rows.push({
            orderDate,
            member: memberName,
            memberEmail,
            retrait: item.saleDateKey ? formatDateKey(item.saleDateKey) : (item.saleDateLabel ?? ""),
            producer: producer?.name ?? item.producerId ?? "",
            product: item.label ?? "",
            variant: item.variantLabel ?? "",
            qty: Number(item.quantity ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            total: Number(item.lineTotal ?? 0),
          });
        }
      }

      if (rows.length === 0) {
        setMessage("Aucune ligne exportable sur cette période (tous les produits sont au poids).");
        setExporting(false);
        return;
      }

      const csv = buildCsv(rows);
      const fileName = `Commandes_${from}_${to}.csv`;
      downloadCsv(csv, fileName);

      const totalAmount = rows.reduce((sum, row) => sum + row.total, 0);
      setMessage(
        `Export terminé : ${orders.length} commande(s), ${rows.length} ligne(s), total ${totalAmount.toFixed(2).replace(".", ",")} EUR.`,
      );
    } catch {
      setMessage("Erreur lors de l'export. Veuillez réessayer.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-clay/70 bg-white/90 p-5 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">Export</p>
        <h2 className="mt-1 font-serif text-3xl text-ink">Export des commandes</h2>
        <p className="mt-2 text-sm text-ink/70">
          Génère un fichier CSV des commandes validées sur une période. Les produits au poids (prix
          à définir le jour J) sont exclus.
        </p>
      </section>

      <section className="rounded-2xl border border-clay/70 bg-white p-5 shadow-card">
        <h3 className="mb-4 text-lg font-semibold text-ink">Période</h3>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink/80">
            Du
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink/80">
            Au
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <button
            type="button"
            onClick={() => handleExport().catch(() => undefined)}
            disabled={exporting || !loaded}
            className="rounded-full bg-forest px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {exporting ? "Export en cours..." : "Télécharger CSV"}
          </button>
        </div>

        {message ? (
          <p className={`mt-4 text-sm ${message.startsWith("Erreur") ? "text-ember" : "text-forest"}`}>
            {message}
          </p>
        ) : null}

        <div className="mt-6 rounded-xl border border-clay/60 bg-stone/50 p-4 text-xs text-ink/65">
          <p className="font-semibold text-ink/80 mb-1">Colonnes exportées :</p>
          Date commande · Adhérent · Email · Date retrait · Producteur · Produit · Variante ·
          Quantité · Prix unitaire · Total
          <br />
          <span className="mt-1 block text-ink/55">
            Produits au poids exclus (montant à définir lors du retrait).
          </span>
        </div>
      </section>
    </div>
  );
}
