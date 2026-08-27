export type WeightedEstimateItem = {
  quantity?: number;
  isSoldByWeight?: boolean;
  estimatedPriceMin?: number | null;
  estimatedPriceMax?: number | null;
};

function validAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function estimatedUnitPrice(min?: number | null, max?: number | null) {
  const hasMin = validAmount(min);
  const hasMax = validAmount(max);
  if (hasMin && hasMax) return (min! + max!) / 2;
  if (hasMin) return min!;
  if (hasMax) return max!;
  return null;
}

export function estimateWeightedItemsTotal(items: WeightedEstimateItem[]) {
  return items.reduce((sum, item) => {
    if (!item.isSoldByWeight) return sum;
    const unitEstimate = estimatedUnitPrice(item.estimatedPriceMin, item.estimatedPriceMax);
    if (unitEstimate === null) return sum;
    const quantity = typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 0;
    return sum + unitEstimate * quantity;
  }, 0);
}

export function hasWeightedEstimate(items: WeightedEstimateItem[]) {
  return items.some(
    (item) =>
      Boolean(item.isSoldByWeight) &&
      estimatedUnitPrice(item.estimatedPriceMin, item.estimatedPriceMax) !== null,
  );
}
