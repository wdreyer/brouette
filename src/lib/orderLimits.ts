import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import type { CartItem } from "@/lib/cart";

export type LimitCheckResult = { ok: true } | { ok: false; message: string };

type OfferItemData = { limitTotal?: number };
type OrderItemData = { productId?: string; saleDateKey?: string; quantity?: number };

/**
 * Revérifie, juste avant de valider une commande, que les quantités demandées
 * ne dépassent pas la limite par produit/date (limitTotal), en tenant compte
 * de ce que les autres adhérents ont déjà commandé pour cette distribution.
 */
export async function checkCartAgainstLimits(
  db: Firestore,
  distributionId: string,
  items: CartItem[],
): Promise<LimitCheckResult> {
  const offerItemIds = Array.from(
    new Set(items.map((item) => item.offerItemId).filter((id): id is string => Boolean(id))),
  );
  if (offerItemIds.length === 0) return { ok: true };

  const offerSnaps = await Promise.all(
    offerItemIds.map((id) => getDoc(doc(db, "distributionDates", distributionId, "offerItems", id))),
  );
  const limitByOfferId = new Map<string, number>();
  offerSnaps.forEach((snap) => {
    if (!snap.exists()) return;
    const limit = Number((snap.data() as OfferItemData).limitTotal ?? 0);
    if (limit > 0) limitByOfferId.set(snap.id, limit);
  });
  if (limitByOfferId.size === 0) return { ok: true };

  const limitedItems = items.filter((item) => item.offerItemId && limitByOfferId.has(item.offerItemId));
  if (limitedItems.length === 0) return { ok: true };

  const requestedByKey = new Map<string, number>();
  const limitByKey = new Map<string, number>();
  const labelByKey = new Map<string, string>();
  limitedItems.forEach((item) => {
    const key = `${item.productId}::${item.saleDateKey ?? ""}`;
    requestedByKey.set(key, (requestedByKey.get(key) ?? 0) + item.quantity);
    limitByKey.set(key, limitByOfferId.get(item.offerItemId!)!);
    labelByKey.set(key, `${item.name}${item.saleDateLabel ? ` (${item.saleDateLabel})` : ""}`);
  });

  const ordersSnap = await getDocs(query(collection(db, "orders"), where("distributionId", "==", distributionId)));
  const itemsSnaps = await Promise.all(
    ordersSnap.docs.map((orderDoc) => getDocs(collection(db, "orders", orderDoc.id, "items"))),
  );
  const alreadyOrderedByKey = new Map<string, number>();
  itemsSnaps.forEach((snap) => {
    snap.docs.forEach((itemDoc) => {
      const data = itemDoc.data() as OrderItemData;
      if (!data.productId) return;
      const key = `${data.productId}::${data.saleDateKey ?? ""}`;
      if (!limitByKey.has(key)) return;
      alreadyOrderedByKey.set(key, (alreadyOrderedByKey.get(key) ?? 0) + Number(data.quantity ?? 0));
    });
  });

  for (const [key, requested] of requestedByKey.entries()) {
    const limit = limitByKey.get(key) ?? 0;
    const already = alreadyOrderedByKey.get(key) ?? 0;
    const remaining = Math.max(0, limit - already);
    if (requested > remaining) {
      const label = labelByKey.get(key) ?? "ce produit";
      return {
        ok: false,
        message:
          remaining > 0
            ? `Quantité limitée pour "${label}" : il ne reste que ${remaining} unité(s) disponible(s). Réduis la quantité dans ton panier.`
            : `"${label}" est en quantité limitée et n'est plus disponible pour cette date. Retire-le de ton panier.`,
      };
    }
  }

  return { ok: true };
}
