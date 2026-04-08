/**
 * Pure business logic for the sale process — no Firebase, no React.
 * Used by OpenSalesWizard and gerer/page, and testable in isolation.
 */

export type VariantLike = {
  id: string;
  label: string;
  price: number;
  activeDates: string[];
};

export type ProductLike = {
  id: string;
  producerId: string;
  name: string;
  imageUrl: string;
  isOrganic: boolean;
  isSoldByWeight?: boolean;
  saleLimit?: number | null;
  variants: VariantLike[];
};

export type ProducerRowLike = {
  producerId: string;
  activeDateKeys: string[];
  validatedByReferent: boolean;
};

export type BuiltOffer = {
  producerId: string;
  productId: string;
  variantId: string;
  saleDateKey: string;
  title: string;
  variantLabel: string;
  imageUrl: string | null;
  isOrganic: boolean;
  priceApplied: number;
  limitTotal: number;
  active: true;
};

/**
 * Résout les dates actives d'une variante pour une distribution donnée.
 *
 * Règle : si la variante a des activeDates sauvegardées en base (même vides),
 * on respecte ce choix. On ne retombe sur distributionDateKeys que si le champ
 * n'a jamais été initialisé (null / undefined = nouvelle variante).
 */
export function resolveVariantActiveDates(
  storedActiveDates: string[] | null | undefined,
  producerAllowedDates: string[],
  distributionDateKeys: string[],
): string[] {
  const hasStored = Array.isArray(storedActiveDates);
  const source = hasStored ? storedActiveDates! : distributionDateKeys;
  const allowed = new Set(producerAllowedDates.filter((k) => distributionDateKeys.includes(k)));
  return Array.from(new Set(source.filter((k) => allowed.has(k))));
}

/**
 * Construit les offerItems pour tous les producteurs validés.
 * Retourne les offres à créer (sans écriture Firebase).
 */
export function buildOffersForValidatedRows(
  rows: ProducerRowLike[],
  productsByProducer: Record<string, ProductLike[]>,
  distributionDateKeys: string[],
): BuiltOffer[] {
  const offers: BuiltOffer[] = [];
  const seen = new Set<string>();

  rows
    .filter((row) => row.validatedByReferent)
    .forEach((row) => {
      const { producerId, activeDateKeys } = row;
      (productsByProducer[producerId] ?? []).forEach((product) => {
        const limitTotal = Number(product.saleLimit ?? 0);
        product.variants.forEach((variant) => {
          const dates = resolveVariantActiveDates(
            variant.activeDates,
            activeDateKeys,
            distributionDateKeys,
          );
          dates.forEach((saleDateKey) => {
            const key = `${producerId}|${product.id}|${variant.id}|${saleDateKey}`;
            if (seen.has(key)) return;
            seen.add(key);
            offers.push({
              producerId,
              productId: product.id,
              variantId: variant.id,
              saleDateKey,
              title: product.name,
              variantLabel: variant.label,
              imageUrl: product.imageUrl || null,
              isOrganic: product.isOrganic,
              priceApplied: product.isSoldByWeight ? 0 : Number(variant.price ?? 0),
              limitTotal: Number.isFinite(limitTotal) && limitTotal > 0 ? limitTotal : 0,
              active: true,
            });
          });
        });
      });
    });

  return offers;
}

/**
 * Compte les produits réellement sélectionnés pour un producteur validé
 * (au moins une variante avec au moins une date active parmi les dates autorisées).
 */
export function countValidatedProducts(
  row: ProducerRowLike,
  products: ProductLike[],
  distributionDateKeys: string[],
): number {
  if (!row.validatedByReferent) return 0;
  const allowed = new Set(
    row.activeDateKeys.filter((k) => distributionDateKeys.includes(k)),
  );
  return products.filter((product) =>
    product.variants.some((variant) =>
      variant.activeDates.some((dateKey) => allowed.has(dateKey)),
    ),
  ).length;
}

/**
 * Résout les activeDates d'une variante lors du chargement de la page gerer.
 * Même règle : [] sauvegardé = désélectionné intentionnellement.
 */
export function resolveVariantActiveDatesForEditor(
  storedActiveDates: string[] | null | undefined,
  activeDatesFromOffers: string[],
  editableDateKeys: string[],
  hasProducerOffers: boolean,
): string[] {
  if (hasProducerOffers) {
    return activeDatesFromOffers.filter((k) => editableDateKeys.includes(k));
  }
  const hasStored = Array.isArray(storedActiveDates);
  if (hasStored) {
    return storedActiveDates!.filter((k) => editableDateKeys.includes(k));
  }
  // Variante jamais sauvegardée → toutes les dates par défaut
  return [...editableDateKeys];
}
