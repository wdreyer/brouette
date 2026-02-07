"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CartButton from "@/components/CartButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";

export default function HeaderBar() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const { role, user } = useAuth();

  return (
    <header className="relative z-10 border-b border-clay/70 bg-stone/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link className="flex flex-col" href={isAdmin ? "/admin" : "/"}>
          <span className="font-serif text-3xl font-semibold tracking-tight">La Brouette</span>
          <span className="text-[11px] uppercase tracking-[0.32em] text-ink/60">
            Epicerie locale
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {isAdmin ? (
            <Link
              className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
              href="/"
            >
              Retour boutique
            </Link>
          ) : (
            <>
              {role === "admin" ? (
                <Link
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
                  href="/admin"
                >
                  Admin
                </Link>
              ) : null}
              {user ? (
                <Link
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
                  href="/profil"
                >
                  Mon profil
                </Link>
              ) : null}
              {user ? (
                <button
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-semibold text-ink"
                  onClick={() => signOut(firebaseAuth)}
                >
                  Se deconnecter
                </button>
              ) : null}
              {user ? <CartButton /> : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
