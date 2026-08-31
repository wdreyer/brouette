export type OrderTrendItem = {
  saleDateKey?: string | null;
  quantity?: number | null;
  lineTotal?: number | null;
};

export type OrderTrendOrder = {
  id: string;
  memberId?: string | null;
  items: OrderTrendItem[];
};

export type OrderTrendPoint = {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  items: number;
};

export function orderTrendDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseOrderTrendDateTime(raw?: string | null) {
  const value = String(raw ?? "").trim();
  if (!value) return Number.POSITIVE_INFINITY;
  const isoCandidate = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isNaN(isoCandidate.getTime())) return isoCandidate.getTime();
  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) return fallback.getTime();
  return Number.POSITIVE_INFINITY;
}

function orderTrendLabel(rawDateKey: string) {
  const time = parseOrderTrendDateTime(rawDateKey);
  if (!Number.isFinite(time)) return rawDateKey || "Date";
  return new Date(time).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function buildOrderTrendPoints(params: {
  distributionDates: Date[];
  orders: OrderTrendOrder[];
  maxPoints?: number;
}) {
  const totalsByDate = new Map<string, { members: Set<string>; revenue: number; items: number }>();
  const dateKeys = new Set<string>();

  params.distributionDates.forEach((date) => {
    if (!Number.isNaN(date.getTime())) dateKeys.add(orderTrendDateKey(date));
  });

  params.orders.forEach((order) => {
    const byDate = new Map<string, { revenue: number; items: number }>();
    order.items.forEach((line) => {
      const key = String(line.saleDateKey ?? "").trim();
      if (!key) return;
      dateKeys.add(key);
      const current = byDate.get(key) ?? { revenue: 0, items: 0 };
      current.revenue += Number(line.lineTotal ?? 0);
      current.items += Number(line.quantity ?? 0);
      byDate.set(key, current);
    });

    const memberKey = order.memberId ? String(order.memberId) : `order:${order.id}`;
    byDate.forEach((dateTotals, key) => {
      const current = totalsByDate.get(key) ?? { members: new Set<string>(), revenue: 0, items: 0 };
      current.members.add(memberKey);
      current.revenue += dateTotals.revenue;
      current.items += dateTotals.items;
      totalsByDate.set(key, current);
    });
  });

  const maxPoints = params.maxPoints ?? 6;
  return Array.from(dateKeys)
    .sort((a, b) => parseOrderTrendDateTime(a) - parseOrderTrendDateTime(b) || a.localeCompare(b, "fr"))
    .slice(-maxPoints)
    .map((key, index) => {
      const totals = totalsByDate.get(key);
      return {
        key: `${key}-${index}`,
        label: orderTrendLabel(key),
        orders: totals?.members.size ?? 0,
        revenue: totals?.revenue ?? 0,
        items: totals?.items ?? 0,
      };
    });
}
