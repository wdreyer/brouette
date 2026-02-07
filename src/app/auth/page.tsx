"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, query, setDoc, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export default function AuthPage() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite") ?? "";
  const [mode, setMode] = useState<"login" | "signup">(inviteToken ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(inviteToken);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const handleLogin = async () => {
    setLoading(true);
    setMessage("");
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      router.replace("/");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setLoading(true);
    setMessage("");
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
        setMessage("Invitation invalide ou deja utilisee.");
        setLoading(false);
        return;
      }
      const inviteDoc = inviteSnap.docs[0];
      const invite = inviteDoc.data() as { email?: string; role?: string };
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        setMessage("Cette invitation est liee a un autre email.");
        setLoading(false);
        return;
      }
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      await setDoc(doc(firebaseDb, "members", cred.user.uid), {
        email,
        auth: { uid: cred.user.uid, role: invite.role === "admin" ? "admin" : "member" },
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(firebaseDb, "invites", inviteDoc.id), {
        used: true,
        usedAt: serverTimestamp(),
        usedBy: cred.user.uid,
      });
      router.replace("/");
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setMessage(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-12">
      <section className="rounded-xl border border-clay/70 bg-white/95 p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink/60">Connexion</p>
        <h1 className="mt-2 font-serif text-3xl">
          {mode === "login" ? "Se connecter" : "Activer mon compte"}
        </h1>
        <p className="mt-2 text-sm text-ink/70">
          {mode === "login"
            ? "Connecte-toi pour acceder au catalogue."
            : "Un compte est possible uniquement sur invitation."}
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

        {message ? <p className="mt-3 text-sm text-ember">{message}</p> : null}

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
              className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-stone"
              onClick={handleSignup}
              disabled={loading}
            >
              {loading ? "Activation..." : "Creer le compte"}
            </button>
          )}
          <button
            className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "J'ai une invitation" : "J'ai deja un compte"}
          </button>
        </div>
      </section>
    </div>
  );
}
