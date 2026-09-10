export type OrdersExportRow = {
  orderDate: string;
  member: string;
  memberEmail: string;
  retrait: string;
  producer: string;
  product: string;
  variant: string;
  qty: number;
  isSoldByWeight: boolean;
  unitPrice: number;
  total: number;
};

export function escapeCsv(value: string) {
  if (value.includes(";") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildOrdersExportCsv(rows: OrdersExportRow[]): string {
  const headers = [
    "Date commande",
    "Adhérent",
    "Email",
    "Date retrait",
    "Producteur",
    "Produit",
    "Variante",
    "Quantité",
    "Produit au poids",
    "Prix unitaire (EUR)",
    "Total (EUR)",
  ];

  const lines = [
    headers.map(escapeCsv).join(";"),
    ...rows.map((row) => {
      const unitPrice = row.isSoldByWeight ? 0 : row.unitPrice;
      const total = row.isSoldByWeight ? 0 : row.total;

      return [
        escapeCsv(row.orderDate),
        escapeCsv(row.member),
        escapeCsv(row.memberEmail),
        escapeCsv(row.retrait),
        escapeCsv(row.producer),
        escapeCsv(row.product),
        escapeCsv(row.variant),
        String(row.qty),
        row.isSoldByWeight ? "Oui" : "Non",
        unitPrice.toFixed(2).replace(".", ","),
        total.toFixed(2).replace(".", ","),
      ].join(";");
    }),
  ];

  return lines.join("\r\n");
}
