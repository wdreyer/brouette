"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { renderComposedContentToEmailHtml, stripHtmlToText } from "@/lib/messageFormatting";
import RichTextEditor from "@/components/admin/RichTextEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageDoc = {
  id: string;
  target?: string;
  targetLabel?: string;
  subject?: string;
  status?: string;
  content?: string;
  createdAt?: Timestamp;
  stats?: {
    recipients?: number;
    sentAt?: Timestamp;
    recipientsPreview?: string[];
    provider?: string;
    providerMessageIds?: string[];
  };
  filters?: { includeInactive?: boolean; recentDays?: number | null; selectedCount?: number | null };
  template?: { id?: string | null; name?: string | null };
};

type TemplateDoc = {
  id: string;
  name?: string;
  subject?: string;
  content?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type ContactListDoc = {
  id: string;
  name?: string;
  description?: string;
  memberIds?: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type MemberDoc = {
  id: string;
  firstName?: string;
  lastName?: string;
  role: string;
  membershipStatus?: string;
  email?: string;
  emails?: string[];
};

type TargetKind =
  | "all-members-and-coop"
  | "adherents-only"
  | "recent-buyers"
  | "coop-only"
  | "selected-adherents"
  | "contact-list"
  | "producers";

type ActiveTab = "composer" | "templates" | "lists" | "history";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    id: "builtin-opening",
    name: "Ouverture de la vente",
    subject: "La vente est ouverte",
    content:
      "Bonjour,\n\nLa vente est ouverte. Tu peux dès maintenant préparer et valider ton panier sur la boutique.\n\nÀ bientôt,\nLa Brouette",
  },
  {
    id: "builtin-pickup",
    name: "Rappel retrait (J-1/J-2)",
    subject: "Rappel retrait de commande",
    content:
      "Bonjour,\n\nPetit rappel : ta commande est à récupérer très bientôt. Pense à vérifier ton récap par date et par producteur.\n\nÀ bientôt,\nLa Brouette",
  },
];

