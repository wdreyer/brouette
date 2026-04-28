"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { addDoc, collection, doc, getDocs, query, setDoc, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { findMemberByEmail, findMemberByUser, upsertMemberAccess } from "@/lib/members";

const ADHESION_EMAIL = "contact@labrouetteetlepanier.fr";

function authErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "Erreur inconnue.";
  const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
  switch (code) {
    case "auth/invalid-email":
      return "Adresse email invalide.";
    case "auth/invalid-credential":
      return "Email ou mot de passe incorrect.";
    case "auth/user-disabled":
      return "Ce compte est désactivé.";
    case "auth/too-many-requests":
      return "Trop de tentatives. Réessaie plus tard.";
    case "auth/email-already-in-use":
      return "Cet email est déjà utilisé.";
    case "auth/weak-password":
      return "Mot de passe trop faible (minimum 6 caractères).";
    case "auth/operation-not-allowed":
      return "L'inscription par email/mot de passe n'est pas activée sur Firebase.";
    case "permission-denied":
      return "Droits insuffisants sur la base. Vérifie les règles Firestore.";
    case "unavailable":
      return "Service temporairement indisponible. Réessaie dans un instant.";
    default:
      return String((error as { message?: string }).message ?? "Une erreur est survenue. Réessaie.");
  }
}

