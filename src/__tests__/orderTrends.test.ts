import { describe, expect, it } from "vitest";
import { buildOrderTrendPoints } from "@/lib/orderTrends";

describe("buildOrderTrendPoints", () => {
  it("includes ordered dates even when distribution dates are stale", () => {
    const points = buildOrderTrendPoints({
      distributionDates: [
        new Date("2026-05-26T00:00:00.000Z"),
        new Date("2026-06-09T00:00:00.000Z"),
      ],
      orders: [
        {
          id: "order-1",
          memberId: "member-1",
          items: [
            { saleDateKey: "2026-09-16", quantity: 2, lineTotal: 12.5 },
            { saleDateKey: "2026-09-16", quantity: 1, lineTotal: 4 },
          ],
        },
        {
          id: "order-2",
          memberId: "member-2",
          items: [{ saleDateKey: "2026-09-30", quantity: 3, lineTotal: 18 }],
        },
      ],
    });

    expect(points.map((point) => point.label)).toContain("16/09");
    expect(points.map((point) => point.label)).toContain("30/09");
    expect(points.find((point) => point.label === "16/09")).toMatchObject({
      orders: 1,
      revenue: 16.5,
      items: 3,
    });
  });

  it("counts one member once per date even when an order has several lines", () => {
    const points = buildOrderTrendPoints({
      distributionDates: [],
      orders: [
        {
          id: "order-1",
          memberId: "member-1",
          items: [
            { saleDateKey: "2026-10-14", quantity: 1, lineTotal: 8 },
            { saleDateKey: "2026-10-14", quantity: 2, lineTotal: 10 },
          ],
        },
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      label: "14/10",
      orders: 1,
      revenue: 18,
      items: 3,
    });
  });
});