const TARGET_OPTIONS: { value: TargetKind; label: string; desc: string }[] = [
  { value: "all-members-and-coop", label: "Tous", desc: "Tous les adhérents et membres Coop" },
  { value: "adherents-only", label: "Adhérents", desc: "Membres avec rôle adhérent" },
  { value: "recent-buyers", label: "Commandes recentes", desc: "Personnes ayant commande recemment" },
  { value: "coop-only", label: "Membres Coop", desc: "Admins et référents" },
  { value: "selected-adherents", label: "Sélection manuelle", desc: "Choisir les adhérents un par un" },
  { value: "contact-list", label: "Liste de diffusion", desc: "Utiliser une liste enregistree" },
  { value: "producers", label: "Producteurs", desc: "Tous les producteurs (email de la fiche producteur)" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function fullName(firstName: unknown, lastName: unknown) {
  return `${String(firstName ?? "").trim()} ${String(lastName ?? "").trim()}`.replace(/\s+/g, " ").trim();
}

function isInactive(status: unknown) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "inactive" || s === "non-adherent" || s === "non";
}

function firstEmail(member: MemberDoc) {
  const all = [normalizeEmail(member.email), ...(member.emails ?? []).map(normalizeEmail)].filter(Boolean);
  return all[0] ?? "";
}

function fmtDate(ts?: Timestamp) {
  const d = ts?.toDate?.();
  if (!d) return "-";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTargetLabel(target: TargetKind, listName?: string) {
  if (target === "contact-list" && listName) return `Liste : ${listName}`;
  return TARGET_OPTIONS.find((o) => o.value === target)?.label ?? target;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MessagesEditor() {
  // Data
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [contactLists, setContactLists] = useState<ContactListDoc[]>([]);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // UI
  const [activeTab, setActiveTab] = useState<ActiveTab>("composer");
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Composer
  const [draft, setDraft] = useState({
    target: "all-members-and-coop" as TargetKind,
    subject: "",
    content: "",
    includeInactive: false,
    recentDays: 45,
    selectedMemberIds: [] as string[],
    contactListId: "",
    testEmail: "dreyer.wil@gmail.com",
  });
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [quickTemplateName, setQuickTemplateName] = useState("");
  const [searchManualMembers, setSearchManualMembers] = useState("");

  // Template editing
  const [editingTemplate, setEditingTemplate] = useState<{
    id: string | null;
    name: string;
    subject: string;
    content: string;
  } | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  // Contact list editing
  const [editingList, setEditingList] = useState<{
    id: string | null;
    name: string;
    description: string;
    memberIds: string[];
  } | null>(null);
  const [listSearchMembers, setListSearchMembers] = useState("");
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  // ─── Load ────────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    try {
      const [messagesSnap, templatesSnap, listsSnap, membersSnap] = await Promise.all([
        getDocs(query(collection(firebaseDb, "messages"), orderBy("createdAt", "desc"), limit(120))),
        getDocs(query(collection(firebaseDb, "messageTemplates"), orderBy("updatedAt", "desc"), limit(120))),
        getDocs(query(collection(firebaseDb, "contactLists"), orderBy("updatedAt", "desc"), limit(100))),
        getDocs(collection(firebaseDb, "members")),
      ]);
      setMessages(messagesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageDoc, "id">) })));
      setTemplates(templatesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TemplateDoc, "id">) })));
      setContactLists(listsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContactListDoc, "id">) })));
      setMembers(
        membersSnap.docs.map((d) => {
          const data = d.data() as {
            firstName?: string;
            lastName?: string;
            email?: string;
            emails?: string[];
            membershipStatus?: string;
            auth?: { role?: string };
          };
          return {
            id: d.id,
            firstName: data.firstName ?? "",
            lastName: data.lastName ?? "",
            email: data.email ?? "",
            emails: Array.isArray(data.emails) ? data.emails : [],
            membershipStatus: data.membershipStatus ?? "",
            role: String(data.auth?.role ?? "member").toLowerCase(),
          };
        }),
      );
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur de chargement." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const adherents = useMemo(() => members.filter((m) => m.role === "member"), [members]);
  const coopMembers = useMemo(
    () => members.filter((m) => m.role === "admin" || m.role === "referent"),
    [members],
  );

  const manualCandidates = useMemo(() => {
    const term = searchManualMembers.trim().toLowerCase();
    return adherents.filter((m) => {
      const hay = [fullName(m.firstName, m.lastName), firstEmail(m), m.membershipStatus ?? ""].join(" ").toLowerCase();
      return term ? hay.includes(term) : true;
    });
  }, [adherents, searchManualMembers]);

  const listMemberCandidates = useMemo(() => {
    const term = listSearchMembers.trim().toLowerCase();
    return members.filter((m) => {
      const hay = [fullName(m.firstName, m.lastName), firstEmail(m)].join(" ").toLowerCase();
      return term ? hay.includes(term) : true;
    });
  }, [members, listSearchMembers]);

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateKey) return null;
    if (selectedTemplateKey.startsWith("builtin:")) {
      return BUILTIN_TEMPLATES.find((t) => t.id === selectedTemplateKey.replace("builtin:", "")) ?? null;
    }
    if (selectedTemplateKey.startsWith("custom:")) {
      return templates.find((t) => t.id === selectedTemplateKey.replace("custom:", "")) ?? null;
    }
    return null;
  }, [selectedTemplateKey, templates]);

  const estimatedTargetCount = useMemo(() => {
    const allow = (m: MemberDoc) => draft.includeInactive || !isInactive(m.membershipStatus);
    if (draft.target === "all-members-and-coop") return members.filter(allow).length;
    if (draft.target === "adherents-only") return adherents.filter(allow).length;
    if (draft.target === "coop-only") return coopMembers.filter(allow).length;
    if (draft.target === "selected-adherents")
      return draft.selectedMemberIds
        .map((id) => adherents.find((m) => m.id === id))
        .filter((m): m is MemberDoc => Boolean(m))
        .filter(allow).length;
    if (draft.target === "contact-list" && draft.contactListId) {
      return contactLists.find((l) => l.id === draft.contactListId)?.memberIds?.length ?? 0;
    }
    return null;
  }, [adherents, coopMembers, contactLists, draft, members]);

  const canSendMain = useMemo(() => {
    if (!draft.subject.trim() || !draft.content.trim()) return false;
    if (draft.target === "selected-adherents" && draft.selectedMemberIds.length === 0) return false;
    if (draft.target === "contact-list" && !draft.contactListId) return false;
    return true;
  }, [draft]);

  const composerPreviewHtml = useMemo(
    () => renderComposedContentToEmailHtml(draft.content),
    [draft.content],
  );
  const templatePreviewHtml = useMemo(
    () => renderComposedContentToEmailHtml(editingTemplate?.content ?? ""),
    [editingTemplate?.content],
  );

  // ─── Composer handlers ────────────────────────────────────────────────────────

  const applyTemplate = (tmpl: { subject?: string; content?: string; name?: string } | null) => {
    if (!tmpl) return;
    setDraft((prev) => ({ ...prev, subject: tmpl.subject ?? "", content: tmpl.content ?? "" }));
    setStatusMsg({ type: "info", text: "Modèle appliqué." });
  };

  const toggleManualMember = (memberId: string) => {
    setDraft((prev) => ({
      ...prev,
      selectedMemberIds: prev.selectedMemberIds.includes(memberId)
        ? prev.selectedMemberIds.filter((id) => id !== memberId)
        : [...prev.selectedMemberIds, memberId],
    }));
  };

  const sendMessage = async (mode: "send" | "test") => {
    if (!draft.subject.trim() || !draft.content.trim()) {
      setStatusMsg({ type: "error", text: "Objet et contenu obligatoires." });
      return;
    }
    if (mode === "send" && draft.target === "selected-adherents" && draft.selectedMemberIds.length === 0) {
      setStatusMsg({ type: "error", text: "Sélectionne au moins un adhérent." });
      return;
    }
    if (mode === "send" && draft.target === "contact-list" && !draft.contactListId) {
      setStatusMsg({ type: "error", text: "Sélectionne une liste de diffusion." });
      return;
    }
    if (mode === "test" && !draft.testEmail.trim()) {
      setStatusMsg({ type: "error", text: "Email de test obligatoire." });
      return;
    }
    try {
      setSending(true);
      setStatusMsg(null);
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          target: draft.target,
          subject: draft.subject.trim(),
          content: draft.content.trim(),
          selectedMemberIds: draft.selectedMemberIds,
          recentDays: draft.recentDays,
          includeInactive: draft.includeInactive,
          testEmail: draft.testEmail.trim(),
          contactListId: draft.contactListId || null,
          contactListName: contactLists.find((l) => l.id === draft.contactListId)?.name ?? null,
          templateId: selectedTemplateKey.startsWith("custom:")
            ? selectedTemplateKey.replace("custom:", "")
            : null,
          templateName: selectedTemplate?.name ?? null,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        sent?: number;
        providerMessageIds?: string[];
        warning?: string | null;
      };
      if (!response.ok || !result.ok) {
        setStatusMsg({ type: "error", text: result.error ?? "Erreur d'envoi." });
        return;
      }
      const ref =
        Array.isArray(result.providerMessageIds) && result.providerMessageIds.length
          ? ` (ref: ${result.providerMessageIds[0]})`
          : "";
      setStatusMsg({
        type: "success",
        text:
          mode === "test"
            ? `Test envoyé à ${draft.testEmail}.${ref}`
            : `Message envoyé à ${result.sent ?? 0} destinataires.${ref}`,
      });
      if (result.warning) {
        setStatusMsg({
          type: "info",
          text: `${mode === "test" ? "Test envoyé." : "Message envoyé."} ${result.warning}`,
        });
      }
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur d'envoi." });
    } finally {
      setSending(false);
    }
  };

  const saveQuickTemplate = async () => {
    const name = quickTemplateName.trim();
    if (!name || !draft.subject.trim() || !draft.content.trim()) {
      setStatusMsg({ type: "error", text: "Nom, objet et contenu obligatoires." });
      return;
    }
    try {
      await addDoc(collection(firebaseDb, "messageTemplates"), {
        name,
        subject: draft.subject.trim(),
        content: draft.content.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setQuickTemplateName("");
      setStatusMsg({ type: "success", text: "Modèle enregistré." });
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur." });
    }
  };

  // ─── Template handlers ────────────────────────────────────────────────────────

  const saveTemplate = async () => {
    if (!editingTemplate) return;
    const name = editingTemplate.name.trim();
    const subject = editingTemplate.subject.trim();
    const content = editingTemplate.content.trim();
    if (!name || !subject || !content) {
      setStatusMsg({ type: "error", text: "Nom, objet et contenu obligatoires." });
      return;
    }
    try {
      if (editingTemplate.id) {
        await setDoc(
          doc(firebaseDb, "messageTemplates", editingTemplate.id),
          { name, subject, content, updatedAt: serverTimestamp() },
          { merge: true },
        );
        setStatusMsg({ type: "success", text: "Modèle mis à jour." });
      } else {
        await addDoc(collection(firebaseDb, "messageTemplates"), {
          name,
          subject,
          content,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setStatusMsg({ type: "success", text: "Modèle créé." });
      }
      setEditingTemplate(null);
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur." });
    }
  };

  const confirmDeleteTemplate = async () => {
    if (!deleteTemplateId) return;
    try {
      await deleteDoc(doc(firebaseDb, "messageTemplates", deleteTemplateId));
      setDeleteTemplateId(null);
      setStatusMsg({ type: "success", text: "Modèle supprimé." });
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur." });
    }
  };

  // ─── Contact list handlers ────────────────────────────────────────────────────

  const toggleListMember = (memberId: string) => {
    setEditingList((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        memberIds: prev.memberIds.includes(memberId)
          ? prev.memberIds.filter((id) => id !== memberId)
          : [...prev.memberIds, memberId],
      };
    });
  };

  const saveContactList = async () => {
    if (!editingList) return;
    const name = editingList.name.trim();
    if (!name) {
      setStatusMsg({ type: "error", text: "Nom de liste obligatoire." });
      return;
    }
    try {
      if (editingList.id) {
        await setDoc(
          doc(firebaseDb, "contactLists", editingList.id),
          {
            name,
            description: editingList.description.trim(),
            memberIds: editingList.memberIds,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setStatusMsg({ type: "success", text: "Liste mise à jour." });
      } else {
        await addDoc(collection(firebaseDb, "contactLists"), {
          name,
          description: editingList.description.trim(),
          memberIds: editingList.memberIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setStatusMsg({ type: "success", text: "Liste creee." });
      }
      setEditingList(null);
      setListSearchMembers("");
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur." });
    }
  };

  const confirmDeleteList = async () => {
    if (!deleteListId) return;
    try {
      await deleteDoc(doc(firebaseDb, "contactLists", deleteListId));
      setDeleteListId(null);
      setStatusMsg({ type: "success", text: "Liste supprimee." });
      await load();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur." });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const tabs: { key: ActiveTab; label: string; count?: number }[] = [
    { key: "composer", label: "Composer" },
    { key: "templates", label: "Modèles", count: templates.length },
    { key: "lists", label: "Listes de diffusion", count: contactLists.length },
    { key: "history", label: "Historique", count: messages.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="rounded-[28px] border border-clay/60 bg-white/90 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/55">Messagerie</p>
        <h2 className="mt-2 font-serif text-3xl">Envoi de messages</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/70">
          Composez et envoyez des emails, gérez vos modèles et vos listes de diffusion.
        </p>
      </div>

      {/* Status banner */}
      {statusMsg && (
        <div
          className={`flex items-center justify-between rounded-[18px] border px-5 py-3 text-sm font-medium ${
            statusMsg.type === "success"
              ? "border-forest/20 bg-forest/8 text-forest"
              : statusMsg.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-sky-200 bg-sky-50 text-sky-700"
          }`}
        >
          <span>{statusMsg.text}</span>
          <button className="ml-4 opacity-50 hover:opacity-100" onClick={() => setStatusMsg(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-[22px] border border-clay/60 bg-white/90 p-1.5 shadow-card">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-[18px] px-3 py-2.5 text-sm font-semibold transition-all ${
              activeTab === tab.key
                ? "bg-forest text-white shadow-sm"
                : "text-ink/55 hover:bg-stone/50 hover:text-ink"
            }`}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeTab === tab.key ? "bg-white/25 text-white" : "bg-ink/8 text-ink/50"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          COMPOSER TAB
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "composer" && (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          {/* Left sidebar */}
          <div className="flex flex-col gap-5">
            {/* Audience */}
            <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Audience</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {TARGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        target: opt.value,
                        selectedMemberIds: [],
                        contactListId: "",
                      }))
                    }
                    className={`flex items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-all ${
                      draft.target === opt.value ? "bg-forest/8 ring-1 ring-forest/25" : "hover:bg-stone/40"
                    }`}
                  >
                    <span
                      className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 transition-colors ${
                        draft.target === opt.value ? "border-forest bg-forest" : "border-ink/30"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{opt.label}</p>
                      <p className="text-xs text-ink/50">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Count + filters */}
              <div className="mt-3 rounded-[12px] bg-stone/50 px-3 py-2.5">
                <p className="text-xs text-ink/60">
                  Destinataires estimes :{" "}
                  <span className="font-bold text-ink">
                    {typeof estimatedTargetCount === "number" ? estimatedTargetCount : "?"}
                  </span>
                </p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={draft.includeInactive}
                    onChange={(e) => setDraft((prev) => ({ ...prev, includeInactive: e.target.checked }))}
                  />
                  Inclure les membres inactifs
                </label>
                {draft.target === "recent-buyers" && (
                  <label className="flex items-center justify-between text-xs text-ink/60">
                    <span>Periode</span>
                    <select
                      className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs"
                      value={draft.recentDays}
                      onChange={(e) => setDraft((prev) => ({ ...prev, recentDays: Number(e.target.value) || 45 }))}
                    >
                      <option value={30}>30 jours</option>
                      <option value={45}>45 jours</option>
                      <option value={60}>60 jours</option>
                      <option value={90}>90 jours</option>
                    </select>
                  </label>
                )}
              </div>
            </div>

            {/* Contact list picker */}
            {draft.target === "contact-list" && (
              <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Liste</p>
                  <button
                    className="text-[11px] font-semibold text-forest hover:underline"
                    onClick={() => setActiveTab("lists")}
                  >
                    Gerer
                  </button>
                </div>
                {contactLists.length === 0 ? (
                  <div className="mt-3 text-center">
                    <p className="text-sm text-ink/60">Aucune liste.</p>
                    <button
                      onClick={() => setActiveTab("lists")}
                      className="mt-1 text-sm font-semibold text-forest hover:underline"
                    >
                      Créer une liste
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {contactLists.map((list) => (
                      <button
                        key={list.id}
                        onClick={() => setDraft((prev) => ({ ...prev, contactListId: list.id }))}
                        className={`flex items-center justify-between rounded-[12px] px-3 py-2.5 text-left transition-all ${
                          draft.contactListId === list.id
                            ? "bg-forest/8 ring-1 ring-forest/25"
                            : "border border-ink/5 hover:bg-stone/40"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{list.name}</p>
                          {list.description && <p className="text-xs text-ink/50">{list.description}</p>}
                        </div>
                        <span className="ml-2 shrink-0 rounded-full bg-ink/8 px-2 py-0.5 text-xs text-ink/55">
                          {list.memberIds?.length ?? 0}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manual selection */}
            {draft.target === "selected-adherents" && (
              <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Sélection</p>
                  <span className="rounded-full bg-forest/10 px-2.5 py-0.5 text-xs font-bold text-forest">
                    {draft.selectedMemberIds.length} choisi(s)
                  </span>
                </div>
                <input
                  className="mt-3 w-full rounded-[12px] border border-ink/15 bg-stone/30 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-forest/30"
                  placeholder="Rechercher..."
                  value={searchManualMembers}
                  onChange={(e) => setSearchManualMembers(e.target.value)}
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    className="rounded-lg border border-ink/12 px-2.5 py-1 text-[11px] font-semibold text-ink/60 hover:bg-stone/40"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, selectedMemberIds: manualCandidates.map((m) => m.id) }))
                    }
                  >
                    Tout cocher
                  </button>
                  <button
                    className="rounded-lg border border-ink/12 px-2.5 py-1 text-[11px] font-semibold text-ink/60 hover:bg-stone/40"
                    onClick={() => setDraft((prev) => ({ ...prev, selectedMemberIds: [] }))}
                  >
                    Vider
                  </button>
                </div>
                <div className="mt-2 max-h-60 overflow-auto rounded-[12px] border border-ink/8 bg-stone/20">
                  {manualCandidates.map((member) => {
                    const name = fullName(member.firstName, member.lastName) || "Adhérent";
                    const email = firstEmail(member) || "-";
                    const checked = draft.selectedMemberIds.includes(member.id);
                    return (
                      <label
                        key={member.id}
                        className="flex cursor-pointer items-center gap-3 border-b border-ink/5 px-3 py-2 last:border-0 hover:bg-stone/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleManualMember(member.id)}
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">{name}</p>
                          <p className="truncate text-[11px] text-ink/55">{email}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Template quick-pick */}
            <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Modèle</p>
                <button
                  className="text-[11px] font-semibold text-forest hover:underline"
                  onClick={() => setActiveTab("templates")}
                >
                  Gerer
                </button>
              </div>
              <select
                className="mt-3 w-full rounded-[14px] border border-ink/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                value={selectedTemplateKey}
                onChange={(e) => setSelectedTemplateKey(e.target.value)}
              >
                <option value="">Aucun (message libre)</option>
                <optgroup label="Modèles intégrés">
                  {BUILTIN_TEMPLATES.map((t) => (
                    <option key={t.id} value={`builtin:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="Modèles personnalisés">
                    {templates.map((t) => (
                      <option key={t.id} value={`custom:${t.id}`}>
                        {t.name ?? "Modèle"}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedTemplate && (
                <div className="mt-2.5">
                  <div className="rounded-[12px] bg-stone/40 p-3">
                    <p className="text-xs font-semibold text-ink/70">{selectedTemplate.subject}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-ink/50">{selectedTemplate.content}</p>
                  </div>
                  <button
                    className="mt-2 w-full rounded-[12px] bg-forest/8 py-2 text-xs font-semibold text-forest transition-colors hover:bg-forest/15"
                    onClick={() => applyTemplate(selectedTemplate)}
                  >
                    Appliquer dans l&apos;editeur
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right column: compose + send */}
          <div className="flex flex-col gap-5">
            {/* Compose */}
            <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Rediger</p>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-ink/60">Objet du message</label>
                  <input
                    className="rounded-[14px] border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    placeholder="Ex: La vente est ouverte !"
                    value={draft.subject}
                    onChange={(e) => setDraft((prev) => ({ ...prev, subject: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-ink/60">Contenu</label>
                  <RichTextEditor
                    value={draft.content}
                    onChange={(html) => setDraft((prev) => ({ ...prev, content: html }))}
                    placeholder={"Bonjour,\n\nVotre message ici...\n\nÀ bientôt,\nLa Brouette"}
                    minHeightClass="min-h-[300px]"
                  />
                  {draft.content.trim() ? (
                    <div className="rounded-[16px] border border-clay/70 bg-stone/30 p-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">
                        Apercu email final
                      </p>
                      <div
                        className="markdown max-w-none text-sm leading-6 text-ink/75"
                        dangerouslySetInnerHTML={{ __html: composerPreviewHtml }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Send */}
            <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/50">Envoyer</p>

              {/* Test */}
              <div className="mt-4 rounded-[16px] border border-ink/8 bg-stone/30 p-4">
                <p className="text-xs font-semibold text-ink/55">Test - envoyer à une seule adresse</p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-[12px] border border-ink/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    value={draft.testEmail}
                    onChange={(e) => setDraft((prev) => ({ ...prev, testEmail: e.target.value }))}
                    placeholder="email@test.com"
                    type="email"
                  />
                  <button
                    className="shrink-0 rounded-[12px] border border-ink/20 px-4 py-2.5 text-sm font-semibold text-ink/65 transition-colors hover:bg-stone/60 disabled:opacity-40"
                    onClick={() => sendMessage("test")}
                    disabled={
                      !draft.subject.trim() || !draft.content.trim() || !draft.testEmail.trim() || sending
                    }
                  >
                    {sending ? "..." : "Tester"}
                  </button>
                </div>
              </div>

              {/* Main send */}
              <div className="mt-3 flex items-center justify-between gap-3 rounded-[16px] bg-forest/6 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {getTargetLabel(
                      draft.target,
                      contactLists.find((l) => l.id === draft.contactListId)?.name,
                    )}
                  </p>
                  <p className="text-xs text-ink/55">
                    {typeof estimatedTargetCount === "number"
                      ? `~${estimatedTargetCount} destinataires`
                      : "Nombre calcule au moment de l'envoi"}
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-full bg-forest px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-forest/90 disabled:opacity-50"
                  onClick={() => sendMessage("send")}
                  disabled={!canSendMain || sending}
                >
                  {sending ? "Envoi..." : "Envoyer"}
                </button>
              </div>

              {/* Save as template shortcut */}
              <div className="mt-4 border-t border-ink/8 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink/45">
                  Sauvegarder comme modele
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-[12px] border border-ink/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    placeholder="Nom du modele..."
                    value={quickTemplateName}
                    onChange={(e) => setQuickTemplateName(e.target.value)}
                  />
                  <button
                    className="shrink-0 rounded-[12px] border border-ink/15 px-4 py-2 text-sm font-semibold text-ink/60 transition-colors hover:bg-stone/40 disabled:opacity-40"
                    onClick={saveQuickTemplate}
                    disabled={!draft.subject.trim() || !draft.content.trim() || !quickTemplateName.trim()}
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TEMPLATES TAB
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "templates" && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif text-xl">Modèles de message</h3>
              <p className="mt-0.5 text-sm text-ink/60">{templates.length} modele(s) personnalise(s)</p>
            </div>
            <button
              className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-forest/90"
              onClick={() => setEditingTemplate({ id: null, name: "", subject: "", content: "" })}
            >
              + Nouveau modele
            </button>
          </div>

          {/* Edit / Create form */}
          {editingTemplate && (
            <div className="rounded-[24px] border-2 border-forest/30 bg-white/90 p-6 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest/70">
                {editingTemplate.id ? "Modifier le modele" : "Nouveau modele"}
              </p>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-ink/60">Nom du modele</label>
                  <input
                    className="rounded-[14px] border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    placeholder="Ex: Rappel retrait ete"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-ink/60">Objet</label>
                  <input
                    className="rounded-[14px] border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    placeholder="Objet de l'email"
                    value={editingTemplate.subject}
                    onChange={(e) =>
                      setEditingTemplate((prev) => (prev ? { ...prev, subject: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-ink/60">Contenu</label>
                  <RichTextEditor
                    value={editingTemplate.content}
                    onChange={(html) =>
                      setEditingTemplate((prev) => (prev ? { ...prev, content: html } : prev))
                    }
                    minHeightClass="min-h-[200px]"
                  />
                  {editingTemplate.content.trim() ? (
                    <div className="rounded-[16px] border border-clay/70 bg-stone/30 p-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">
                        Apercu email final
                      </p>
                      <div
                        className="markdown max-w-none text-sm leading-6 text-ink/75"
                        dangerouslySetInnerHTML={{ __html: templatePreviewHtml }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-full bg-forest px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest/90"
                    onClick={saveTemplate}
                  >
                    {editingTemplate.id ? "Mettre à jour" : "Créer"}
                  </button>
                  <button
                    className="rounded-full border border-ink/15 px-5 py-2 text-sm font-semibold text-ink/60 transition-colors hover:bg-stone/40"
                    onClick={() => setEditingTemplate(null)}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Built-in templates */}
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/40">
              Modèles intégrés
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {BUILTIN_TEMPLATES.map((tmpl) => (
                <div key={tmpl.id} className="rounded-[20px] border border-clay/50 bg-white/90 p-5 shadow-card">
                  <span className="rounded-full bg-ink/6 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/45">
                    Integre
                  </span>
                  <p className="mt-2 font-semibold text-ink">{tmpl.name}</p>
                  <p className="mt-0.5 text-xs text-ink/55">{tmpl.subject}</p>
                  <p className="mt-3 line-clamp-3 text-[12px] leading-5 text-ink/50">{tmpl.content}</p>
                  <button
                    className="mt-3 w-full rounded-[12px] bg-forest/8 py-2 text-xs font-semibold text-forest transition-colors hover:bg-forest/15"
                    onClick={() => {
                      applyTemplate(tmpl);
                      setSelectedTemplateKey(`builtin:${tmpl.id}`);
                      setActiveTab("composer");
                    }}
                  >
                    Utiliser dans le compositeur
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Custom templates */}
          {templates.length > 0 && (
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/40">
                Modèles personnalisés
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {templates.map((tmpl) => (
                  <div key={tmpl.id} className="rounded-[20px] border border-clay/60 bg-white/90 p-5 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{tmpl.name ?? "Modèle"}</p>
                        <p className="mt-0.5 text-xs text-ink/55">{tmpl.subject}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          className="rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-semibold text-ink/55 transition-colors hover:bg-stone/50"
                          onClick={() =>
                            setEditingTemplate({
                              id: tmpl.id,
                              name: tmpl.name ?? "",
                              subject: tmpl.subject ?? "",
                              content: tmpl.content ?? "",
                            })
                          }
                        >
                          Modifier
                        </button>
                        <button
                          className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-50"
                          onClick={() => setDeleteTemplateId(tmpl.id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-3 text-[12px] leading-5 text-ink/50">
                      {stripHtmlToText(tmpl.content ?? "")}
                    </p>
                    <p className="mt-2 text-[10px] text-ink/35">Modifie: {fmtDate(tmpl.updatedAt)}</p>
                    <button
                      className="mt-3 w-full rounded-[12px] bg-forest/8 py-2 text-xs font-semibold text-forest transition-colors hover:bg-forest/15"
                      onClick={() => {
                        applyTemplate(tmpl);
                        setSelectedTemplateKey(`custom:${tmpl.id}`);
                        setActiveTab("composer");
                      }}
                    >
                      Utiliser dans le compositeur
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {templates.length === 0 && !editingTemplate && (
            <div className="rounded-[20px] border border-clay/40 bg-white/70 p-10 text-center">
              <p className="text-sm text-ink/60">Aucun modele personnalise.</p>
              <button
                className="mt-3 rounded-full bg-forest px-5 py-2 text-sm font-semibold text-white"
                onClick={() => setEditingTemplate({ id: null, name: "", subject: "", content: "" })}
              >
                Créer mon premier modèle
              </button>
            </div>
          )}

          {/* Delete confirm */}
          {deleteTemplateId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl">
                <p className="font-semibold text-ink">Supprimer ce modele ?</p>
                <p className="mt-1 text-sm text-ink/60">Cette action est irreversible.</p>
                <div className="mt-4 flex gap-3">
                  <button
                    className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                    onClick={confirmDeleteTemplate}
                  >
                    Supprimer
                  </button>
                  <button
                    className="flex-1 rounded-full border border-ink/15 py-2 text-sm font-semibold text-ink/60 transition-colors hover:bg-stone/40"
                    onClick={() => setDeleteTemplateId(null)}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          LISTS TAB
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "lists" && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif text-xl">Listes de diffusion</h3>
              <p className="mt-0.5 text-sm text-ink/60">{contactLists.length} liste(s) enregistree(s)</p>
            </div>
            <button
              className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-forest/90"
              onClick={() => {
                setEditingList({ id: null, name: "", description: "", memberIds: [] });
                setListSearchMembers("");
              }}
            >
              + Nouvelle liste
            </button>
          </div>

          {/* Edit / Create form */}
          {editingList && (
            <div className="rounded-[24px] border-2 border-forest/30 bg-white/90 p-6 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest/70">
                {editingList.id ? "Modifier la liste" : "Nouvelle liste"}
              </p>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                {/* Left: list info + selected preview */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-ink/60">Nom de la liste *</label>
                    <input
                      className="rounded-[14px] border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                      placeholder="Ex: Commandes printemps 2025"
                      value={editingList.name}
                      onChange={(e) => setEditingList((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-ink/60">Description (optionnel)</label>
                    <input
                      className="rounded-[14px] border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                      placeholder="Description courte..."
                      value={editingList.description}
                      onChange={(e) =>
                        setEditingList((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="rounded-[14px] bg-stone/40 p-3">
                    <p className="text-sm font-semibold text-ink">
                      {editingList.memberIds.length} membre(s) selectionne(s)
                    </p>
                    {editingList.memberIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {editingList.memberIds.slice(0, 8).map((id) => {
                          const m = members.find((member) => member.id === id);
                          return m ? (
                            <span
                              key={id}
                              className="flex items-center gap-1 rounded-full border border-ink/10 bg-white px-2 py-0.5 text-[11px]"
                            >
                              {fullName(m.firstName, m.lastName) || firstEmail(m)}
                              <button
                                className="text-ink/40 hover:text-red-500"
                                onClick={() => toggleListMember(id)}
                              >
                                ✕
                              </button>
                            </span>
                          ) : null;
                        })}
                        {editingList.memberIds.length > 8 && (
                          <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/50">
                            +{editingList.memberIds.length - 8} autres
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: member picker */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-ink/60">Ajouter des membres</label>
                  <input
                    className="rounded-[12px] border border-ink/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
                    placeholder="Rechercher un membre..."
                    value={listSearchMembers}
                    onChange={(e) => setListSearchMembers(e.target.value)}
                  />
                  <div className="flex gap-1.5">
                    <button
                      className="rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-semibold text-ink/55 hover:bg-stone/40"
                      onClick={() =>
                        setEditingList((prev) =>
                          prev ? { ...prev, memberIds: listMemberCandidates.map((m) => m.id) } : prev,
                        )
                      }
                    >
                      Tout cocher ({listMemberCandidates.length})
                    </button>
                    <button
                      className="rounded-lg border border-ink/12 px-2.5 py-1.5 text-[11px] font-semibold text-ink/55 hover:bg-stone/40"
                      onClick={() => setEditingList((prev) => (prev ? { ...prev, memberIds: [] } : prev))}
                    >
                      Vider
                    </button>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-[12px] border border-ink/8 bg-stone/20">
                    {listMemberCandidates.map((member) => {
                      const name = fullName(member.firstName, member.lastName) || "Membre";
                      const email = firstEmail(member) || "-";
                      const checked = editingList.memberIds.includes(member.id);
                      return (
                        <label
                          key={member.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-ink/5 px-3 py-2 last:border-0 hover:bg-stone/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleListMember(member.id)}
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-ink">{name}</p>
                            <p className="truncate text-[11px] text-ink/55">{email}</p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              member.role === "admin"
                                ? "bg-amber-100 text-amber-700"
                                : member.role === "referent"
                                  ? "bg-sky-100 text-sky-700"
                                  : isInactive(member.membershipStatus)
                                    ? "bg-red-50 text-red-400"
                                    : "bg-forest/10 text-forest"
                            }`}
                          >
                            {member.role === "admin"
                              ? "admin"
                              : member.role === "referent"
                                ? "ref"
                                : isInactive(member.membershipStatus)
                                  ? "inactif"
                                  : "adherent"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2 border-t border-ink/8 pt-4">
                <button
                  className="rounded-full bg-forest px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest/90"
                  onClick={saveContactList}
                >
                  {editingList.id ? "Mettre à jour" : "Créer la liste"}
                </button>
                <button
                  className="rounded-full border border-ink/15 px-5 py-2 text-sm font-semibold text-ink/60 transition-colors hover:bg-stone/40"
                  onClick={() => {
                    setEditingList(null);
                    setListSearchMembers("");
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* List cards */}
          {contactLists.length === 0 && !editingList ? (
            <div className="rounded-[20px] border border-clay/40 bg-white/70 p-10 text-center">
              <p className="text-sm text-ink/60">Aucune liste de diffusion.</p>
              <p className="mt-1 text-xs text-ink/40">
                Les listes permettent de cibler des groupes specifiques pour vos envois.
              </p>
              <button
                className="mt-3 rounded-full bg-forest px-5 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  setEditingList({ id: null, name: "", description: "", memberIds: [] });
                  setListSearchMembers("");
                }}
              >
                Créer ma première liste
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {contactLists.map((list) => (
                <div key={list.id} className="rounded-[20px] border border-clay/60 bg-white/90 p-5 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{list.name}</p>
                      {list.description && <p className="mt-0.5 text-xs text-ink/50">{list.description}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-forest/10 px-2.5 py-0.5 text-xs font-bold text-forest">
                      {list.memberIds?.length ?? 0}
                    </span>
                  </div>
                  {(list.memberIds?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(list.memberIds ?? []).slice(0, 4).map((id) => {
                        const m = members.find((member) => member.id === id);
                        return m ? (
                          <span key={id} className="rounded-full bg-stone/60 px-2 py-0.5 text-[10px] text-ink/60">
                            {fullName(m.firstName, m.lastName) || firstEmail(m)}
                          </span>
                        ) : null;
                      })}
                      {(list.memberIds?.length ?? 0) > 4 && (
                        <span className="rounded-full bg-stone/40 px-2 py-0.5 text-[10px] text-ink/40">
                          +{(list.memberIds?.length ?? 0) - 4} autres
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-ink/35">Modifiee: {fmtDate(list.updatedAt)}</p>
                  <div className="mt-3 flex gap-1.5">
                    <button
                      className="flex-1 rounded-[10px] bg-forest/8 py-2 text-xs font-semibold text-forest transition-colors hover:bg-forest/15"
                      onClick={() => {
                        setDraft((prev) => ({ ...prev, target: "contact-list", contactListId: list.id }));
                        setActiveTab("composer");
                      }}
                    >
                      Utiliser
                    </button>
                    <button
                      className="rounded-[10px] border border-ink/12 px-3 py-2 text-xs font-semibold text-ink/55 transition-colors hover:bg-stone/40"
                      onClick={() => {
                        setEditingList({
                          id: list.id,
                          name: list.name ?? "",
                          description: list.description ?? "",
                          memberIds: list.memberIds ?? [],
                        });
                        setListSearchMembers("");
                      }}
                    >
                      Modifier
                    </button>
                    <button
                      className="rounded-[10px] border border-red-200 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-50"
                      onClick={() => setDeleteListId(list.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Delete confirm */}
          {deleteListId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl">
                <p className="font-semibold text-ink">Supprimer cette liste ?</p>
                <p className="mt-1 text-sm text-ink/60">Cette action est irreversible.</p>
                <div className="mt-4 flex gap-3">
                  <button
                    className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                    onClick={confirmDeleteList}
                  >
                    Supprimer
                  </button>
                  <button
                    className="flex-1 rounded-full border border-ink/15 py-2 text-sm font-semibold text-ink/60 transition-colors hover:bg-stone/40"
                    onClick={() => setDeleteListId(null)}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          HISTORY TAB
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="font-serif text-xl">Historique des envois</h3>
            <p className="mt-0.5 text-sm text-ink/60">{messages.length} message(s) envoyé(s)</p>
          </div>

          {loading ? (
            <div className="rounded-[20px] border border-clay/40 bg-white/70 p-8 text-center">
              <p className="text-sm text-ink/60">Chargement...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-[20px] border border-clay/40 bg-white/70 p-8 text-center">
              <p className="text-sm text-ink/60">Aucun message envoyé pour l&apos;instant.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((item) => {
                const sentAt = item.stats?.sentAt?.toDate?.();
                const createdAt = item.createdAt?.toDate?.();
                const date = sentAt ?? createdAt;
                return (
                  <div key={item.id} className="rounded-[20px] border border-clay/50 bg-white/90 p-5 shadow-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{item.subject ?? "-"}</p>
                          {item.template?.name && (
                            <span className="rounded-full bg-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ink/50">
                              {item.template.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/55">
                          <span>{date ? date.toLocaleString("fr-FR") : "-"}</span>
                          <span>·</span>
                          <span>{item.targetLabel ?? item.target ?? "-"}</span>
                          <span>·</span>
                          <span className="font-semibold text-forest">
                            {item.stats?.recipients ?? 0} destinataires
                          </span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          item.status === "sent" ? "bg-forest/10 text-forest" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {item.status ?? "sent"}
                      </span>
                    </div>

                    <p className="mt-3 line-clamp-2 rounded-[10px] bg-stone/30 px-3 py-2 text-[12px] leading-5 text-ink/60">
                      {stripHtmlToText(item.content ?? "") || "-"}
                    </p>

                    {(item.stats?.recipientsPreview?.length ?? 0) > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {(item.stats?.recipientsPreview ?? []).slice(0, 6).map((email) => (
                          <span key={email} className="rounded-full bg-stone/50 px-2 py-0.5 text-[10px] text-ink/50">
                            {email}
                          </span>
                        ))}
                        {(item.stats?.recipients ?? 0) > 6 && (
                          <span className="rounded-full bg-stone/40 px-2 py-0.5 text-[10px] text-ink/35">
                            +{(item.stats?.recipients ?? 0) - 6} autres
                          </span>
                        )}
                      </div>
                    )}

                    {item.stats?.providerMessageIds?.[0] && (
                      <p className="mt-2 text-[10px] text-ink/30">Ref: {item.stats.providerMessageIds[0]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
