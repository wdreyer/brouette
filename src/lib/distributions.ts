export type DistributionLike = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
};

const OPEN_STATUSES = new Set(["open", "ouverte", "ouvertes"]);

export function isOpenStatus(status?: string) {
  return OPEN_STATUSES.has(String(status ?? ""));
}

export function pickOpenDistribution<T extends DistributionLike>(items: T[]) {
  const openItems = items.filter((item) => isOpenStatus(item.status));
  if (openItems.length === 0) return null;
  return openItems.sort((a, b) => {
    const aOpened = a.openedAt?.toDate?.() ?? a.dates?.[0]?.toDate?.() ?? new Date(0);
    const bOpened = b.openedAt?.toDate?.() ?? b.dates?.[0]?.toDate?.() ?? new Date(0);
    return aOpened.getTime() - bOpened.getTime();
  })[openItems.length - 1];
}
