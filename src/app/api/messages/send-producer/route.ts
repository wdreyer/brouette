import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { renderComposedContentToEmailHtml, stripHtmlToText } from "@/lib/messageFormatting";

export const runtime = "nodejs";

type SendProducerPayload = {
  producerId: string;
  producerName: string;
  producerEmail: string;
  subject: string;
  content: string;
  pdfBase64?: string;
  pdfFileName?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendProducerPayload;
    const producerId = String(body.producerId ?? "").trim();
    const producerName = String(body.producerName ?? "").trim();
    const producerEmail = String(body.producerEmail ?? "").trim().toLowerCase();
    const subject = String(body.subject ?? "").trim();
    const content = String(body.content ?? "").trim();
    const pdfBase64 = String(body.pdfBase64 ?? "").trim();
    const pdfFileName = String(body.pdfFileName ?? "commande-producteur.pdf").trim();

    if (!producerEmail) {
      return NextResponse.json({ ok: false, error: "Aucun email renseigné pour ce producteur." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(producerEmail)) {
      return NextResponse.json(
        { ok: false, error: `L'email du producteur ("${producerEmail}") n'est pas valide.` },
        { status: 400 },
      );
    }
    if (!subject || !content) {
      return NextResponse.json({ ok: false, error: "Objet et message obligatoires." }, { status: 400 });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || "La Brouette";

    if (!apiKey) throw new Error("BREVO_API_KEY manquant.");
    if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL manquant.");

    const htmlContent = renderComposedContentToEmailHtml(content);
    const payload: Record<string, unknown> = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: producerEmail, name: producerName || undefined }],
      subject,
      htmlContent,
      textContent: stripHtmlToText(htmlContent),
      tags: ["brouette", "commande-producteur"],
    };

    if (pdfBase64) {
      payload.attachment = [{ content: pdfBase64, name: pdfFileName }];
    }

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`Brevo error (${response.status}): ${raw.slice(0, 400)}`);
    }

    // L'email est parti : un échec d'archivage ne doit plus faire passer la
    // réponse en ok:false, sinon l'admin croit l'envoi échoué et le relance
    // (doublon d'email envoyé au producteur).
    let archiveWarning: string | null = null;
    try {
      const db = getAdminDb();
      await db.collection("messages").add({
        target: "producer",
        targetLabel: `Producteur : ${producerName}`,
        subject,
        content,
        status: "sent",
        filters: { producerId, producerEmail },
        template: { id: null, name: null },
        stats: {
          recipients: 1,
          sentAt: new Date(),
          recipientsPreview: [producerEmail],
          provider: "brevo",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (archiveError) {
      const archiveMessage = archiveError instanceof Error ? archiveError.message : "Archivage impossible.";
      archiveWarning = `Envoi effectue mais archivage impossible: ${archiveMessage}`;
    }

    return NextResponse.json({ ok: true, sent: 1, producerEmail, warning: archiveWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
