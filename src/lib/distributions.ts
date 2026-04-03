export type DistributionLike = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
  closeAt?: { toDate?: () => Date };
};

const OPEN_STATUSES = new Set(["open", "ouverte", "ouvertes"]);
const PLANNED_STATUSES = new Set(["planned", "planifiee"]);
const FINISHED_STATUSES = new Set(["finished", "fermee", "ferme", "closed"]);
const ARCHIVED_STATUSES = new Set(["archived", "archivee"]);

export type DistributionStatusKey = "open" | "planned" | "finished" | "archived" | "unknown";

export function normalizeDistributionStatus(status?: string) {
  return String(status ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function resolveDistributionStatus(status?: string): DistributionStatusKey {
  const value = normalizeDistributionStatus(status);
  if (OPEN_STATUSES.has(value)) return "open";
  if (PLANNED_STATUSES.has(value) || value === "") return "planned";
  if (FINISHED_STATUSES.has(value)) return "finished";
  if (ARCHIVED_STATUSES.has(value)) return "archived";
  return "unknown";
}

export function isOpenStatus(status?: string) {
  return resolveDistributionStatus(status) === "open";
}

export function isPlannedStatus(status?: string) {
  return resolveDistributionStatus(status) === "planned";
}

export function isFinishedStatus(status?: string) {
  return resolveDistributionStatus(status) === "finished";
}

export function isArchivedStatus(status?: string) {
  return resolveDistributionStatus(status) === "archived";
}

export function distributionStatusLabel(status?: string) {
  const resolved = resolveDistributionStatus(status);
  if (resolved === "open") return "Ouverte";
  if (resolved === "planned") return "Planifiee";
  if (resolved === "finished") return "Fermee";
  if (resolved === "archived") return "Archivee";
  return "Inconnu";
}

export function distributionStatusSelectValue(status?: string): "planned" | "open" | "finished" {
  const resolved = resolveDistributionStatus(status);
  if (resolved === "open") return "open";
  if (resolved === "finished") return "finished";
  return "planned";
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
