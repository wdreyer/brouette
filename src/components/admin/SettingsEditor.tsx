"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";
import { readBalanceTrackingEnabled, writeBalanceTrackingEnabled } from "@/lib/balanceTracking";

export default function SettingsEditor({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [balanceTrackingEnabled, setBalanceTrackingEnabled] = useState(true);
  const [message, setMessage] = useState("");
  const [resettingMemberships, setResettingMemberships] = useState(false);
  const [membershipMessage, setMembershipMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const enabled = await readBalanceTrackingEnabled(firebaseDb);
        setBalanceTrackingEnabled(enabled);
      } catch {
        setMessage("Impossible de charger le parametre.");
      } finally {
        setLoading(false);
      }
    };
    load().catch(() => setLoading(false));
  }, []);

  const saveBalanceTracking = async (next: boolean) => {
    try {
      setSaving(true);
      setMessage("");
      await writeBalanceTrackingEnabled(firebaseDb, next);
      setBalanceTrackingEnabled(next);
      setMessage("Parametre enregistre.");
    } catch {
      setMessage("Impossible d'enregistrer le parametre.");
    } finally {
      setSaving(false);
    }
  };

  const resetAllMemberships = async () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Réinitialiser toutes les adhésions des adhérents ? Cette action passera tout le monde à 'Non payé'.",
      );
      if (!confirmed) return;
    }

    try {
      setResettingMemberships(true);
      setMembershipMessage("");

      const membersSnap = await getDocs(collection(firebaseDb, "members"));
      const targets = membersSnap.docs.filter((memberDoc) => {
        const data = memberDoc.data() as { auth?: { role?: string } };
        const role = String(data.auth?.role ?? "member").toLowerCase();
        return role !== "admin" && role !== "referent";
      });

      if (targets.length === 0) {
        setMembershipMessage("Aucun adhérent à réinitialiser.");
        return;
      }

      const CHUNK_SIZE = 380;
      for (let index = 0; index < targets.length; index += CHUNK_SIZE) {
        const batch = writeBatch(firebaseDb);
        const chunk = targets.slice(index, index + CHUNK_SIZE);
        chunk.forEach((memberDoc) => {
          batch.set(
            doc(firebaseDb, "members", memberDoc.id),
            {
              membershipPaymentStatus: "to_pay",
              membershipJoinedAt: null,
              membershipPaymentDate: null,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        });
        await batch.commit();
      }

      setMembershipMessage(`${targets.length} adhérents réinitialisés.`);
    } catch {
      setMembershipMessage("Impossible de réinitialiser les adhésions.");
    } finally {
      setResettingMemberships(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink/55">
          Administration
        </p>
        <h2 className="mt-2 font-serif text-3xl text-ink">{title}</h2>
        <p className="mt-2 text-sm text-ink/70">
          {description ?? "Configuration globale de la plateforme."}
        </p>
      </section>

      <section className="rounded-2xl border border-clay/70 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">Module</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Suivi des soldes</h3>
            <p className="mt-1 text-sm text-ink/65">Comptabilite des soldes des adherents.</p>
            {message ? <p className="mt-2 text-xs text-ink/70">{message}</p> : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                balanceTrackingEnabled
                  ? "border border-forest/35 bg-forest/10 text-forest"
                  : "border border-ink/25 bg-ink/5 text-ink/70"
              }`}
            >
              {loading ? "Chargement..." : balanceTrackingEnabled ? "ACTIF" : "INACTIF"}
            </span>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-ink/30 accent-forest"
                checked={balanceTrackingEnabled}
                onChange={(event) => {
                  saveBalanceTracking(event.target.checked).catch(() => undefined);
                }}
                disabled={loading || saving}
              />
              Activer le suivi des soldes
            </label>
            <span className="text-[11px] font-semibold text-ink/65">
              {saving ? "Enregistrement..." : "Enregistre automatiquement"}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-clay/70 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/55">Adhésions</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Basculement annuel</h3>
            <p className="mt-1 text-sm text-ink/65">
              Remettre tous les adhérents à "Non payé" pour démarrer une nouvelle année.
            </p>
            {membershipMessage ? <p className="mt-2 text-xs text-ink/70">{membershipMessage}</p> : null}
          </div>
          <button
            className="rounded-full border border-ember/35 bg-ember/10 px-4 py-2 text-sm font-semibold text-ember disabled:opacity-50"
            onClick={() => {
              resetAllMemberships().catch(() => undefined);
            }}
            disabled={resettingMemberships}
          >
            {resettingMemberships ? "Réinitialisation..." : "Réinitialiser toutes les adhésions"}
          </button>
        </div>
      </section>
    </div>
  );
}
