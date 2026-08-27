import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { estimateWeightedItemsTotal } from "@/lib/orderEstimates";
import {
  ORDER_CONFIRMATION_SUBJECT,
  SAMPLE_ORDER_CONFIRMATION,
  buildOrderConfirmationHtmlContent,
  buildOrderConfirmationTextContent,
  type OrderConfirmationItem,
} from "@/lib/orderConfirmationEmail";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const orderId = new URL(request.url).searchParams.get("orderId")?.trim() || "";

    if (!orderId) {
      return NextResponse.json({
        ok: true,
        sample: true,
        subject: ORDER_CONFIRMATION_SUBJECT,
        html: buildOrderConfirmationHtmlContent(SAMPLE_ORDER_CONFIRMATION),
        text: buildOrderConfirmationTextContent(SAMPLE_ORDER_CONFIRMATION),
      });
    }

    const db = getAdminDb();
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) {
      return NextResponse.json({ ok: false, error: "Commande introuvable." }, { status: 404 });
    }

    const order = orderSnap.data() as {
      memberSnapshot?: { email?: string | null };
      totals?: { totalAmount?: number; weightedEstimatedAmount?: number };
    };

    const itemsSnap = await db.collection("orders").doc(orderId).collection("items").get();
    const items = itemsSnap.docs.map(
      (docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<OrderConfirmationItem, "id">) }),
    );
    const producerIds = Array.from(new Set(items.map((item) => String(item.producerId ?? "")).filter(Boolean)));
    const producerEntries = await Promise.all(
      producerIds.map(async (producerId) => {
        const producerSnap = await db.collection("producers").doc(producerId).get();
        return [producerId, String(producerSnap.data()?.name ?? producerId)] as const;
      }),
    );
    const producerLabels = Object.fromEntries(producerEntries);
    const totalAmount = Number(order.totals?.totalAmount ?? 0);
    const weightedEstimateTotal = Number.isFinite(Number(order.totals?.weightedEstimatedAmount))
      ? Number(order.totals?.weightedEstimatedAmount)
      : estimateWeightedItemsTotal(items);

    const emailParams = { orderId, items, producerLabels, totalAmount, weightedEstimateTotal };

    return NextResponse.json({
      ok: true,
      sample: false,
      recipientEmail: order.memberSnapshot?.email ?? null,
      subject: ORDER_CONFIRMATION_SUBJECT,
      html: buildOrderConfirmationHtmlContent(emailParams),
      text: buildOrderConfirmationTextContent(emailParams),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