export default function AuthClient() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite") ?? "";
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(
    inviteToken ? "signup" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [token, setToken] = useState(inviteToken);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const redirectByRole = async (nextUser: typeof user) => {
    if (!nextUser) return;
    const memberMatch = await findMemberByUser(firebaseDb, nextUser);
    const role = memberMatch?.role ?? "member";
    if (role === "referent") {
      router.replace("/referent");
      return;
    }
    if (role === "admin") {
      router.replace("/admin");
      return;
    }
    router.replace("/");
  };

  useEffect(() => {
    if (user) {
      redirectByRole(user).catch(() => router.replace("/"));
    }
  }, [user, router]);

  const handleLogin = async () => {
    setLoading(true);
    setMessage("");
    setResetSent(false);
    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const loginEmail = String(cred.user.email ?? email).trim().toLowerCase();
      const memberEmailMatch = await findMemberByEmail(firebaseDb, loginEmail);
      if (memberEmailMatch?.emailMatch === "secondary") {
        await signOut(firebaseAuth);
        setMessage(
          "Vous essayez de vous connecter avec un email secondaire. Utilisez l'email principal du compte.",
        );
        return;
      }
      await redirectByRole(cred.user);
    } catch (error) {
      try {
        await addDoc(collection(firebaseDb, "authLoginAttempts"), {
          email: email.trim().toLowerCase(),
          success: false,
          code:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: string }).code ?? "")
              : "",
          createdAt: serverTimestamp(),
        });
      } catch {
        // ignore logging failure
      }
      setMessage(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setLoading(true);
    setMessage("");
    setResetSent(false);
    try {
      if (!token) {
        setMessage("Invite requise.");
        setLoading(false);
        return;
      }
      const inviteSnap = await getDocs(
        query(collection(firebaseDb, "invites"), where("token", "==", token), where("used", "==", false)),
      );
      if (inviteSnap.empty) {
        setMessage("Invitation invalide ou déjà utilisée.");
        setLoading(false);
        return;
      }
      const inviteDoc = inviteSnap.docs[0];
      const invite = inviteDoc.data() as { email?: string; role?: string; memberId?: string };
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        setMessage("Cette invitation est liée à un autre email.");
        setLoading(false);
        return;
      }
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      const role = invite.role === "admin" ? "admin" : invite.role === "referent" ? "referent" : "member";
      let targetMemberId = String(invite.memberId ?? "").trim();
      if (!targetMemberId) {
        const memberSnap = await getDocs(
          query(collection(firebaseDb, "members"), where("email", "==", email)),
        );
        if (!memberSnap.empty) {
          targetMemberId = memberSnap.docs[0].id;
        }
      }
      if (!targetMemberId) {
        const memberByAccessSnap = await getDocs(
          query(
            collection(firebaseDb, "members"),
            where("accessEmails", "array-contains", email.trim().toLowerCase()),
          ),
        );
        if (!memberByAccessSnap.empty) {
          targetMemberId = memberByAccessSnap.docs[0].id;
        }
      }
      if (!targetMemberId) {
        targetMemberId = cred.user.uid;
      }

      await setDoc(
        doc(firebaseDb, "members", targetMemberId),
        {
          email,
          emails: [email],
          accessEmails: [email.trim().toLowerCase()],
          auth: { uid: cred.user.uid, role },
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      await upsertMemberAccess(firebaseDb, {
        uid: cred.user.uid,
        memberId: targetMemberId,
        role,
        email,
      });
      await updateDoc(doc(firebaseDb, "invites", inviteDoc.id), {
        used: true,
        usedAt: serverTimestamp(),
        usedBy: cred.user.uid,
      });
      await redirectByRole(cred.user);
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setMessage("");
    setResetSent(false);
    if (!resetEmail.trim()) {
      setMessage("Renseigne ton email.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, resetEmail.trim(), {
        url: `${window.location.origin}/auth`,
        handleCodeInApp: false,
      });
      setResetSent(true);
      setMessage(
        "Si ce compte existe, un lien de réinitialisation vient d'être envoyé. Vérifie aussi tes spams.",
      );
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-12">
      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Connexion</p>
        <h1 className="mt-2 font-serif text-3xl">
          {mode === "login"
            ? "Se connecter"
            : mode === "signup"
              ? "Activer mon compte"
              : "Réinitialiser le mot de passe"}
        </h1>
        <p className="mt-2 text-sm text-ink/70">
          {mode === "login"
            ? "Connecte-toi pour accéder au catalogue."
            : mode === "signup"
              ? "Un compte est possible uniquement sur invitation."
              : "Saisis ton email et reçois un lien de réinitialisation."}
        </p>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        {mode === "signup" ? (
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
            Code d'invitation
            <input
              className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
        ) : null}
        {mode === "forgot" ? (
          <form
            className="mt-2 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              handleForgotPassword().catch(() => undefined);
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Email
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="ton@email.com"
                autoComplete="email"
              />
            </label>
            <button
              type="submit"
              className="w-fit rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              disabled={loading}
            >
              {loading ? "Envoi..." : "Envoyer le lien"}
            </button>
          </form>
        ) : (
          <>
            <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Email
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-ink/70">
              Mot de passe
              <input
                className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {mode === "login" ? (
              <button
                type="button"
                className="mt-2 w-fit text-left text-xs font-semibold text-forest underline-offset-2 hover:underline"
                onClick={() => {
                  setResetEmail(email);
                  setMode("forgot");
                  setMessage("");
                  setResetSent(false);
                }}
                disabled={loading}
              >
                Mot de passe oublié ?
              </button>
            ) : null}
          </>
        )}

        {message ? (
          <p className={`mt-3 text-sm ${resetSent ? "text-forest" : "text-ember"}`}>{message}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {mode === "login" ? (
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          ) : mode === "signup" ? (
            <button
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={handleSignup}
              disabled={loading}
            >
              {loading ? "Activation..." : "Créer le compte"}
            </button>
          ) : (
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink"
              onClick={() => {
                setMode("login");
                setMessage("");
                setResetSent(false);
              }}
            >
              Retour à la connexion
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">
          Pas encore adhérent ?
        </p>
        <h2 className="mt-2 font-serif text-2xl">Découvrir la coop</h2>
        <p className="mt-2 text-sm text-ink/70">
          L'inscription est réservée aux adhérents invités. Pour rejoindre la coop ou obtenir une
          invitation, contacte l'équipe ou viens nous rencontrer lors d'une distribution.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink"
            href={`mailto:${ADHESION_EMAIL}?subject=${encodeURIComponent("Demande d'adhésion")}`}
          >
            Nous contacter
          </a>
          <a
            className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink"
            href="https://labrouetteetlepanier.fr"
            target="_blank"
            rel="noopener noreferrer"
          >
            Site de l&apos;association
          </a>
        </div>
      </section>
    </div>
  );
}
