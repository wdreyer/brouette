import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { DEFAULT_MEMBER_PASSWORD, normalizeMemberEmail } from "@/lib/memberAuthSync";

export const runtime = "nodejs";

type CreatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: string }).code ?? "")
    : "";
}

function toHtml(content: string) {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br/>");
}

async function sendWelcomeEmail(params: { email: string; firstName: string; password: string; loginUrl: string }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "La Brouette";

  if (!apiKey) throw new Error("BREVO_API_KEY missing in server env.");
  if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL missing in server env.");

  const subject = "Bienvenue chez La Brouette - tes identifiants de connexion";
  const content = `Bonjour ${params.firstName},

Un compte adherent vient d'etre cree pour toi chez La Brouette et le Panier.

Identifiant : ${params.email}
Mot de passe temporaire : ${params.password}

Connecte-toi sur ${params.loginUrl} puis change ce mot de passe des ta premiere connexion depuis ton espace membre.

Si tu n'es pas a l'origine de cette demande, ignore cet email.`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: params.email, name: params.firstName || undefined }],
      subject,
      htmlContent: toHtml(content),
      textContent: content,
      tags: ["brouette", "member-welcome"],
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Brevo send failed (${response.status}): ${raw.slice(0, 700)}`);
  }
}

function resolveOrigin(request: Request) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreatePayload;
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const email = normalizeMemberEmail(body.email);

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { ok: false, error: "Prenom, nom et email sont obligatoires." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    const auth = getAdminAuth();

    const [byEmail, byAccessEmail] = await Promise.all([
      db.collection("members").where("email", "==", email).limit(1).get(),
      db.collection("members").where("accessEmails", "array-contains", email).limit(1).get(),
    ]);
    if (!byEmail.empty || !byAccessEmail.empty) {
      return NextResponse.json({ ok: false, error: "Cet email est deja utilise." }, { status: 409 });
    }

    let userRecord;
    let reusedExistingAuthUser = false;
    try {
      userRecord = await auth.createUser({
        email,
        password: DEFAULT_MEMBER_PASSWORD,
        emailVerified: false,
        disabled: false,
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === "auth/email-already-exists") {
        userRecord = await auth.getUserByEmail(email);
        const existingMember = await db.collection("members").doc(userRecord.uid).get();
        if (existingMember.exists) {
          return NextResponse.json({ ok: false, error: "Cet email est deja utilise." }, { status: 409 });
        }
        await auth.updateUser(userRecord.uid, {
          email,
          password: DEFAULT_MEMBER_PASSWORD,
          disabled: false,
        });
        reusedExistingAuthUser = true;
      } else if (code === "auth/invalid-email") {
        return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 });
      } else {
        throw error;
      }
    }

    const uid = userRecord.uid;
    const now = FieldValue.serverTimestamp();

    await db.collection("members").doc(uid).set({
      firstName,
      lastName,
      email,
      emails: [email],
      accessEmails: [email],
      auth: { uid, role: "member", mustChangePassword: true },
      membershipStatus: "active",
      membershipPaymentStatus: "to_pay",
      membershipJoinedAt: null,
      createdAt: now,
    });

    await db.collection("memberAccess").doc(uid).set({
      uid,
      memberId: uid,
      role: "member",
      email,
      accessEmails: [email],
      updatedAt: now,
    });

    await sendWelcomeEmail({
      email,
      firstName,
      password: DEFAULT_MEMBER_PASSWORD,
      loginUrl: `${resolveOrigin(request)}/auth`,
    });

    return NextResponse.json({ ok: true, memberId: uid, reusedExistingAuthUser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
