"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import CartButton from "@/components/CartButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { firebaseAuth } from "@/lib/firebase/client";

export default function HeaderBar() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const { role, user, effectiveRole } = useAuth();
  const roleBadgeLabel =
    effectiveRole === "admin" ? "Role: Admin" : effectiveRole === "referent" ? "Role: Referent" : null;

  return (
    <header className="relative z-10 border-b border-clay/90 bg-stone/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-4 py-3 md:px-6">
        <Link className="flex flex-col" href={isAdmin ? "/admin" : "/"}>
          <span className="font-serif text-3xl font-semibold tracking-tight">La Brouette</span>
          <span className="text-[11px] uppercase tracking-[0.32em] text-ink/60">Epicerie locale</span>
        </Link>

        <div className="flex items-center gap-3">
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
    </header>
  );
}
