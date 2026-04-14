"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

type ProfileData = {
  firstName: string;
  lastName: string;
  addressStreet: string;
  addressPostalCode: string;
  addressCity: string;
  membershipStatus: "active" | "inactive";
  membershipPaymentStatus: "up_to_date" | "to_pay";
  membershipJoinedAt: string;
  emails: string[];
  phones: string[];
};

const DEFAULT_PROFILE: ProfileData = {
  firstName: "",
  lastName: "",
  addressStreet: "",
  addressPostalCode: "",
  addressCity: "",
  membershipStatus: "active",
  membershipPaymentStatus: "to_pay",
  membershipJoinedAt: "",
  emails: [""],
  phones: [""],
};

function uniqueNonEmpty(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function includesEmail(values: string[], email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  return values.some((value) => value.trim().toLowerCase() === target);
}

function toDateString(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toLocaleDateString("fr-FR");
  if (typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate?: () => Date }).toDate?.();
    if (date) return date.toLocaleDateString("fr-FR");
  }
  return "";
}

export default function ProfileForm({
  userId,
  onSaved,
  requireEditToggle = false,
  startInEdit = false,
  canEditStatus = true,
}: {
  userId: string;
  onSaved?: () => void;
  requireEditToggle?: boolean;
  startInEdit?: boolean;
  canEditStatus?: boolean;
}) {
  const { user, memberId } = useAuth();
  const [draft, setDraft] = useState<ProfileData>(DEFAULT_PROFILE);
  const [initialDraft, setInitialDraft] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(startInEdit || !requireEditToggle);
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const editable = useMemo(() => (!requireEditToggle ? true : editing), [editing, requireEditToggle]);
  const isOwnProfile = useMemo(() => {
    if (!user) return false;
    if (memberId && memberId === userId) return true;
    return user.uid === userId;
  }, [memberId, user, userId]);
  const authEmail = useMemo(
    () => (isOwnProfile ? String(user?.email ?? "").trim() : ""),
    [isOwnProfile, user?.email],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");
      const snap = await getDoc(doc(firebaseDb, "members", userId));
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        const rawStatus = String(data.membershipStatus ?? "");
        const membershipStatus = rawStatus === "inactive" || rawStatus === "non-adherent" ? "inactive" : "active";
        const rawPaymentStatus = String(data.membershipPaymentStatus ?? "");
        const membershipPaymentStatus =
          rawPaymentStatus === "up_to_date" || rawPaymentStatus === "a_jour" ? "up_to_date" : "to_pay";
        const emails = uniqueNonEmpty([
          ...toStringArray(data.emails),
          String(data.email ?? "").trim(),
        ]);
        const phones = uniqueNonEmpty([
          ...toStringArray(data.phones),
          String(data.phone ?? "").trim(),
        ]);
        const next: ProfileData = {
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
          addressStreet: String((data.address as { street?: string } | undefined)?.street ?? ""),
          addressPostalCode: String((data.address as { postalCode?: string } | undefined)?.postalCode ?? ""),
          addressCity: String((data.address as { city?: string } | undefined)?.city ?? ""),
          membershipStatus,
          membershipPaymentStatus,
          membershipJoinedAt: toDateString(data.membershipJoinedAt ?? data.membershipPaymentDate),
          emails: (() => {
            const nextEmails = emails.length ? emails : [""];
            if (!authEmail) return nextEmails;
            const withoutAuth = nextEmails.filter(
              (item) => item.trim().toLowerCase() !== authEmail.toLowerCase(),
            );
            return [authEmail, ...withoutAuth];
          })(),
          phones: phones.length ? phones : [""],
        };
        setDraft(next);
        setInitialDraft(next);
      } else {
        const emptyProfile: ProfileData = {
          ...DEFAULT_PROFILE,
          emails: authEmail ? [authEmail] : [""],
        };
        setDraft(emptyProfile);
        setInitialDraft(emptyProfile);
      }
      setEditing(startInEdit || !requireEditToggle);
      setLoading(false);
    };

    load().catch(() => setLoading(false));
  }, [userId, startInEdit, requireEditToggle, authEmail]);

  const setEmailAt = (index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      emails: prev.emails.map((item, i) => (i === index ? value : item)),
    }));
  };

  const setPhoneAt = (index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      phones: prev.phones.map((item, i) => (i === index ? value : item)),
    }));
  };

  const save = async () => {
    setMessage("");
    let emails = uniqueNonEmpty(draft.emails);
    const phones = uniqueNonEmpty(draft.phones);
    if (!draft.firstName.trim() || !draft.lastName.trim() || emails.length === 0 || phones.length === 0) {
      setMessage("Renseigne prénom, nom, au moins un email et un téléphone.");
      return;
    }

    if (isOwnProfile) {
      const loginEmail = String(draft.emails[0] ?? "").trim();
      if (!loginEmail) {
        setMessage("L'email principal est obligatoire.");
        return;
      }
      const currentEmail = String(firebaseAuth.currentUser?.email ?? "").trim();
      if (
        firebaseAuth.currentUser &&
        currentEmail &&
        loginEmail.toLowerCase() !== currentEmail.toLowerCase()
      ) {
        try {
          await updateEmail(firebaseAuth.currentUser, loginEmail);
        } catch (error) {
          const code = (error as { code?: string } | null)?.code;
          if (code === "auth/requires-recent-login") {
            setMessage("Reconnecte-toi puis reessaie de modifier l'email principal.");
            return;
          }
            setMessage("Impossible de modifier l'email principal.");
            return;
        }
      }
      emails = uniqueNonEmpty([loginEmail, ...emails.filter((item) => item !== loginEmail)]);
      if (!includesEmail(emails, loginEmail)) {
        emails = [loginEmail, ...emails];
      }
    } else if (authEmail && !includesEmail(emails, authEmail)) {
      emails = [authEmail, ...emails];
    }

    const payload: Record<string, unknown> = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      address: {
        street: draft.addressStreet.trim(),
        postalCode: draft.addressPostalCode.trim(),
        city: draft.addressCity.trim(),
      },
      emails,
      phones,
      email: emails[0],
      phone: phones[0],
      accessEmails: emails.map((item) => item.toLowerCase()),
      accountLabel: deleteField(),
      sharedAccountEnabled: deleteField(),
      secondaryFirstName: deleteField(),
      secondaryLastName: deleteField(),
      secondaryEmail: deleteField(),
      secondaryPhone: deleteField(),
      updatedAt: serverTimestamp(),
    };
    if (canEditStatus) {
      payload.membershipStatus = draft.membershipStatus;
      payload.membershipPaymentStatus = draft.membershipPaymentStatus;
      payload.membershipPaymentDate = deleteField();
      payload.membershipJoinedAt =
        draft.membershipPaymentStatus === "up_to_date" && draft.membershipJoinedAt
          ? draft.membershipJoinedAt
          : null;
    }

    await setDoc(doc(firebaseDb, "members", userId), payload, { merge: true });

    const nextDraft: ProfileData = {
      ...draft,
      emails,
      phones,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
    };
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    if (requireEditToggle) setEditing(false);
    setMessage("Profil mis à jour.");
    onSaved?.();
  };

  const cancelEdit = () => {
    setDraft(initialDraft);
    setEditing(false);
    setMessage("");
  };

  const savePassword = async () => {
    setPasswordMessage("");
    if (!isOwnProfile) return;
    if (!passwordCurrent.trim()) {
      setPasswordMessage("Renseigne ton mot de passe actuel.");
      return;
    }
    if (passwordNext.trim().length < 8) {
      setPasswordMessage("Le nouveau mot de passe doit contenir au moins 8 caracteres.");
      return;
    }
    if (passwordNext !== passwordConfirm) {
      setPasswordMessage("La confirmation ne correspond pas.");
      return;
    }

    const currentUser = firebaseAuth.currentUser;
    const currentEmail = String(currentUser?.email ?? "").trim();
    if (!currentUser || !currentEmail) {
      setPasswordMessage("Session invalide. Reconnecte-toi.");
      return;
    }

    try {
      setPasswordSaving(true);
      const credential = EmailAuthProvider.credential(currentEmail, passwordCurrent);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordNext);
      await updateDoc(doc(firebaseDb, "members", userId), {
        "auth.mustChangePassword": false,
        "auth.passwordUpdatedAt": serverTimestamp(),
      });
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      setPasswordMessage("Mot de passe mis a jour.");
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setPasswordMessage("Mot de passe actuel incorrect.");
        return;
      }
      if (code === "auth/weak-password") {
        setPasswordMessage("Nouveau mot de passe trop faible.");
        return;
      }
      setPasswordMessage("Impossible de modifier le mot de passe. Reessaie.");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <p className="text-sm text-ink/70">Chargement...</p>
      ) : (
        <>
          {requireEditToggle ? (
            <div className="flex flex-wrap gap-2">
              {!editing ? (
                <button
                  className="w-fit rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                  onClick={() => setEditing(true)}
                >
                  Modifier
                </button>
              ) : (
                <>
                  <button
                    className="w-fit rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
                    onClick={save}
                  >
                    Enregistrer
                  </button>
                  <button
                    className="w-fit rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold"
                    onClick={cancelEdit}
                  >
                    Annuler
                  </button>
                </>
              )}
            </div>
          ) : null}

          {editable ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Prénom
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.firstName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Nom
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.lastName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-2">
                  Adresse
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.addressStreet}
                    onChange={(event) => setDraft((prev) => ({ ...prev, addressStreet: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
                  Code postal
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.addressPostalCode}
                    onChange={(event) => setDraft((prev) => ({ ...prev, addressPostalCode: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70 md:col-span-3">
                  Ville
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    value={draft.addressCity}
                    onChange={(event) => setDraft((prev) => ({ ...prev, addressCity: event.target.value }))}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-clay/70 bg-stone/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Emails</p>
                <div className="mt-3 flex flex-col gap-2">
                  {draft.emails.map((value, index) => (
                    <div key={`email-${index}`} className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        type="email"
                        value={value}
                        onChange={(event) => setEmailAt(index, event.target.value)}
                      />
                      {draft.emails.length > 1 && !(isOwnProfile && index === 0) ? (
                        <button
                          className="rounded-full border border-ink/20 px-3 py-2 text-xs font-semibold"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              emails: prev.emails.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          Retirer
                        </button>
                      ) : null}
                      {isOwnProfile && index === 0 ? (
                        <span className="rounded-full border border-forest/30 bg-forest/10 px-2 py-1 text-[11px] font-semibold text-forest">
                          Email principal
                        </span>
                      ) : null}
                    </div>
                  ))}
                  <button
                    className="w-fit rounded-full border border-ink/20 px-3 py-1.5 text-xs font-semibold"
                    onClick={() => setDraft((prev) => ({ ...prev, emails: [...prev.emails, ""] }))}
                  >
                    + Ajouter un email
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-clay/70 bg-stone/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Téléphones</p>
                <div className="mt-3 flex flex-col gap-2">
                  {draft.phones.map((value, index) => (
                    <div key={`phone-${index}`} className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                        value={value}
                        onChange={(event) => setPhoneAt(index, event.target.value)}
                      />
                      {draft.phones.length > 1 ? (
                        <button
                          className="rounded-full border border-ink/20 px-3 py-2 text-xs font-semibold"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              phones: prev.phones.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          Retirer
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    className="w-fit rounded-full border border-ink/20 px-3 py-1.5 text-xs font-semibold"
                    onClick={() => setDraft((prev) => ({ ...prev, phones: [...prev.phones, ""] }))}
                  >
                    + Ajouter un téléphone
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-clay/70 bg-stone/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Prénom</p>
                  <p className="mt-1 text-sm text-ink">{draft.firstName || "-"}</p>
                </div>
                <div className="rounded-xl border border-clay/70 bg-stone/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Nom</p>
                  <p className="mt-1 text-sm text-ink">{draft.lastName || "-"}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-clay/70 bg-stone/40 p-3 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adresse</p>
                  <p className="mt-1 text-sm text-ink">{draft.addressStreet || "-"}</p>
                </div>
                <div className="rounded-xl border border-clay/70 bg-stone/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Code postal</p>
                  <p className="mt-1 text-sm text-ink">{draft.addressPostalCode || "-"}</p>
                </div>
                <div className="rounded-xl border border-clay/70 bg-stone/40 p-3 md:col-span-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Ville</p>
                  <p className="mt-1 text-sm text-ink">{draft.addressCity || "-"}</p>
                </div>
              </div>

              <div className="rounded-xl border border-clay/70 bg-stone/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Emails</p>
                <div className="mt-3 flex flex-col gap-2">
                  {uniqueNonEmpty(draft.emails).map((value, index) => (
                    <div key={`email-view-${index}`} className="flex items-center justify-between rounded-lg border border-clay/60 bg-white px-3 py-2">
                      <span className="text-sm text-ink">{value}</span>
                      {isOwnProfile && index === 0 ? (
                        <span className="rounded-full border border-forest/30 bg-forest/10 px-2 py-1 text-[11px] font-semibold text-forest">
                          Principal
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-clay/70 bg-stone/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Téléphones</p>
                <div className="mt-3 flex flex-col gap-2">
                  {uniqueNonEmpty(draft.phones).map((value, index) => (
                    <div key={`phone-view-${index}`} className="rounded-lg border border-clay/60 bg-white px-3 py-2 text-sm text-ink">
                      {value}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {isOwnProfile ? (
            <div className="rounded-xl border border-clay/70 bg-stone/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Securite</p>
              <p className="mt-1 text-sm text-ink/70">Changer mon mot de passe</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Mot de passe actuel
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    type="password"
                    value={passwordCurrent}
                    onChange={(event) => setPasswordCurrent(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Nouveau mot de passe
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    type="password"
                    value={passwordNext}
                    onChange={(event) => setPasswordNext(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Confirmer
                  <input
                    className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  className="w-fit rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink"
                  onClick={savePassword}
                  disabled={passwordSaving}
                >
                  {passwordSaving ? "Mise a jour..." : "Mettre a jour le mot de passe"}
                </button>
                {passwordMessage ? <p className="text-sm text-moss">{passwordMessage}</p> : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 rounded-xl border border-clay/70 bg-stone/50 p-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Statut</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {draft.membershipStatus === "inactive" ? "Inactif" : "Actif"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Adhésion</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {draft.membershipPaymentStatus === "up_to_date" ? "A jour" : "A payer"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Date adhésion</p>
              <p className="mt-1 text-sm text-ink">
                {draft.membershipPaymentStatus === "up_to_date" && draft.membershipJoinedAt
                  ? draft.membershipJoinedAt
                  : "-"}
              </p>
            </div>
          </div>

          {message ? <p className="text-sm text-moss">{message}</p> : null}

          {!requireEditToggle ? (
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
