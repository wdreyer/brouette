import { estimatedUnitPrice } from "@/lib/orderEstimates";

export type OrderConfirmationItem = {
  id: string;
  producerId?: string;
  label?: string;
  variantLabel?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  saleDateKey?: string | null;
  saleDateLabel?: string | null;
  isSoldByWeight?: boolean;
  estimatedPriceMin?: number | null;
  estimatedPriceMax?: number | null;
};

export type OrderConfirmationParams = {
  orderId: string;
  items: OrderConfirmationItem[];
  producerLabels: Record<string, string>;
  totalAmount: number;
  weightedEstimateTotal: number;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount: number) {
  return amount.toFixed(2).replace(".", ",");
}

function formatEstimatedPrice(item: OrderConfirmationItem) {
  const estimate = estimatedUnitPrice(item.estimatedPriceMin, item.estimatedPriceMax);
  if (estimate === null) return "Prix final au retrait";
  return `~${formatMoney(estimate)} EUR`;
}

function groupItems(items: OrderConfirmationItem[], producerLabels: Record<string, string>) {
  const byDate = new Map<string, { label: string; items: OrderConfirmationItem[] }>();
  items.forEach((item) => {
    const key = String(item.saleDateKey ?? "no-date");
    const label = String(item.saleDateLabel ?? "Date non definie");
    const entry = byDate.get(key) ?? { label, items: [] };
    entry.items.push(item);
    byDate.set(key, entry);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, dateGroup]) => {
      const rows = [...dateGroup.items].sort((a, b) => {
        const producerA = producerLabels[String(a.producerId ?? "")] ?? "";
        const producerB = producerLabels[String(b.producerId ?? "")] ?? "";
        if (producerA !== producerB) return producerA.localeCompare(producerB, "fr");
        return String(a.label ?? "").localeCompare(String(b.label ?? ""), "fr");
      });
      return { key, label: dateGroup.label, items: rows };
    });
}

export function buildOrderConfirmationTextContent(params: OrderConfirmationParams) {
  const lines = [
    "Bonjour,",
    "",
    "Ta commande a bien ete validee.",
    "",
    `Commande: ${params.orderId}`,
    `Total commande: ${formatMoney(params.totalAmount)} EUR`,
  ];

  if (params.weightedEstimateTotal > 0) {
    lines.push(`Produits au poids: ~${formatMoney(params.weightedEstimateTotal)} EUR`);
    lines.push(`Total estime: ~${formatMoney(params.totalAmount + params.weightedEstimateTotal)} EUR`);
  }

  lines.push("", "Details:");
  groupItems(params.items, params.producerLabels).forEach((dateGroup) => {
    lines.push("", dateGroup.label);
    dateGroup.items.forEach((item) => {
      const producer = params.producerLabels[String(item.producerId ?? "")] ?? "Producteur";
      const quantity = Number(item.quantity ?? 0);
      const amount = item.isSoldByWeight
        ? formatEstimatedPrice(item)
        : `${formatMoney(Number(item.lineTotal ?? 0))} EUR`;
      lines.push(`- ${producer} - ${item.label ?? "Produit"} (${item.variantLabel ?? "-"}) x${quantity}: ${amount}`);
    });
  });

  lines.push("", "Paiement sur place lors du retrait.", "", "A bientot,", "La Brouette");
  return lines.join("\n");
}

export function buildOrderConfirmationHtmlContent(params: OrderConfirmationParams) {
  const dateGroups = groupItems(params.items, params.producerLabels);
  const estimatedTotal = params.totalAmount + params.weightedEstimateTotal;

  return `
    <div style="font-family:Arial,sans-serif;color:#2f2a24;font-size:15px;line-height:1.5">
      <h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 12px">Commande confirmee</h1>
      <p>Bonjour,</p>
      <p>Ta commande a bien ete validee.</p>
      <div style="margin:18px 0;padding:14px;border:1px solid #ddd1bd;background:#fbf8f1">
        <p style="margin:0 0 6px"><strong>Total commande:</strong> ${formatMoney(params.totalAmount)} EUR</p>
        ${
          params.weightedEstimateTotal > 0
            ? `<p style="margin:0 0 6px"><strong>Produits au poids:</strong> ~${formatMoney(params.weightedEstimateTotal)} EUR</p>
               <p style="margin:0"><strong>Total estime:</strong> ~${formatMoney(estimatedTotal)} EUR</p>`
            : ""
        }
      </div>
      ${dateGroups
        .map(
          (dateGroup) => `
            <h2 style="font-family:Georgia,serif;font-size:20px;margin:20px 0 8px">${escapeHtml(dateGroup.label)}</h2>
            <table style="width:100%;border-collapse:collapse">
              <tbody>
                ${dateGroup.items
                  .map((item) => {
                    const producer = params.producerLabels[String(item.producerId ?? "")] ?? "Producteur";
                    const amount = item.isSoldByWeight
                      ? formatEstimatedPrice(item)
                      : `${formatMoney(Number(item.lineTotal ?? 0))} EUR`;
                    return `
                      <tr>
                        <td style="border-top:1px solid #e5dac8;padding:8px 6px">
                          <strong>${escapeHtml(item.label ?? "Produit")}</strong><br/>
                          <span style="color:#6f675c">${escapeHtml(producer)} - ${escapeHtml(item.variantLabel ?? "-")}</span>
                        </td>
                        <td style="border-top:1px solid #e5dac8;padding:8px 6px;text-align:center">x${Number(item.quantity ?? 0)}</td>
                        <td style="border-top:1px solid #e5dac8;padding:8px 6px;text-align:right">${escapeHtml(amount)}</td>
                      </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>`
        )
        .join("")}
      <p style="margin-top:18px">Paiement sur place lors du retrait.</p>
      <p>A bientot,<br/>La Brouette</p>
    </div>`;
}

export const ORDER_CONFIRMATION_SUBJECT = "Confirmation de commande - La Brouette";

export const SAMPLE_ORDER_CONFIRMATION: OrderConfirmationParams = {
  orderId: "exemple-commande",
  producerLabels: {
    "producer-verger": "Le Verger d'Automne",
    "producer-ferme": "Ferme des Trois Chenes",
  },
  items: [
    {
      id: "item-1",
      producerId: "producer-verger",
      label: "Pommes Golden",
      variantLabel: "Cageot",
      quantity: 1,
      isSoldByWeight: true,
      estimatedPriceMin: 8,
      estimatedPriceMax: 12,
      saleDateKey: "2026-08-29",
      saleDateLabel: "Samedi 29 aout",
    },
    {
      id: "item-2",
      producerId: "producer-verger",
      label: "Jus de pomme",
      variantLabel: "Bouteille 1L",
      quantity: 2,
      unitPrice: 4.5,
      lineTotal: 9,
      saleDateKey: "2026-08-29",
      saleDateLabel: "Samedi 29 aout",
    },
    {
      id: "item-3",
      producerId: "producer-ferme",
      label: "Fromage de chevre",
      variantLabel: "Buche 200g",
      quantity: 1,
      unitPrice: 6.2,
      lineTotal: 6.2,
      saleDateKey: "2026-08-29",
      saleDateLabel: "Samedi 29 aout",
    },
  ],
  totalAmount: 15.2,
  weightedEstimateTotal: 10,
};
