export type ProducerLinkLike = {
  id?: string;
  producerId?: string | null;
  active?: boolean;
  validatedByReferent?: boolean;
  activeDateKeys?: string[] | null;
};

export type OfferLike = {
  producerId?: string | null;
  productId?: string | null;
  saleDateKey?: string | null;
  dateIndex?: number | null;
  active?: boolean;
};

export type VisibleOffer<T extends OfferLike = OfferLike> = T & {
  producerId: string;
  productId: string;
  resolvedSaleDateKey: string;
};

function normalizeDateKeys(keys: string[]) {
  const allowed = new Set(keys);
  return Array.from(
    new Set(
      keys.filter((key) => typeof key === "string" && key.trim() !== "").map((key) => key.trim()),
    ),
  ).filter((key) => allowed.has(key));
}

function resolveProducerId(link: ProducerLinkLike) {
  const explicit = String(link.producerId ?? "").trim();
  if (explicit) return explicit;
  const fromId = String(link.id ?? "").trim();
  return fromId || "";
}

export function resolveOfferSaleDateKey(offer: OfferLike, distributionDateKeys: string[]) {
  const byKey = String(offer.saleDateKey ?? "").trim();
  if (byKey) return byKey;
  if (typeof offer.dateIndex === "number" && offer.dateIndex >= 0) {
    return distributionDateKeys[offer.dateIndex] ?? "";
  }
  return "";
}

function buildProducerDateMap(
  producerLinks: ProducerLinkLike[],
  distributionDateKeys: string[],
  requireValidated: boolean,
) {
  const allowedDateKeys = new Set(normalizeDateKeys(distributionDateKeys));
  const result = new Map<string, Set<string>>();

  producerLinks.forEach((link) => {
    const producerId = resolveProducerId(link);
    if (!producerId) return;
    if (link.active === false) return;
    if (requireValidated && link.validatedByReferent !== true) return;

    const activeDateKeys = Array.isArray(link.activeDateKeys)
      ? link.activeDateKeys.filter((key): key is string => typeof key === "string")
      : [];
    const constrained = activeDateKeys
      .map((key) => key.trim())
      .filter((key) => key !== "" && allowedDateKeys.has(key));
    if (!constrained.length) return;

    result.set(producerId, new Set(constrained));
  });

  return result;
}

export function buildActiveProducerDateMap(
  producerLinks: ProducerLinkLike[],
  distributionDateKeys: string[],
) {
  return buildProducerDateMap(producerLinks, distributionDateKeys, false);
}

export function buildValidatedProducerDateMap(
  producerLinks: ProducerLinkLike[],
  distributionDateKeys: string[],
) {
  return buildProducerDateMap(producerLinks, distributionDateKeys, true);
}

export function filterVisibleOffers<T extends OfferLike>(
  offers: T[],
  producerLinks: ProducerLinkLike[],
  distributionDateKeys: string[],
): Array<VisibleOffer<T>> {
  if (producerLinks.length === 0) return [];

  const allowedDateKeys = new Set(normalizeDateKeys(distributionDateKeys));
  const validatedMap = buildValidatedProducerDateMap(producerLinks, distributionDateKeys);
  const visible: Array<VisibleOffer<T>> = [];

  offers.forEach((offer) => {
    if (offer.active === false) return;

    const productId = String(offer.productId ?? "").trim();
    if (!productId) return;

    const producerId = String(offer.producerId ?? "").trim();
    if (!producerId) return;

    const resolvedSaleDateKey = resolveOfferSaleDateKey(offer, distributionDateKeys);
    if (!resolvedSaleDateKey || !allowedDateKeys.has(resolvedSaleDateKey)) return;

    const producerAllowedDates = validatedMap.get(producerId);
    if (!producerAllowedDates || !producerAllowedDates.has(resolvedSaleDateKey)) return;

    visible.push({
      ...offer,
      producerId,
      productId,
      resolvedSaleDateKey,
    });
  });

  return visible;
}
