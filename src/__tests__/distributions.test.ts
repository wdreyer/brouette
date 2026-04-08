import { describe, it, expect } from "vitest";
import {
  resolveDistributionStatus,
  isOpenStatus,
  isPlannedStatus,
  isFinishedStatus,
  isArchivedStatus,
  isDistributionExpired,
  isDistributionOpenNow,
  pickOpenDistribution,
  distributionLabel,
} from "@/lib/distributions";

// ---------------------------------------------------------------------------
// resolveDistributionStatus
// ---------------------------------------------------------------------------
describe("resolveDistributionStatus", () => {
  it("reconnaît les statuts ouverts (fr + en)", () => {
    expect(resolveDistributionStatus("open")).toBe("open");
    expect(resolveDistributionStatus("ouverte")).toBe("open");
    expect(resolveDistributionStatus("ouvertes")).toBe("open");
  });

  it("reconnaît les statuts planifiés", () => {
    expect(resolveDistributionStatus("planned")).toBe("planned");
    expect(resolveDistributionStatus("planifiee")).toBe("planned");
    expect(resolveDistributionStatus("planifiée")).toBe("planned"); // avec accent
    expect(resolveDistributionStatus(undefined)).toBe("planned");
    expect(resolveDistributionStatus("")).toBe("planned");
  });

  it("reconnaît les statuts terminés", () => {
    expect(resolveDistributionStatus("finished")).toBe("finished");
    expect(resolveDistributionStatus("fermee")).toBe("finished");
    expect(resolveDistributionStatus("ferme")).toBe("finished");
    expect(resolveDistributionStatus("closed")).toBe("finished");
  });

  it("reconnaît les statuts archivés", () => {
    expect(resolveDistributionStatus("archived")).toBe("archived");
    expect(resolveDistributionStatus("archivee")).toBe("archived");
  });

  it("retourne unknown pour des valeurs inconnues", () => {
    expect(resolveDistributionStatus("brouette")).toBe("unknown");
    expect(resolveDistributionStatus("123")).toBe("unknown");
  });

  it("est insensible à la casse", () => {
    expect(resolveDistributionStatus("OPEN")).toBe("open");
    expect(resolveDistributionStatus("Planned")).toBe("planned");
  });
});

// ---------------------------------------------------------------------------
// isDistributionExpired
// ---------------------------------------------------------------------------
describe("isDistributionExpired", () => {
  it("retourne false si pas de closeAt", () => {
    expect(isDistributionExpired({ id: "d1", status: "open" })).toBe(false);
  });

  it("retourne true si closeAt est passé", () => {
    const past = new Date(Date.now() - 1000);
    expect(isDistributionExpired({ id: "d1", closeAt: { toDate: () => past } })).toBe(true);
  });

  it("retourne false si closeAt est dans le futur", () => {
    const future = new Date(Date.now() + 86400_000);
    expect(isDistributionExpired({ id: "d1", closeAt: { toDate: () => future } })).toBe(false);
  });

  it("utilise le now fourni en paramètre", () => {
    const date = new Date("2025-06-01");
    const dist = { id: "d1", closeAt: { toDate: () => new Date("2025-05-31") } };
    expect(isDistributionExpired(dist, date)).toBe(true);
    expect(isDistributionExpired(dist, new Date("2025-05-30"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDistributionOpenNow
// ---------------------------------------------------------------------------
describe("isDistributionOpenNow", () => {
  it("retourne false si la distribution est null", () => {
    expect(isDistributionOpenNow(null)).toBe(false);
  });

  it("retourne false si statut non ouvert", () => {
    const future = new Date(Date.now() + 86400_000);
    expect(
      isDistributionOpenNow({ id: "d1", status: "planned", closeAt: { toDate: () => future } }),
    ).toBe(false);
  });

  it("retourne false si ouvert mais expiré", () => {
    const past = new Date(Date.now() - 1000);
    expect(
      isDistributionOpenNow({ id: "d1", status: "open", closeAt: { toDate: () => past } }),
    ).toBe(false);
  });

  it("retourne true si ouvert et non expiré", () => {
    const future = new Date(Date.now() + 86400_000);
    expect(
      isDistributionOpenNow({ id: "d1", status: "open", closeAt: { toDate: () => future } }),
    ).toBe(true);
  });

  it("retourne true si ouvert sans closeAt (pas de fermeture auto)", () => {
    expect(isDistributionOpenNow({ id: "d1", status: "open" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pickOpenDistribution
// ---------------------------------------------------------------------------
describe("pickOpenDistribution", () => {
  const future = new Date(Date.now() + 86400_000);

  it("retourne null si aucune distribution", () => {
    expect(pickOpenDistribution([])).toBeNull();
  });

  it("retourne null si aucune distribution ouverte", () => {
    const items = [
      { id: "d1", status: "planned" },
      { id: "d2", status: "finished" },
    ];
    expect(pickOpenDistribution(items)).toBeNull();
  });

  it("retourne la distribution ouverte", () => {
    const items = [
      { id: "d1", status: "planned" },
      { id: "d2", status: "open", closeAt: { toDate: () => future } },
    ];
    expect(pickOpenDistribution(items)?.id).toBe("d2");
  });

  it("retourne la plus récente si plusieurs ouvertes", () => {
    const earlier = new Date("2025-01-01");
    const later = new Date("2025-06-01");
    const items = [
      {
        id: "d1",
        status: "open",
        openedAt: { toDate: () => earlier },
        closeAt: { toDate: () => future },
      },
      {
        id: "d2",
        status: "open",
        openedAt: { toDate: () => later },
        closeAt: { toDate: () => future },
      },
    ];
    expect(pickOpenDistribution(items)?.id).toBe("d2");
  });

  it("ignore les distributions ouvertes mais expirées", () => {
    const past = new Date(Date.now() - 1000);
    const items = [
      { id: "d1", status: "open", closeAt: { toDate: () => past } },
      { id: "d2", status: "planned" },
    ];
    expect(pickOpenDistribution(items)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// distributionLabel
// ---------------------------------------------------------------------------
describe("distributionLabel", () => {
  it("retourne 'Distribution' si pas de dates", () => {
    expect(distributionLabel()).toBe("Distribution");
    expect(distributionLabel(null)).toBe("Distribution");
    expect(distributionLabel({ id: "d1" })).toBe("Distribution");
  });

  it("inclut le mois de la première date", () => {
    const date = new Date("2025-03-15");
    const label = distributionLabel({ id: "d1", dates: [{ toDate: () => date }] });
    expect(label.toLowerCase()).toContain("mars");
  });
});

// ---------------------------------------------------------------------------
// Guards de statut
// ---------------------------------------------------------------------------
describe("guards de statut", () => {
  it("isOpenStatus", () => {
    expect(isOpenStatus("open")).toBe(true);
    expect(isOpenStatus("planned")).toBe(false);
  });

  it("isPlannedStatus", () => {
    expect(isPlannedStatus("planned")).toBe(true);
    expect(isPlannedStatus(undefined)).toBe(true);
    expect(isPlannedStatus("open")).toBe(false);
  });

  it("isFinishedStatus", () => {
    expect(isFinishedStatus("finished")).toBe(true);
    expect(isFinishedStatus("fermee")).toBe(true);
    expect(isFinishedStatus("open")).toBe(false);
  });

  it("isArchivedStatus", () => {
    expect(isArchivedStatus("archived")).toBe(true);
    expect(isArchivedStatus("open")).toBe(false);
  });
});
