"use client";

import { collection, getDocs } from "firebase/firestore";
import { getCart, replaceCart } from "@/lib/cart";
import { firebaseDb } from "@/lib/firebase/client";
import { pickOpenDistribution } from "@/lib/distributions";

type Distribution = {
  id: string;
  status?: string;
  dates?: { toDate?: () => Date }[];
  openedAt?: { toDate?: () => Date };
  closeAt?: { toDate?: () => Date };
};

type OfferItem = {
  productId?: string;
  variantId?: string;
  saleDateKey?: string;
  dateIndex?: number;
  active?: boolean;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function offerKey(productId: string, variantId: string, saleDateKey: string) {
  return `${productId}::${variantId}::${saleDateKey}`;
}

export async function reconcileCartWithOpenSale() {
  const items = getCart();
  if (!items.length) return { removed: 0, kept: 0 };

  const distSnap = await getDocs(collection(firebaseDb, "distributionDates"));
  const distributions = distSnap.docs.map(
    (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Distribution, "id">) }) as Distribution,
  );
  const openDistribution = pickOpenDistribution(distributions);
  if (!openDistribution) {
    replaceCart([]);
    return { removed: items.length, kept: 0 };
  }

  const openDateKeys = (openDistribution.dates ?? [])
    .slice(0, 3)
    .map((entry) => entry.toDate?.())
    .filter(Boolean)
    .map((date) => dateKey(date as Date));

  const offerSnap = await getDocs(
    collection(firebaseDb, "distributionDates", openDistribution.id, "offerItems"),
  );
  const validOfferKeys = new Set<string>();
  offerSnap.docs.forEach((docSnap) => {
    const offer = docSnap.data() as OfferItem;
    if (offer.active === false) return;
    const productId = String(offer.productId ?? "");
    const variantId = String(offer.variantId ?? "");
    if (!productId || !variantId) return;
    const resolvedDateKey =
      typeof offer.saleDateKey === "string" && offer.saleDateKey
        ? offer.saleDateKey
        : typeof offer.dateIndex === "number"
          ? openDateKeys[offer.dateIndex] ?? ""
          : "";
    if (!resolvedDateKey) return;
    validOfferKeys.add(offerKey(productId, variantId, resolvedDateKey));
  });

  const nextItems = items.filter((item) => {
    const productId = String(item.productId ?? "");
    const variantId = String(item.variantId ?? "");
    const saleDate = String(item.saleDateKey ?? "");
    if (!productId || !variantId || !saleDate) return false;
    return validOfferKeys.has(offerKey(productId, variantId, saleDate));
  });

  if (nextItems.length !== items.length) {
    replaceCart(nextItems);
  }

  return { removed: items.length - nextItems.length, kept: nextItems.length };
}
