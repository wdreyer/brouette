import { describe, it, expect } from "vitest";
import {
  resolveVariantActiveDates,
  resolveVariantActiveDatesForEditor,
  buildOffersForValidatedRows,
  countValidatedProducts,
  type ProductLike,
  type ProducerRowLike,
} from "@/lib/saleLogic";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const DATE_A = "2025-03-15";
const DATE_B = "2025-03-22";
const DATE_C = "2025-03-29";
const ALL_DATES = [DATE_A, DATE_B, DATE_C];

function makeProduct(
  id: string,
  producerId: string,
  variantActiveDates: string[][] = [ALL_DATES],
): ProductLike {
  return {
    id,
    producerId,
    name: `Produit ${id}`,
    imageUrl: "",
    isOrganic: false,
    variants: variantActiveDates.map((dates, i) => ({
      id: `${id}-v${i}`,
      label: `Variante ${i}`,
      price: 5,
      activeDates: dates,
    })),
  };
}

function makeRow(
  producerId: string,
  validated = true,
  activeDateKeys = ALL_DATES,
): ProducerRowLike {
  return { producerId, validatedByReferent: validated, activeDateKeys };
}

// ---------------------------------------------------------------------------
// resolveVariantActiveDates
// ---------------------------------------------------------------------------
describe("resolveVariantActiveDates", () => {
  it("utilise les dates stockées quand elles matchent les dates autorisées", () => {
    const result = resolveVariantActiveDates([DATE_A, DATE_B], ALL_DATES, ALL_DATES);
    expect(result).toEqual([DATE_A, DATE_B]);
  });

  it("filtre les dates hors de la distribution", () => {
    const result = resolveVariantActiveDates([DATE_A, "2099-01-01"], ALL_DATES, ALL_DATES);
    expect(result).toEqual([DATE_A]);
  });

  it("respecte un tableau vide [] → désélection intentionnelle", () => {
    const result = resolveVariantActiveDates([], ALL_DATES, ALL_DATES);
    expect(result).toEqual([]);
  });

  it("retombe sur distributionDateKeys si activeDates est null (variante nouvelle)", () => {
    const result = resolveVariantActiveDates(null, ALL_DATES, ALL_DATES);
    expect(result).toEqual(ALL_DATES);
  });

  it("retombe sur distributionDateKeys si activeDates est undefined (variante nouvelle)", () => {
    const result = resolveVariantActiveDates(undefined, ALL_DATES, ALL_DATES);
    expect(result).toEqual(ALL_DATES);
  });

  it("respecte les dates autorisées du producteur (subset des dates disto)", () => {
    // Producteur autorisé seulement les DATE_A et DATE_B
    const result = resolveVariantActiveDates([DATE_A, DATE_B, DATE_C], [DATE_A, DATE_B], ALL_DATES);
    expect(result).toEqual([DATE_A, DATE_B]);
    expect(result).not.toContain(DATE_C);
  });

  it("retourne [] si le producteur n'est autorisé sur aucune date de la disto", () => {
    const result = resolveVariantActiveDates(null, ["2099-01-01"], ALL_DATES);
    expect(result).toEqual([]);
  });

  it("déduplique les dates", () => {
    const result = resolveVariantActiveDates([DATE_A, DATE_A, DATE_B], ALL_DATES, ALL_DATES);
    expect(result.filter((d) => d === DATE_A)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveVariantActiveDatesForEditor (logique page gerer)
// ---------------------------------------------------------------------------
describe("resolveVariantActiveDatesForEditor", () => {
  describe("quand hasProducerOffers = true (producteur a des offerItems)", () => {
    it("utilise les dates des offres existantes", () => {
      const result = resolveVariantActiveDatesForEditor(null, [DATE_A], ALL_DATES, true);
      expect(result).toEqual([DATE_A]);
    });

    it("retourne [] si la variante n'a pas d'offerItems", () => {
      const result = resolveVariantActiveDatesForEditor([DATE_A, DATE_B], [], ALL_DATES, true);
      expect(result).toEqual([]);
    });

    it("filtre les offerDates hors editableDateKeys", () => {
      const result = resolveVariantActiveDatesForEditor(null, [DATE_A, "2099-01-01"], [DATE_A, DATE_B], true);
      expect(result).toEqual([DATE_A]);
    });
  });

  describe("quand hasProducerOffers = false", () => {
    it("utilise activeDates stockées si présentes et non vides", () => {
      const result = resolveVariantActiveDatesForEditor([DATE_A], [], ALL_DATES, false);
      expect(result).toEqual([DATE_A]);
    });

    it("respecte [] stocké = désélection intentionnelle (LE BUG CORRIGÉ)", () => {
      // Avant la correction, [] tombait en fallback sur ALL_DATES
      const result = resolveVariantActiveDatesForEditor([], [], ALL_DATES, false);
      expect(result).toEqual([]);
    });

    it("retombe sur editableDateKeys si activeDates est null (variante jamais sauvegardée)", () => {
      const result = resolveVariantActiveDatesForEditor(null, [], ALL_DATES, false);
      expect(result).toEqual(ALL_DATES);
    });

    it("retombe sur editableDateKeys si activeDates est undefined", () => {
      const result = resolveVariantActiveDatesForEditor(undefined, [], ALL_DATES, false);
      expect(result).toEqual(ALL_DATES);
    });

    it("filtre les dates stockées hors editableDateKeys", () => {
      // Producteur autorisé seulement sur DATE_A
      const result = resolveVariantActiveDatesForEditor([DATE_A, DATE_B], [], [DATE_A], false);
      expect(result).toEqual([DATE_A]);
    });
  });
});

// ---------------------------------------------------------------------------
// buildOffersForValidatedRows
// ---------------------------------------------------------------------------
describe("buildOffersForValidatedRows", () => {
  it("ne crée aucune offre si aucun producteur validé", () => {
    const rows = [makeRow("p1", false)];
    const products = { p1: [makeProduct("prod1", "p1")] };
    expect(buildOffersForValidatedRows(rows, products, ALL_DATES)).toHaveLength(0);
  });

  it("crée une offre par (variante × date active)", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [makeProduct("prod1", "p1", [[DATE_A, DATE_B]])],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers).toHaveLength(2);
    const dates = offers.map((o) => o.saleDateKey).sort();
    expect(dates).toEqual([DATE_A, DATE_B].sort());
  });

  it("ne crée aucune offre pour un produit dont toutes les variantes sont désélectionnées", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [makeProduct("prod1", "p1", [[]])], // activeDates vide = désélectionné
    };
    expect(buildOffersForValidatedRows(rows, products, ALL_DATES)).toHaveLength(0);
  });

  it("crée des offres pour plusieurs producteurs validés", () => {
    const rows = [makeRow("p1"), makeRow("p2")];
    const products = {
      p1: [makeProduct("prodA", "p1", [[DATE_A]])],
      p2: [makeProduct("prodB", "p2", [[DATE_B]])],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.producerId).sort()).toEqual(["p1", "p2"].sort());
  });

  it("respecte les activeDateKeys du producteur (dates autorisées)", () => {
    // p1 autorisé seulement sur DATE_A
    const rows = [makeRow("p1", true, [DATE_A])];
    const products = {
      p1: [makeProduct("prodA", "p1", [[DATE_A, DATE_B, DATE_C]])],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers).toHaveLength(1);
    expect(offers[0].saleDateKey).toBe(DATE_A);
  });

  it("déduplique les offres (même produit/variante/date)", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [makeProduct("prodA", "p1", [[DATE_A, DATE_A]])], // DATE_A en double
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers.filter((o) => o.saleDateKey === DATE_A)).toHaveLength(1);
  });

  it("gère plusieurs variantes par produit", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [
        makeProduct("prod1", "p1", [
          [DATE_A], // variante 0 → DATE_A
          [DATE_B, DATE_C], // variante 1 → DATE_B, DATE_C
        ]),
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers).toHaveLength(3);
  });

  it("utilise toutes les dates de la distribution si activeDates est null (variante jamais sauvegardée)", () => {
    const rows = [makeRow("p1")];
    // Simule une variante dont activeDates n'a pas encore été écrit en base
    const products: Record<string, ProductLike[]> = {
      p1: [
        {
          id: "prod1",
          producerId: "p1",
          name: "Produit 1",
          imageUrl: "",
          isOrganic: false,
          variants: [
            { id: "v1", label: "V1", price: 5, activeDates: null as unknown as string[] },
          ],
        },
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    // Doit créer une offre pour chaque date de la distribution
    expect(offers).toHaveLength(3);
  });

  it("remplit correctement les champs de l'offre", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [
        {
          id: "prod1",
          producerId: "p1",
          name: "Carottes",
          imageUrl: "https://img.example.com/carottes.jpg",
          isOrganic: true,
          saleLimit: 50,
          variants: [{ id: "v1", label: "1kg", price: 3.5, activeDates: [DATE_A] }],
        },
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers[0]).toMatchObject({
      producerId: "p1",
      productId: "prod1",
      variantId: "v1",
      saleDateKey: DATE_A,
      title: "Carottes",
      variantLabel: "1kg",
      imageUrl: "https://img.example.com/carottes.jpg",
      isOrganic: true,
      priceApplied: 3.5,
      limitTotal: 50,
      active: true,
    });
  });

  it("met priceApplied à 0 pour les produits vendus au poids", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [
        {
          id: "prod1",
          producerId: "p1",
          name: "Fromage",
          imageUrl: "",
          isOrganic: false,
          isSoldByWeight: true,
          variants: [{ id: "v1", label: "au kg", price: 18, activeDates: [DATE_A] }],
        },
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers[0].priceApplied).toBe(0);
  });

  it("met limitTotal à 0 si saleLimit nul ou absent", () => {
    const rows = [makeRow("p1")];
    const products = {
      p1: [makeProduct("prod1", "p1", [[DATE_A]])],
    };
    const offers = buildOffersForValidatedRows(rows, products, ALL_DATES);
    expect(offers[0].limitTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countValidatedProducts
// ---------------------------------------------------------------------------
describe("countValidatedProducts", () => {
  it("retourne 0 si le producteur n'est pas validé", () => {
    const row = makeRow("p1", false);
    const products = [makeProduct("prod1", "p1")];
    expect(countValidatedProducts(row, products, ALL_DATES)).toBe(0);
  });

  it("compte les produits avec au moins une variante active", () => {
    const row = makeRow("p1");
    const products = [
      makeProduct("prod1", "p1", [[DATE_A]]),  // 1 variante active
      makeProduct("prod2", "p1", [[]]),         // 0 variante active → non compté
      makeProduct("prod3", "p1", [[DATE_B, DATE_C]]),
    ];
    expect(countValidatedProducts(row, products, ALL_DATES)).toBe(2);
  });

  it("1 produit à 3 dates = 1 produit validé (pas 3)", () => {
    const row = makeRow("p1");
    const products = [makeProduct("prod1", "p1", [[DATE_A, DATE_B, DATE_C]])];
    expect(countValidatedProducts(row, products, ALL_DATES)).toBe(1);
  });

  it("ne compte pas les produits dont les dates sont hors distribution", () => {
    const row = makeRow("p1");
    const products = [makeProduct("prod1", "p1", [["2099-01-01"]])];
    expect(countValidatedProducts(row, products, ALL_DATES)).toBe(0);
  });

  it("ne compte pas les produits dont les dates ne sont pas autorisées pour le producteur", () => {
    // p1 autorisé seulement sur DATE_A
    const row = makeRow("p1", true, [DATE_A]);
    const products = [makeProduct("prod1", "p1", [[DATE_B, DATE_C]])]; // dates non autorisées
    expect(countValidatedProducts(row, products, ALL_DATES)).toBe(0);
  });

  it("retourne 0 si aucun produit", () => {
    const row = makeRow("p1");
    expect(countValidatedProducts(row, [], ALL_DATES)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scénarios end-to-end du process de vente
// ---------------------------------------------------------------------------
describe("Process complet de mise en vente", () => {
  const DATES = [DATE_A, DATE_B, DATE_C];

  it("Scénario 1 : référent valide ses producteurs, tous leurs produits apparaissent", () => {
    const rows: ProducerRowLike[] = [
      makeRow("ferme-martin", true, DATES),
      makeRow("ferme-durand", true, DATES),
    ];
    const products: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A, DATE_B]]),
        makeProduct("navets", "ferme-martin", [[DATE_B]]),
      ],
      "ferme-durand": [
        makeProduct("fromage", "ferme-durand", [[DATE_A, DATE_B, DATE_C]]),
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, DATES);
    const productIds = new Set(offers.map((o) => o.productId));
    expect(productIds).toContain("carottes");
    expect(productIds).toContain("navets");
    expect(productIds).toContain("fromage");
    expect(offers.filter((o) => o.productId === "carottes")).toHaveLength(2);
    expect(offers.filter((o) => o.productId === "navets")).toHaveLength(1);
    expect(offers.filter((o) => o.productId === "fromage")).toHaveLength(3);
  });

  it("Scénario 2 : un référent désélectionne des produits → ils n'apparaissent pas", () => {
    const rows: ProducerRowLike[] = [makeRow("ferme-martin", true, DATES)];
    const products: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A]]),
        makeProduct("navets", "ferme-martin", [[]]), // désélectionné
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, DATES);
    const productIds = new Set(offers.map((o) => o.productId));
    expect(productIds).toContain("carottes");
    expect(productIds).not.toContain("navets");
  });

  it("Scénario 3 : on retire la validation → tous les produits du producteur disparaissent", () => {
    const rowsValides: ProducerRowLike[] = [makeRow("ferme-martin", true, DATES)];
    const rowsRetires: ProducerRowLike[] = [makeRow("ferme-martin", false, DATES)];
    const products: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A, DATE_B]]),
      ],
    };
    const offresAvant = buildOffersForValidatedRows(rowsValides, products, DATES);
    const offresApres = buildOffersForValidatedRows(rowsRetires, products, DATES);
    expect(offresAvant.length).toBeGreaterThan(0);
    expect(offresApres).toHaveLength(0);
  });

  it("Scénario 4 : un producteur est autorisé seulement sur certaines dates (calendrier annuel)", () => {
    // Ferme Martin : autorisée seulement DATE_A et DATE_B (pas DATE_C)
    const rows: ProducerRowLike[] = [makeRow("ferme-martin", true, [DATE_A, DATE_B])];
    const products: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A, DATE_B, DATE_C]]),
      ],
    };
    const offers = buildOffersForValidatedRows(rows, products, DATES);
    const dates = offers.map((o) => o.saleDateKey);
    expect(dates).toContain(DATE_A);
    expect(dates).toContain(DATE_B);
    expect(dates).not.toContain(DATE_C);
  });

  it("Scénario 5 : modification d'une vente en cours (ajout/retrait de produits)", () => {
    // État initial : carottes sur DATE_A uniquement
    const etatInitial: ProducerRowLike[] = [makeRow("ferme-martin", true, DATES)];
    const produitsInitiaux: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A]]),
      ],
    };
    const offresInitiales = buildOffersForValidatedRows(etatInitial, produitsInitiaux, DATES);
    expect(offresInitiales).toHaveLength(1);

    // Admin ajoute navets et étend carottes à DATE_B
    const produitsModifies: Record<string, ProductLike[]> = {
      "ferme-martin": [
        makeProduct("carottes", "ferme-martin", [[DATE_A, DATE_B]]),
        makeProduct("navets", "ferme-martin", [[DATE_A]]),
      ],
    };
    const offresModifiees = buildOffersForValidatedRows(etatInitial, produitsModifies, DATES);
    expect(offresModifiees).toHaveLength(3); // carottes×2 + navets×1
  });

  it("Scénario 6 : compter les produits validés est indépendant du nb de dates", () => {
    const row = makeRow("ferme-martin", true, DATES);
    const products = [
      makeProduct("prod-3dates", "ferme-martin", [[DATE_A, DATE_B, DATE_C]]),
      makeProduct("prod-1date", "ferme-martin", [[DATE_A]]),
      makeProduct("prod-deselect", "ferme-martin", [[]]),
    ];
    // 2 produits validés (pas 3) malgré 4 dates au total
    expect(countValidatedProducts(row, products, DATES)).toBe(2);
  });

  it("Scénario 7 : plusieurs référents, chacun valide ses producteurs indépendamment", () => {
    // Référent A valide ferme-martin, Référent B valide ferme-durand
    const rows: ProducerRowLike[] = [
      makeRow("ferme-martin", true, DATES),  // géré par référent A
      makeRow("ferme-durand", false, DATES), // référent B pas encore validé
      makeRow("ferme-lebrun", true, DATES),  // géré par référent A
    ];
    const products: Record<string, ProductLike[]> = {
      "ferme-martin": [makeProduct("legumes", "ferme-martin", [[DATE_A]])],
      "ferme-durand": [makeProduct("fromage", "ferme-durand", [[DATE_A]])],
      "ferme-lebrun": [makeProduct("miel", "ferme-lebrun", [[DATE_B]])],
    };
    const offers = buildOffersForValidatedRows(rows, products, DATES);
    const producerIds = new Set(offers.map((o) => o.producerId));
    expect(producerIds).toContain("ferme-martin");
    expect(producerIds).not.toContain("ferme-durand"); // non validé
    expect(producerIds).toContain("ferme-lebrun");
  });
});
