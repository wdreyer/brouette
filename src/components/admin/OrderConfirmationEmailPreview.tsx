"use client";

import { useState } from "react";
import { reportError } from "@/lib/reportError";

type PreviewResult = {
  sample: boolean;
  recipientEmail?: string | null;
  subject: string;
  html: string;
  text: string;
};

export default function OrderConfirmationEmailPreview() {
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [showText, setShowText] = useState(false);

  const load = async (targetOrderId: string) => {
    setLoading(true);
    setError("");
    try {
      const url = targetOrderId
        ? `/api/admin/order-confirmation-preview?orderId=${encodeURIComponent(targetOrderId)}`
        : "/api/admin/order-confirmation-preview";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPreview(null);
        setError(data.error || "Impossible de charger l'aperçu.");
        return;
      }
      setPreview(data as PreviewResult);
    } catch (err) {
      setPreview(null);
      setError("Erreur reseau lors du chargement de l'apercu.");
      reportError("Echec de l'apercu email de confirmation", err, { silent: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
        <h1 className="font-serif text-2xl">Email de confirmation de commande</h1>
        <p className="mt-1 text-sm text-ink/60">
          Apercu en lecture seule de l&apos;email envoye automatiquement apres validation d&apos;une commande.
          Le contenu est genere par le code ; cette page ne permet pas de le modifier.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
            ID de commande (optionnel)
            <input
              className="w-64 rounded-[14px] border border-ink/15 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest/30"
              placeholder="Ex: aBcD1234..."
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={loading || !orderId.trim()}
            onClick={() => load(orderId.trim())}
          >
            Charger cette commande
          </button>
          <button
            type="button"
            className="rounded-md border border-ink/20 bg-white px-4 py-2.5 text-sm font-semibold text-ink/70 disabled:opacity-50"
            disabled={loading}
            onClick={() => {
              setOrderId("");
              load("");
            }}
          >
            Voir un exemple
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>

      {loading ? (
        <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 text-sm text-ink/60 shadow-card">
          Chargement de l&apos;apercu...
        </div>
      ) : null}

      {!loading && preview ? (
        <div className="rounded-[24px] border border-clay/60 bg-white/90 p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                {preview.sample ? "Donnees d'exemple" : "Commande reelle"}
              </p>
              <p className="mt-1 text-sm text-ink/70">
                <span className="font-semibold">Objet :</span> {preview.subject}
              </p>
              {!preview.sample ? (
                <p className="text-sm text-ink/70">
                  <span className="font-semibold">Destinataire :</span> {preview.recipientEmail || "email manquant"}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-md border border-ink/20 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70"
              onClick={() => setShowText((prev) => !prev)}
            >
              {showText ? "Voir le rendu HTML" : "Voir le texte brut"}
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-[16px] border border-ink/10">
            {showText ? (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap bg-stone/20 p-4 text-sm text-ink/80">
                {preview.text}
              </pre>
            ) : (
              <iframe
                title="Apercu email de confirmation"
                className="h-[70vh] w-full bg-white"
                sandbox=""
                srcDoc={preview.html}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
