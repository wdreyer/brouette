"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type ProfileData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  membershipStatus: "adherent" | "non-adherent" | "en-attente";
};

const DEFAULT_PROFILE: ProfileData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  membershipStatus: "en-attente",
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
        setDraft({
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          membershipStatus: (data.membershipStatus as ProfileData["membershipStatus"]) ?? "en-attente",
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
    const payload = {
      ...draft,
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
              <option value="adherent">Adherent</option>
              <option value="non-adherent">Non adherent</option>
              <option value="en-attente">En attente</option>
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
