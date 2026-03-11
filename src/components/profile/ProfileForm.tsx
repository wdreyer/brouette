"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type ProfileData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  accountLabel: string;
  sharedAccountEnabled: boolean;
  secondaryFirstName: string;
  secondaryLastName: string;
  secondaryEmail: string;
  secondaryPhone: string;
  membershipStatus: "active" | "inactive";
};

const DEFAULT_PROFILE: ProfileData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  accountLabel: "",
  sharedAccountEnabled: false,
  secondaryFirstName: "",
  secondaryLastName: "",
  secondaryEmail: "",
  secondaryPhone: "",
  membershipStatus: "active",
};

export default function ProfileForm({
  userId,
  locked,
  onSaved,
}: {
  userId: string;
  locked?: boolean;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const snap = await getDoc(doc(firebaseDb, "members", userId));
      if (snap.exists()) {
        const data = snap.data() as Partial<ProfileData>;
        const rawStatus = String(data.membershipStatus ?? "");
        const normalizedStatus =
          rawStatus === "inactive" || rawStatus === "non-adherent" ? "inactive" : "active";
        setDraft({
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          accountLabel: String((data as Record<string, unknown>).accountLabel ?? ""),
          sharedAccountEnabled: Boolean((data as Record<string, unknown>).sharedAccountEnabled),
          secondaryFirstName: String((data as Record<string, unknown>).secondaryFirstName ?? ""),
          secondaryLastName: String((data as Record<string, unknown>).secondaryLastName ?? ""),
          secondaryEmail: String((data as Record<string, unknown>).secondaryEmail ?? ""),
          secondaryPhone: String((data as Record<string, unknown>).secondaryPhone ?? ""),
          membershipStatus: normalizedStatus,
        });
      } else {
        setDraft(DEFAULT_PROFILE);
      }
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [userId]);

  const save = async () => {
    setMessage("");
    const accessEmails = [draft.email, draft.secondaryEmail]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const payload = {
      ...draft,
      accessEmails: Array.from(new Set(accessEmails)),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(firebaseDb, "members", userId), payload, { merge: true });
    setMessage("Profil mis a jour.");
    onSaved?.();
  };

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Prenom
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.firstName}
                onChange={(event) => setDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                disabled={locked}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Nom
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.lastName}
                onChange={(event) => setDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                disabled={locked}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Email
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
                disabled={locked}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Telephone
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.phone}
                onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))}
                disabled={locked}
              />
            </label>
          </div>

          <div className="rounded-xl border border-clay/70 bg-stone/60 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink/70">
              <input
                type="checkbox"
                checked={draft.sharedAccountEnabled}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, sharedAccountEnabled: event.target.checked }))
                }
                disabled={locked}
              />
              Activer un compte partage (plusieurs acces sur la meme fiche)
            </label>

            <label className="mt-3 flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Nom du compte (ex: Famille Martin)
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={draft.accountLabel}
                onChange={(event) => setDraft((prev) => ({ ...prev, accountLabel: event.target.value }))}
                disabled={locked}
              />
            </label>

            {draft.sharedAccountEnabled ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Prenom 2
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.secondaryFirstName}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, secondaryFirstName: event.target.value }))
                    }
                    disabled={locked}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Nom 2
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.secondaryLastName}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, secondaryLastName: event.target.value }))
                    }
                    disabled={locked}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Email 2
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    type="email"
                    value={draft.secondaryEmail}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, secondaryEmail: event.target.value }))
                    }
                    disabled={locked}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Telephone 2
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.secondaryPhone}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, secondaryPhone: event.target.value }))
                    }
                    disabled={locked}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
            Statut
            <select
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={draft.membershipStatus}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  membershipStatus: event.target.value as ProfileData["membershipStatus"],
                }))
              }
              disabled={locked}
            >
              <option value="active">Actif</option>
              <option value="inactive">Non</option>
            </select>
          </label>

          {message ? <p className="text-sm text-moss">{message}</p> : null}

          {!locked ? (
            <button
              className="w-fit rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={save}
            >
              Enregistrer
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
