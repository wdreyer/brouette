import { describe, it, expect } from "vitest";
import {
  filterVisibleOffers,
  buildValidatedProducerDateMap,
  buildActiveProducerDateMap,
  resolveOfferSaleDateKey,
  type ProducerLinkLike,
} from "@/lib/offerVisibility";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DATE_A = "2025-03-15";
const DATE_B = "2025-03-22";
const DATE_C = "2025-03-29";
const ALL_DATES = [DATE_A, DATE_B, DATE_C];

function makeLink(
  producerId: string,
  opts: Partial<ProducerLinkLike> = {},
): ProducerLinkLike {
  return {
    id: producerId,
    producerId,
    active: true,
    validatedByReferent: true,
    activeDateKeys: ALL_DATES,
    ...opts,
  };
}

function makeOffer(
  producerId: string,
  productId: string,
  saleDateKey: string,
  active = true,
) {
  return { producerId, productId, saleDateKey, active };
}

// ---------------------------------------------------------------------------
// resolveOfferSaleDateKey
// ---------------------------------------------------------------------------
describe("resolveOfferSaleDateKey", () => {
  it("retourne saleDateKey quand présent", () => {
    expect(resolveOfferSaleDateKey({ saleDateKey: DATE_A }, ALL_DATES)).toBe(DATE_A);
  });

  it("résout via dateIndex quand pas de saleDateKey", () => {
    expect(resolveOfferSaleDateKey({ dateIndex: 0 }, ALL_DATES)).toBe(DATE_A);
    expect(resolveOfferSaleDateKey({ dateIndex: 2 }, ALL_DATES)).toBe(DATE_C);
  });

  it("retourne '' si les deux sont absents", () => {
    expect(resolveOfferSaleDateKey({}, ALL_DATES)).toBe("");
  });

  it("retourne '' si dateIndex hors bornes", () => {
    expect(resolveOfferSaleDateKey({ dateIndex: 99 }, ALL_DATES)).toBe("");
  });

  it("saleDateKey avec espaces est nettoyé", () => {
    expect(resolveOfferSaleDateKey({ saleDateKey: "  " + DATE_A + "  " }, ALL_DATES)).toBe(DATE_A);
  });
});

