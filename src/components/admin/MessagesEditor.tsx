"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, setDoc, doc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type MessageDoc = {
  id: string;
  target?: string;
  distributionId?: string;
  subject?: string;
  status?: string;
  content?: string;
  stats?: { recipients?: number; sentAt?: { toDate?: () => Date } };
};

const TEMPLATES = [
  {
    id: "opening",
    label: "Ouverture de la vente",
    subject: "La vente est ouverte",
    content:
      "Bonjour,\n\nLa vente est maintenant ouverte. Tu peux preparer ta commande directement depuis la boutique.\n\nA bientot,\nLa Brouette",
  },
  {
    id: "reminder",
    label: "Rappel avant fermeture",
    subject: "Derniers jours pour commander",
    content:
      "Bonjour,\n\nLa vente ferme bientot. Pense a verifier ton panier et a valider ta commande avant la cloture.\n\nA bientot,\nLa Brouette",
  },
  {
    id: "pickup",
    label: "Infos retrait",
    subject: "Informations de retrait",
    content:
      "Bonjour,\n\nVoici les informations utiles pour le retrait de ta commande : horaires, lieu et consignes pratiques.\n\nA bientot,\nLa Brouette",
  },
];

export default function MessagesEditor() {
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    target: "all-members",
    distributionId: "",
    subject: "",
    status: "draft",
    content: "",
  });

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(query(collection(firebaseDb, "messages"), orderBy("createdAt", "desc")));
    setMessages(
      snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<MessageDoc, "id">),
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const canCreate = useMemo(
    () => draft.subject.trim().length > 0 && draft.content.trim().length > 0,
    [draft],
  );

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setDraft((prev) => ({
      ...prev,
      subject: template.subject,
      content: template.content,
    }));
  };

  const saveDraft = async () => {
    if (!canCreate) return;
    try {
      await addDoc(collection(firebaseDb, "messages"), {
        target: draft.target,
        distributionId: draft.distributionId || null,
        subject: draft.subject.trim(),
        status: draft.status,
        content: draft.content,
        stats: { recipients: 0, sentAt: null },
        createdAt: serverTimestamp(),
      });
      setDraft({
        target: "all-members",
        distributionId: "",
        subject: "",
        status: "draft",
        content: "",
      });
      setMessage("Message enregistre.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    }
  };

  const duplicateTemplate = async (item: MessageDoc) => {
    setDraft({
      target: item.target ?? "all-members",
      distributionId: item.distributionId ?? "",
      subject: item.subject ?? "",
      status: "draft",
      content: item.content ?? "",
    });
    setMessage("Template recharge dans l'editeur.");
  };

  const markReady = async (id: string) => {
    await setDoc(doc(firebaseDb, "messages", id), { status: "ready" }, { merge: true });
    await load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[28px] border border-clay/60 bg-white/90 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/55">Messages</p>
        <h2 className="mt-2 font-serif text-3xl">Templates et campagnes</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/70">
          Prepare les messages de vente, les rappels et les informations de retrait dans un format reutilisable.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="rounded-[28px] border border-clay/60 bg-white/92 p-6 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/55">Templates rapides</p>
          <div className="mt-4 grid gap-3">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="rounded-[22px] border border-clay/60 bg-stone/40 px-4 py-4 text-left transition hover:bg-white"
                onClick={() => applyTemplate(template.id)}
              >
                <p className="text-sm font-semibold text-ink">{template.label}</p>
                <p className="mt-1 text-xs text-ink/60">{template.subject}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-clay/60 bg-white/92 p-6 shadow-card">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Cible
              <select
                className="rounded-[18px] border border-ink/15 bg-white px-4 py-3 text-sm"
                value={draft.target}
                onChange={(event) => setDraft((prev) => ({ ...prev, target: event.target.value }))}
              >
                <option value="all-members">Tous les adherents</option>
                <option value="buyers">Seulement les commandeurs</option>
                <option value="referents">Référents</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Statut
              <select
                className="rounded-[18px] border border-ink/15 bg-white px-4 py-3 text-sm"
                value={draft.status}
                onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="draft">Brouillon</option>
                <option value="ready">Pret</option>
                <option value="sent">Envoye</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
              Objet
              <input
                className="rounded-[18px] border border-ink/15 bg-white px-4 py-3 text-sm"
                value={draft.subject}
                onChange={(event) => setDraft((prev) => ({ ...prev, subject: event.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
              Message
              <textarea
                className="min-h-[280px] rounded-[22px] border border-ink/15 bg-white px-4 py-4 text-sm leading-7"
                value={draft.content}
                onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone disabled:opacity-50"
              disabled={!canCreate}
              onClick={saveDraft}
            >
              Enregistrer le template
            </button>
            {message ? <p className="text-sm text-ink/70">{message}</p> : null}
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-clay/60 bg-white/92 p-6 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink/55">Historique</p>
            <h3 className="mt-2 font-serif text-2xl">Messages enregistres</h3>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-ink/70">Chargement...</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-clay/60 text-[11px] uppercase tracking-[0.16em] text-ink/55">
                <tr>
                  <th className="px-3 py-3">Objet</th>
                  <th className="px-3 py-3">Cible</th>
                  <th className="px-3 py-3">Statut</th>
                  <th className="px-3 py-3">Destinataires</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((item) => (
                  <tr key={item.id} className="border-b border-clay/40">
                    <td className="px-3 py-4">
                      <p className="font-semibold text-ink">{item.subject ?? "-"}</p>
                      <p className="mt-1 line-clamp-2 max-w-xl text-xs leading-6 text-ink/60">{item.content ?? "-"}</p>
                    </td>
                    <td className="px-3 py-4 text-ink/70">{item.target ?? "-"}</td>
                    <td className="px-3 py-4">
                      <span className="rounded-full border border-clay/60 bg-stone px-3 py-1 text-xs font-semibold text-ink/75">
                        {item.status ?? "draft"}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-ink/70">{item.stats?.recipients ?? 0}</td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold"
                          onClick={() => duplicateTemplate(item)}
                        >
                          Reutiliser
                        </button>
                        {item.status !== "ready" ? (
                          <button
                            className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold"
                            onClick={() => markReady(item.id)}
                          >
                            Marquer pret
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
