import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { estimateWeightedItemsTotal } from "@/lib/orderEstimates";
import {
  ORDER_CONFIRMATION_SUBJECT,
  buildOrderConfirmationHtmlContent,
  buildOrderConfirmationTextContent,
  type OrderConfirmationItem,
} from "@/lib/orderConfirmationEmail";

export const runtime = "nodejs";

type OrderConfirmationPayload = {
  orderId?: string;
};

async function sendEmail(params: { to: string; subject: string; htmlContent: string; textContent: string }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "La Brouette";

  if (!apiKey) throw new Error("BREVO_API_KEY missing in server env.");
  if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL missing in server env.");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.htmlContent,
      textContent: params.textContent,
      tags: ["brouette", "order-confirmation"],
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Brevo send failed (${response.status}): ${raw.slice(0, 700)}`);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OrderConfirmationPayload;
    const orderId = String(body.orderId ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Commande manquante." }, { status: 400 });
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
    const recipientEmail = String(order.memberSnapshot?.email ?? "").trim().toLowerCase();
    if (!recipientEmail) {
      return NextResponse.json({ ok: false, error: "Email destinataire manquant." }, { status: 400 });
    }

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

    await sendEmail({
      to: recipientEmail,
      subject: ORDER_CONFIRMATION_SUBJECT,
      htmlContent: buildOrderConfirmationHtmlContent(emailParams),
      textContent: buildOrderConfirmationTextContent(emailParams),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