// ---------------------------------------------------------------------------
// buildValidatedProducerDateMap
// ---------------------------------------------------------------------------
describe("buildValidatedProducerDateMap", () => {
  it("inclut les producteurs validés", () => {
    const links = [makeLink("p1"), makeLink("p2")];
    const map = buildValidatedProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(true);
    expect(map.has("p2")).toBe(true);
  });

  it("exclut les producteurs non validés", () => {
    const links = [
      makeLink("p1", { validatedByReferent: false }),
      makeLink("p2"),
    ];
    const map = buildValidatedProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(false);
    expect(map.has("p2")).toBe(true);
  });

  it("exclut les producteurs inactifs", () => {
    const links = [makeLink("p1", { active: false })];
    const map = buildValidatedProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(false);
  });

  it("filtre les dates autorisées par rapport aux dates de la distribution", () => {
    const links = [makeLink("p1", { activeDateKeys: [DATE_A, "2099-01-01"] })];
    const map = buildValidatedProducerDateMap(links, ALL_DATES);
    expect(map.get("p1")).toEqual(new Set([DATE_A]));
    expect(map.get("p1")?.has("2099-01-01")).toBe(false);
  });

  it("exclut un producteur si aucune de ses dates ne matche la distribution", () => {
    const links = [makeLink("p1", { activeDateKeys: ["2099-01-01"] })];
    const map = buildValidatedProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(false);
  });

  it("résout l'id depuis link.id si producerId est absent", () => {
    const link: ProducerLinkLike = { id: "p-from-id", activeDateKeys: ALL_DATES, validatedByReferent: true, active: true };
    const map = buildValidatedProducerDateMap([link], ALL_DATES);
    expect(map.has("p-from-id")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildActiveProducerDateMap
// ---------------------------------------------------------------------------
describe("buildActiveProducerDateMap", () => {
  it("inclut les producteurs actifs même non validés", () => {
    const links = [makeLink("p1", { validatedByReferent: false })];
    const map = buildActiveProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(true);
  });

  it("exclut les producteurs inactifs", () => {
    const links = [makeLink("p1", { active: false })];
    const map = buildActiveProducerDateMap(links, ALL_DATES);
    expect(map.has("p1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterVisibleOffers — cas de base
// ---------------------------------------------------------------------------
describe("filterVisibleOffers — cas de base", () => {
  it("retourne [] si aucun producerLink", () => {
    const offers = [makeOffer("p1", "prod1", DATE_A)];
    expect(filterVisibleOffers(offers, [], ALL_DATES)).toEqual([]);
  });

  it("affiche les offres des producteurs validés", () => {
    const links = [makeLink("p1")];
    const offers = [makeOffer("p1", "prod1", DATE_A)];
    const result = filterVisibleOffers(offers, links, ALL_DATES);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("prod1");
  });

  it("cache les offres des producteurs non validés", () => {
    const links = [makeLink("p1", { validatedByReferent: false })];
    const offers = [makeOffer("p1", "prod1", DATE_A)];
    expect(filterVisibleOffers(offers, links, ALL_DATES)).toHaveLength(0);
  });

  it("cache les offres inactives (active: false)", () => {
    const links = [makeLink("p1")];
    const offers = [makeOffer("p1", "prod1", DATE_A, false)];
    expect(filterVisibleOffers(offers, links, ALL_DATES)).toHaveLength(0);
  });

  it("cache les offres sur des dates hors distribution", () => {
    const links = [makeLink("p1")];
    const offers = [makeOffer("p1", "prod1", "2099-01-01")];
    expect(filterVisibleOffers(offers, links, ALL_DATES)).toHaveLength(0);
  });

  it("cache les offres dont le producteur n'est pas autorisé sur cette date", () => {
    const links = [makeLink("p1", { activeDateKeys: [DATE_B] })]; // p1 autorisé seulement sur DATE_B
    const offers = [makeOffer("p1", "prod1", DATE_A)]; // offre sur DATE_A
    expect(filterVisibleOffers(offers, links, ALL_DATES)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterVisibleOffers — plusieurs producteurs et dates
// ---------------------------------------------------------------------------
describe("filterVisibleOffers — scénarios multi-producteurs", () => {
  it("filtre correctement avec plusieurs producteurs dont certains non validés", () => {
    const links = [
      makeLink("p1", { validatedByReferent: true }),
      makeLink("p2", { validatedByReferent: false }),
      makeLink("p3", { validatedByReferent: true, activeDateKeys: [DATE_C] }),
    ];
    const offers = [
      makeOffer("p1", "prodA", DATE_A),
      makeOffer("p1", "prodB", DATE_B),
      makeOffer("p2", "prodC", DATE_A), // p2 non validé → caché
      makeOffer("p3", "prodD", DATE_A), // p3 non autorisé sur DATE_A → caché
      makeOffer("p3", "prodD", DATE_C), // p3 autorisé sur DATE_C → visible
    ];
    const result = filterVisibleOffers(offers, links, ALL_DATES);
    const productIds = result.map((o) => o.productId);
    expect(productIds).toContain("prodA");
    expect(productIds).toContain("prodB");
    expect(productIds).not.toContain("prodC");
    expect(result.filter((o) => o.productId === "prodD")).toHaveLength(1);
    expect(result.find((o) => o.productId === "prodD")?.resolvedSaleDateKey).toBe(DATE_C);
  });

  it("résout resolvedSaleDateKey correctement", () => {
    const links = [makeLink("p1")];
    const offers = [{ producerId: "p1", productId: "prod1", dateIndex: 1, active: true }];
    const result = filterVisibleOffers(offers, links, ALL_DATES);
    expect(result[0].resolvedSaleDateKey).toBe(DATE_B);
  });

  it("enrichit chaque offre avec producerId, productId, resolvedSaleDateKey", () => {
    const links = [makeLink("p1")];
    const offers = [makeOffer("p1", "prod1", DATE_A)];
    const result = filterVisibleOffers(offers, links, ALL_DATES);
    expect(result[0]).toMatchObject({
      producerId: "p1",
      productId: "prod1",
      resolvedSaleDateKey: DATE_A,
    });
  });
});

// ---------------------------------------------------------------------------
// filterVisibleOffers — rétirer la validation d'un producteur
// ---------------------------------------------------------------------------
describe("filterVisibleOffers — retrait de validation", () => {
  it("cache tous les produits d'un producteur dont on retire la validation", () => {
    const linksAvant = [makeLink("p1", { validatedByReferent: true })];
    const linksApres = [makeLink("p1", { validatedByReferent: false })];
    const offers = [
      makeOffer("p1", "prodA", DATE_A),
      makeOffer("p1", "prodB", DATE_B),
    ];
    expect(filterVisibleOffers(offers, linksAvant, ALL_DATES)).toHaveLength(2);
    expect(filterVisibleOffers(offers, linksApres, ALL_DATES)).toHaveLength(0);
  });
});
