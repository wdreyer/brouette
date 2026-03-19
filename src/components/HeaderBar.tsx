"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import CartButton from "@/components/CartButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseAuth } from "@/lib/firebase/client";

type TestAccount = {
  key: string;
  label: string;
  email: string;
  password: string;
};

function buildTestAccounts(): TestAccount[] {
  const globalPassword = process.env.NEXT_PUBLIC_TEST_AUTH_PASSWORD ?? "Test123456!";
  const withPassword = (password?: string) => password ?? globalPassword;
  return [
    {
      key: "referent",
      label: "Referent",
      email: process.env.NEXT_PUBLIC_TEST_AUTH_REFERENT_EMAIL ?? "referent.test@brouette.local",
      password: withPassword(process.env.NEXT_PUBLIC_TEST_AUTH_REFERENT_PASSWORD),
    },
    {
      key: "admin",
      label: "Admin",
      email: process.env.NEXT_PUBLIC_TEST_AUTH_ADMIN_EMAIL ?? "admin.test@brouette.local",
      password: withPassword(process.env.NEXT_PUBLIC_TEST_AUTH_ADMIN_PASSWORD),
    },
    {
      key: "member1",
      label: "Adherent 1",
      email: process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER1_EMAIL ?? "adherent1.test@brouette.local",
      password: withPassword(process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER1_PASSWORD),
    },
    {
      key: "member2",
      label: "Adherent 2",
      email: process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER2_EMAIL ?? "adherent2.test@brouette.local",
      password: withPassword(process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER2_PASSWORD),
    },
    {
      key: "member3",
      label: "Adherent 3",
      email: process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER3_EMAIL ?? "adherent3.test@brouette.local",
      password: withPassword(process.env.NEXT_PUBLIC_TEST_AUTH_MEMBER3_PASSWORD),
    },
  ];
}

export default function HeaderBar() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const { role, user, effectiveRole } = useAuth();
  const [testKey, setTestKey] = useState("referent");
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState("");

  const testAccounts = useMemo(() => buildTestAccounts(), []);
  const selectedTestAccount = testAccounts.find((account) => account.key === testKey) ?? testAccounts[0];

  const roleBadgeLabel =
    effectiveRole === "admin" ? "Role : Admin" : effectiveRole === "referent" ? "Role : Referent" : null;

  const loginAsTest = async () => {
    setTestError("");
    if (!selectedTestAccount?.email || !selectedTestAccount?.password) {
      setTestError("Configure les comptes de test dans .env.local.");
      return;
    }
    setTestLoading(true);
    try {
      if (firebaseAuth.currentUser) {
        await signOut(firebaseAuth);
      }
      await signInWithEmailAndPassword(
        firebaseAuth,
        selectedTestAccount.email.trim(),
        selectedTestAccount.password,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur de connexion test.";
      setTestError(message);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <header className="relative z-10 border-b border-clay/90 bg-stone/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-6">
        <Link className="block" href={isAdmin ? "/admin" : "/"}>
          <Image
            src="/brand/brouette_no_bg.png"
            alt="La Brouette & Le Panier"
            width={244}
            height={81}
            className="h-auto w-[180px] md:w-[220px]"
            priority
          />
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded border border-ink/20 bg-white px-2 py-1.5">
            <span className="text-[11px] font-semibold text-ink/70">Se connecter comme</span>
            <select
              className="rounded border border-ink/20 bg-white px-2 py-1 text-xs"
              value={testKey}
              onChange={(event) => setTestKey(event.target.value)}
            >
              {testAccounts.map((account) => (
                <option key={account.key} value={account.key}>
                  {account.label}
                </option>
              ))}
            </select>
            <button
              className="rounded border border-ink/25 bg-white px-2 py-1 text-xs font-semibold text-ink disabled:opacity-60"
              onClick={() => loginAsTest().catch(() => undefined)}
              disabled={testLoading}
            >
              {testLoading ? "Connexion..." : "OK"}
            </button>
          </div>

          {user && roleBadgeLabel ? (
            <span className="rounded border border-forest/40 bg-forest/10 px-3 py-2 text-xs font-semibold text-forest">
              {roleBadgeLabel}
            </span>
          ) : null}

          {isAdmin ? (
            <Link
              className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
              href="/"
            >
              Retour boutique
            </Link>
          ) : null}

          {!isAdmin && (role === "admin" || effectiveRole === "referent") ? (
            <Link
              className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
              href="/admin"
            >
              Administration
            </Link>
          ) : null}

          {user ? (
            <Link
              className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
              href="/profil"
            >
              Mon profil
            </Link>
          ) : null}

          {user ? (
            <button
              className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
              onClick={() => signOut(firebaseAuth)}
            >
              Se deconnecter
            </button>
          ) : null}

          {!isAdmin && user ? <CartButton /> : null}
        </div>
      </div>

      {testError ? (
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-2 md:px-6">
          <p className="text-xs text-ember">{testError}</p>
        </div>
      ) : null}
    </header>
  );
}
