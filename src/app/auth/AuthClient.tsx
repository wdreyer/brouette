"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { findMemberByUser } from "@/lib/members";

const ADHESION_EMAIL = "contact@labrouetteetlepanier.fr";

function secondaryEmailMessage(loginEmail: string, primaryEmail: string) {
  return primaryEmail
    ? `Attention, ${loginEmail} est une adresse secondaire. Connecte-toi avec l'adresse principale : ${primaryEmail}.`
    : "Attention, tu essaies de te connecter avec une adresse secondaire. Connecte-toi avec l'adresse principale du compte.";
}

async function lookupSecondaryEmail(email: string) {
  const response = await fetch("/api/auth/secondary-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) return null;
  return (await response.json()) as {
    ok?: boolean;
    emailMatch?: "primary" | "secondary" | "unknown";
    primaryEmail?: string;
  };
}

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
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      const requestedEmail = email.trim().toLowerCase();
      const preLoginEmailMatch = await lookupSecondaryEmail(requestedEmail);
      if (preLoginEmailMatch?.emailMatch === "secondary") {
        setMessage(secondaryEmailMessage(requestedEmail, preLoginEmailMatch.primaryEmail ?? ""));
        return;
      }

      const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
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
          {mode === "login" ? "Se connecter" : "Réinitialiser le mot de passe"}
        </h1>
        <p className="mt-2 text-sm text-ink/70">
          {mode === "login"
            ? "Connecte-toi pour accéder au catalogue."
            : "Saisis ton email et reçois un lien de réinitialisation."}
        </p>
      </section>

      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
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
              <div className="relative">
                <input
                  className="w-full rounded-xl border border-ink/20 bg-white px-3 py-2 pr-10 text-sm"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-ink/50 hover:text-ink"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c1.828 0 3.545-.463 5.043-1.276M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
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
          Les comptes sont créés par l&apos;équipe. Pour rejoindre la coop, contacte l&apos;équipe
          ou viens nous rencontrer lors d&apos;une distribution : un email te sera envoyé pour
          définir ton mot de passe.
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
