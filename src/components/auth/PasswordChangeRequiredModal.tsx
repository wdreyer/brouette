"use client";

import { useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

const QUICK_LOGIN_BYPASS_KEY = "brouette:skipMustChangePasswordForEmail";

export default function PasswordChangeRequiredModal() {
  const { user, memberId } = useAuth();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!user || !memberId) {
        setOpen(false);
        setChecking(false);
        return;
      }
      try {
        const memberSnap = await getDoc(doc(firebaseDb, "members", memberId));
        const data = memberSnap.data() as { auth?: { mustChangePassword?: boolean } } | undefined;
        const mustChange = Boolean(data?.auth?.mustChangePassword);
        const currentEmail = String(user.email ?? "").trim().toLowerCase();
        const quickLoginBypassEmail =
          typeof window !== "undefined"
            ? String(window.sessionStorage.getItem(QUICK_LOGIN_BYPASS_KEY) ?? "")
                .trim()
                .toLowerCase()
            : "";

        if (mustChange && currentEmail && quickLoginBypassEmail && quickLoginBypassEmail === currentEmail) {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(QUICK_LOGIN_BYPASS_KEY);
          }
          setOpen(false);
          return;
        }

        setOpen(mustChange);
      } catch {
        setOpen(false);
      } finally {
        setChecking(false);
      }
    };

    setChecking(true);
    load().catch(() => setChecking(false));
  }, [user, memberId]);

  const handleUpdatePassword = async () => {
    if (!memberId) return;
    setMessage("");

    if (!currentPassword.trim()) {
      setMessage("Renseigne ton mot de passe actuel.");
      return;
    }
    if (nextPassword.trim().length < 8) {
      setMessage("Le nouveau mot de passe doit contenir au moins 8 caracteres.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setMessage("La confirmation ne correspond pas.");
      return;
    }

    const authUser = firebaseAuth.currentUser;
    if (!authUser || !authUser.email) {
      setMessage("Session invalide. Reconnecte-toi.");
      return;
    }

    try {
      setSaving(true);
      const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
      await reauthenticateWithCredential(authUser, credential);
      await updatePassword(authUser, nextPassword);
      await updateDoc(doc(firebaseDb, "members", memberId), {
        "auth.mustChangePassword": false,
        "auth.passwordUpdatedAt": serverTimestamp(),
      });
      setOpen(false);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setMessage("");
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setMessage("Mot de passe actuel incorrect.");
        return;
      }
      if (code === "auth/weak-password") {
        setMessage("Nouveau mot de passe trop faible.");
        return;
      }
      setMessage("Impossible de mettre à jour le mot de passe. Réessaie.");
    } finally {
      setSaving(false);
    }
  };

  if (checking || !open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded-2xl border border-clay/60 bg-white p-6 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink/55">Securite</p>
        <h2 className="mt-2 font-serif text-2xl text-ink">Changement de mot de passe requis</h2>
        <p className="mt-2 text-sm text-ink/70">
          Ce compte utilise encore le mot de passe generique. Tu dois le changer pour continuer.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink/70">
            Mot de passe actuel
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink/70">
            Nouveau mot de passe
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink/70">
            Confirmer le nouveau mot de passe
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>

        {message ? <p className="mt-3 text-sm text-ember">{message}</p> : null}

        <button
          className="mt-5 w-full rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-stone disabled:opacity-50"
          onClick={handleUpdatePassword}
          disabled={saving}
        >
          {saving ? "Enregistrement..." : "Mettre à jour mon mot de passe"}
        </button>
      </div>
    </div>
  );
}
