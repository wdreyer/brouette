import { describe, expect, it } from "vitest";
import {
  SAMPLE_ORDER_CONFIRMATION,
  buildOrderConfirmationHtmlContent,
  buildOrderConfirmationTextContent,
} from "@/lib/orderConfirmationEmail";

describe("orderConfirmationEmail", () => {
  it("renders the sample order without crashing and includes the totals", () => {
    const html = buildOrderConfirmationHtmlContent(SAMPLE_ORDER_CONFIRMATION);

    expect(html).toContain("Commande confirmee");
    expect(html).toContain("15,20 EUR");
    expect(html).toContain("10,00 EUR");
    expect(html).toContain("Pommes Golden");
    expect(html).toContain("Le Verger d'Automne");
  });

  it("escapes html found in producer or product names", () => {
    const html = buildOrderConfirmationHtmlContent({
      orderId: "order-1",
      producerLabels: { "p1": "<script>alert(1)</script>" },
      items: [
        {
          id: "i1",
          producerId: "p1",
          label: "<b>Produit</b>",
          variantLabel: "Unite",
          quantity: 1,
          unitPrice: 5,
          lineTotal: 5,
          saleDateKey: "2026-08-29",
          saleDateLabel: "Samedi",
        },
      ],
      totalAmount: 5,
      weightedEstimateTotal: 0,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Produit</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits the weighted estimate block when there is nothing sold by weight", () => {
    const html = buildOrderConfirmationHtmlContent({
      orderId: "order-1",
      producerLabels: {},
      items: [],
      totalAmount: 12,
      weightedEstimateTotal: 0,
    });

    expect(html).not.toContain("Produits au poids");
  });

  it("keeps the text version in sync with totals", () => {
    const text = buildOrderConfirmationTextContent(SAMPLE_ORDER_CONFIRMATION);

    expect(text).toContain("Total commande: 15,20 EUR");
    expect(text).toContain("Total estime: ~25,20 EUR");
  });
});
