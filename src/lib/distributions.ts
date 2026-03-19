export type DistributionLike = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
  closeAt?: { toDate?: () => Date };
};

const OPEN_STATUSES = new Set(["open", "ouverte", "ouvertes"]);

export function isOpenStatus(status?: string) {
  return OPEN_STATUSES.has(String(status ?? ""));
}

export function isDistributionExpired(item?: DistributionLike | null, now = new Date()) {
  const closeAt = item?.closeAt?.toDate?.();
  if (!closeAt) return false;
  return closeAt.getTime() <= now.getTime();
}

export function isDistributionOpenNow(item?: DistributionLike | null, now = new Date()) {
  if (!item) return false;
  if (!isOpenStatus(item.status)) return false;
  if (isDistributionExpired(item, now)) return false;
  return true;
}

export function pickOpenDistribution<T extends DistributionLike>(items: T[]) {
  const now = new Date();
  const openItems = items.filter((item) => isDistributionOpenNow(item, now));
  if (openItems.length === 0) return null;
  return openItems.sort((a, b) => {
    const aOpened = a.openedAt?.toDate?.() ?? a.dates?.[0]?.toDate?.() ?? new Date(0);
    const bOpened = b.openedAt?.toDate?.() ?? b.dates?.[0]?.toDate?.() ?? new Date(0);
    return aOpened.getTime() - bOpened.getTime();
  })[openItems.length - 1];
}

export function distributionLabel(item?: DistributionLike | null) {
  const firstDate = item?.dates?.[0]?.toDate?.();
  if (!firstDate) return "Distribution";
  const month = firstDate.toLocaleDateString("fr-FR", { month: "long" });
  return `Distribution ${month}`;
}
