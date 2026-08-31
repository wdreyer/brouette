import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPPORT_RECIPIENTS = [
  { email: "dreyer.wil@gmail.com", name: "William Dreyer" },
  { email: "contact@labrouetteetlepanier.fr", name: "La Brouette" },
];

type SupportPayload = {
  question?: string;
  failingEmail?: string;
  name?: string;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return normalize(value).toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function supportLine(label: string, value: string) {
  return `<p><strong>${escapeHtml(label)}</strong><br/>${escapeHtml(value || "-").replace(/\n/g, "<br/>")}</p>`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SupportPayload;
    const question = normalize(body.question);
    const failingEmail = normalizeEmail(body.failingEmail);
    const name = normalize(body.name);

    if (!question || !failingEmail) {
      return NextResponse.json(
        { ok: false, error: "Question et email qui ne fonctionne pas obligatoires." },
        { status: 400 },
      );
    }
    if (!isEmail(failingEmail)) {
      return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || "La Brouette";

    if (!apiKey) throw new Error("BREVO_API_KEY missing in server env.");
    if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL missing in server env.");

    const subject = `[La Brouette] Probleme de connexion - ${failingEmail}`;
    const textContent = [
      "Probleme de connexion",
      "",
      `Question : ${question}`,
      `Email qui ne fonctionne pas : ${failingEmail}`,
      `Nom / prenom : ${name || "-"}`,
    ].join("\n");
    const htmlContent = [
      "<h2>Probleme de connexion</h2>",
      supportLine("Question", question),
      supportLine("Email qui ne fonctionne pas", failingEmail),
      supportLine("Nom / prenom", name),
    ].join("");

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: SUPPORT_RECIPIENTS,
        replyTo: { email: failingEmail, name: name || undefined },
        subject,
        htmlContent,
        textContent,
        tags: ["brouette", "login-support"],
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`Brevo send failed (${response.status}): ${raw.slice(0, 700)}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
