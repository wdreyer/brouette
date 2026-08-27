import { describe, expect, it } from "vitest";
import { estimatedUnitPrice, estimateWeightedItemsTotal, hasWeightedEstimate } from "@/lib/orderEstimates";

describe("orderEstimates", () => {
  it("uses the midpoint when a min and max estimate are available", () => {
    expect(estimatedUnitPrice(10, 14)).toBe(12);
  });

  it("computes only weighted product estimates", () => {
    const total = estimateWeightedItemsTotal([
      { isSoldByWeight: true, estimatedPriceMin: 10, estimatedPriceMax: 14, quantity: 2 },
      { isSoldByWeight: false, estimatedPriceMin: 100, estimatedPriceMax: 200, quantity: 1 },
      { isSoldByWeight: true, estimatedPriceMin: null, estimatedPriceMax: 5, quantity: 3 },
    ]);

    expect(total).toBe(39);
  });

  it("detects when at least one weighted product has an estimate", () => {
    expect(hasWeightedEstimate([{ isSoldByWeight: true, estimatedPriceMin: null, estimatedPriceMax: null }])).toBe(false);
    expect(hasWeightedEstimate([{ isSoldByWeight: true, estimatedPriceMin: 8, estimatedPriceMax: null }])).toBe(true);
  });
});
