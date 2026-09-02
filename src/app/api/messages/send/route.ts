import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { renderComposedContentToEmailHtml, stripHtmlToText } from "@/lib/messageFormatting";

export const runtime = "nodejs";

type SendMode = "send" | "test";
type TargetKind =
  | "all-members-and-coop"
  | "adherents-only"
  | "recent-buyers"
  | "coop-only"
  | "selected-adherents"
  | "contact-list"
  | "producers";

type SendPayload = {
  mode?: SendMode;
  target?: TargetKind;
  subject?: string;
  content?: string;
  selectedMemberIds?: string[];
  recentDays?: number;
  includeInactive?: boolean;
  testEmail?: string;
  contactListId?: string | null;
  contactListName?: string | null;
  templateId?: string | null;
  templateName?: string | null;
};

type Recipient = {
  email: string;
  name?: string;
  memberId?: string;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isInactiveStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "inactive" || normalized === "non-adherent" || normalized === "non";
}

function uniqueRecipients(input: Recipient[]) {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const row of input) {
    const email = normalizeEmail(row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ ...row, email });
  }
  return out;
}

function fullName(firstName: unknown, lastName: unknown) {
  return `${String(firstName ?? "").trim()} ${String(lastName ?? "").trim()}`.replace(/\s+/g, " ").trim();
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function sendBrevoEmail(params: {
  recipients: Recipient[];
  subject: string;
  content: string;
  mode: SendMode;
}) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "La Brouette";

  if (!apiKey) {
    throw new Error("BREVO_API_KEY missing in server env.");
  }
  if (!senderEmail) {
    throw new Error("BREVO_SENDER_EMAIL missing in server env.");
  }

  const recipientChunks = chunk(params.recipients, 80);
  let sent = 0;
  const providerMessageIds: string[] = [];
  const htmlContent = renderComposedContentToEmailHtml(params.content);
  const textContent = stripHtmlToText(htmlContent);

  for (const group of recipientChunks) {
    const payloadBase = {
      sender: {
        email: senderEmail,
        name: senderName,
      },
      subject: params.subject,
      htmlContent,
      textContent,
      tags: ["brouette", "admin-message"],
    };
    const payload =
      params.mode === "test"
        ? {
            ...payloadBase,
            to: group.map((row) => ({
              email: row.email,
              name: row.name || undefined,
            })),
          }
        : {
            ...payloadBase,
            to: [{ email: senderEmail, name: senderName }],
            bcc: group.map((row) => ({
              email: row.email,
              name: row.name || undefined,
            })),
          };

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`Brevo send failed (${response.status}): ${raw.slice(0, 700)}`);
    }
    const raw = (await response.json().catch(() => ({}))) as { messageId?: string };
    if (raw?.messageId) providerMessageIds.push(String(raw.messageId));

    sent += group.length;
  }

  return { sent, providerMessageIds };
}

async function listMembersRecipients(options: {
  target: TargetKind;
  selectedMemberIds: string[];
  recentDays: number;
  includeInactive: boolean;
  contactListId: string;
}): Promise<Recipient[]> {
  const db = getAdminDb();
  const membersSnap = await db.collection("members").get();
  const members = membersSnap.docs.map((docSnap) => {
    const data = docSnap.data();
    const role = String((data.auth ?? {}).role ?? "member").toLowerCase();
    const isInactive = isInactiveStatus(data.membershipStatus);
    const emails = [
      normalizeEmail(data.email),
      ...(Array.isArray(data.emails) ? data.emails.map((item) => normalizeEmail(item)) : []),
    ].filter(Boolean);
    return {
      id: docSnap.id,
      role,
      isInactive,
      emails,
      name: fullName(data.firstName, data.lastName),
    };
  });

  const memberById = new Map(members.map((row) => [row.id, row]));
  const canUseMember = (row: (typeof members)[number]) => options.includeInactive || !row.isInactive;

  if (options.target === "all-members-and-coop") {
    return uniqueRecipients(
      members
        .filter((row) => canUseMember(row))
        .flatMap((row) =>
          row.emails.map((email) => ({
            email,
            name: row.name || undefined,
            memberId: row.id,
          })),
        ),
    );
  }

  if (options.target === "adherents-only") {
    return uniqueRecipients(
      members
        .filter((row) => row.role === "member" && canUseMember(row))
        .flatMap((row) =>
          row.emails.map((email) => ({
            email,
            name: row.name || undefined,
            memberId: row.id,
          })),
        ),
    );
  }

  if (options.target === "coop-only") {
    return uniqueRecipients(
      members
        .filter((row) => (row.role === "admin" || row.role === "referent") && canUseMember(row))
        .flatMap((row) =>
          row.emails.map((email) => ({
            email,
            name: row.name || undefined,
            memberId: row.id,
          })),
        ),
    );
  }

  if (options.target === "selected-adherents") {
    const selected = options.selectedMemberIds
      .map((id) => memberById.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.role === "member" && canUseMember(row));
    return uniqueRecipients(
      selected.flatMap((row) =>
        row.emails.map((email) => ({
          email,
          name: row.name || undefined,
          memberId: row.id,
        })),
      ),
    );
  }

  if (options.target === "contact-list") {
    if (!options.contactListId) return [];
    const listSnap = await db.collection("contactLists").doc(options.contactListId).get();
    const listData = listSnap.data() as { memberIds?: string[] } | undefined;
    const memberIds = Array.isArray(listData?.memberIds) ? listData.memberIds : [];
    const selected = memberIds
      .map((id) => memberById.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => canUseMember(row));
    return uniqueRecipients(
      selected.flatMap((row) =>
        row.emails.map((email) => ({
          email,
          name: row.name || undefined,
          memberId: row.id,
        })),
      ),
    );
  }

  if (options.target === "producers") {
    const producersSnap = await db.collection("producers").get();
    const recipients: Recipient[] = [];
    producersSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as { name?: string; email?: string };
      const email = normalizeEmail(data.email);
      if (!email) return;
      recipients.push({ email, name: String(data.name ?? "").trim() || undefined });
    });
    return uniqueRecipients(recipients);
  }

  const since = new Date();
  since.setDate(since.getDate() - options.recentDays);
  const sinceTs = Timestamp.fromDate(since);

  const ordersSnap = await db.collection("orders").where("createdAt", ">=", sinceTs).get();
  const recipients: Recipient[] = [];

  ordersSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as {
      memberId?: string;
      memberSnapshot?: { email?: string | null; name?: string | null };
    };

    const memberId = String(data.memberId ?? "").trim();
    if (memberId) {
      const member = memberById.get(memberId);
      if (member && canUseMember(member)) {
        member.emails.forEach((email) => {
          recipients.push({
            email,
            name: member.name || undefined,
            memberId: member.id,
          });
        });
      }
      return;
    }

    const snapEmail = normalizeEmail(data.memberSnapshot?.email);
    if (snapEmail) {
      recipients.push({
        email: snapEmail,
        name: String(data.memberSnapshot?.name ?? "").trim() || undefined,
      });
    }
  });

  return uniqueRecipients(recipients);
}

