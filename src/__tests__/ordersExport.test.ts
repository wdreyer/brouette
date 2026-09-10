import { describe, expect, it } from "vitest";
import { buildOrdersExportCsv } from "@/lib/ordersExport";

describe("ordersExport", () => {
  it("keeps weighted products in the CSV with zero amounts and a marker column", () => {
    const csv = buildOrdersExportCsv([
      {
        orderDate: "10/09/2026",
        member: "DUPONT Alice",
        memberEmail: "alice@example.com",
        retrait: "16/09/2026",
        producer: "Producteur poisson",
        product: "Filet de poisson",
        variant: "",
        qty: 2,
        isSoldByWeight: true,
        unitPrice: 12.5,
        total: 25,
      },
    ]);

    expect(csv).toContain("Produit au poids");
    expect(csv).toContain("Filet de poisson");
    expect(csv).toContain("Oui;0,00;0,00");
  });

  it("keeps normal product amounts unchanged", () => {
    const csv = buildOrdersExportCsv([
      {
        orderDate: "10/09/2026",
        member: "DUPONT Alice",
        memberEmail: "alice@example.com",
        retrait: "16/09/2026",
        producer: "Maraicher",
        product: "Carottes",
        variant: "1 kg",
        qty: 3,
        isSoldByWeight: false,
        unitPrice: 2.4,
        total: 7.2,
      },
    ]);

    expect(csv).toContain("Non;2,40;7,20");
  });
});