function targetLabel(target: TargetKind, listName?: string) {
  if (target === "all-members-and-coop") return "Tous les adhérents et membres Coop";
  if (target === "adherents-only") return "Adhérents uniquement";
  if (target === "recent-buyers") return "Adhérents ayant commandé récemment";
  if (target === "coop-only") return "Membres coop";
  if (target === "contact-list") return listName ? `Liste : ${listName}` : "Liste de diffusion";
  if (target === "producers") return "Producteurs";
  return "Sélection d'adhérents";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendPayload;
    const mode: SendMode = body.mode === "test" ? "test" : "send";
    const target: TargetKind = body.target ?? "all-members-and-coop";
    const subject = String(body.subject ?? "").trim();
    const content = String(body.content ?? "").trim();
    const selectedMemberIds = Array.isArray(body.selectedMemberIds)
      ? body.selectedMemberIds.map((id) => String(id)).filter(Boolean)
      : [];
    const recentDays = Number.isFinite(Number(body.recentDays))
      ? Math.max(1, Math.min(365, Number(body.recentDays)))
      : 45;
    const includeInactive = body.includeInactive === true;
    const testEmail = normalizeEmail(body.testEmail);
    const contactListId = String(body.contactListId ?? "").trim();

    if (!subject || !content) {
      return NextResponse.json({ ok: false, error: "Objet et message obligatoires." }, { status: 400 });
    }

    let recipients: Recipient[] = [];
    if (mode === "test") {
      if (!testEmail) {
        return NextResponse.json({ ok: false, error: "Email de test manquant." }, { status: 400 });
      }
      recipients = [{ email: testEmail }];
    } else {
      recipients = await listMembersRecipients({
        target,
        selectedMemberIds,
        recentDays,
        includeInactive,
        contactListId,
      });
      if (!recipients.length) {
        return NextResponse.json({ ok: false, error: "Aucun destinataire pour cette cible." }, { status: 400 });
      }
    }

    const sendResult = await sendBrevoEmail({
      recipients,
      subject,
      content,
      mode,
    });

    let archiveWarning: string | null = null;
    try {
      const db = getAdminDb();
      const now = Timestamp.now();
      await db.collection("messages").add({
        target: mode === "test" ? "test" : target,
        targetLabel: mode === "test" ? "Envoi test" : targetLabel(target, body.contactListName ?? undefined),
        subject,
        content,
        status: "sent",
        filters: {
          includeInactive,
          recentDays: target === "recent-buyers" ? recentDays : null,
          selectedCount: target === "selected-adherents" ? selectedMemberIds.length : null,
        },
        template: {
          id: body.templateId ?? null,
          name: body.templateName ?? null,
        },
        stats: {
          recipients: sendResult.sent,
          sentAt: now,
          recipientsList: recipients.map((row) => row.email),
          recipientsPreview: recipients.slice(0, 25).map((row) => row.email),
          provider: "brevo",
          providerMessageIds: sendResult.providerMessageIds,
        },
        createdAt: now,
        updatedAt: now,
      });
    } catch (archiveError) {
      const archiveMessage =
        archiveError instanceof Error ? archiveError.message : "Archivage impossible.";
      archiveWarning = `Envoi effectue mais archivage impossible: ${archiveMessage}`;
    }

    return NextResponse.json({
      ok: true,
      sent: sendResult.sent,
      mode,
      target,
      providerMessageIds: sendResult.providerMessageIds,
      warning: archiveWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
