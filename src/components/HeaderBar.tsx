"use client";

import Image from "next/image";
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
    effectiveRole === "admin" ? "Rôle : Admin" : effectiveRole === "referent" ? "Rôle : Référent" : null;

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
          <a
            href="https://labrouetteetlepanier.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
          >
            Site de l&apos;association
          </a>

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

          {!isAdmin && user ? (
            <Link
              className="rounded border border-ink/25 bg-white px-4 py-2 text-xs font-semibold text-ink"
              href="/calendrier"
            >
              Calendrier
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
              Se déconnecter
            </button>
          ) : null}

          {!isAdmin && user ? <CartButton /> : null}
        </div>
      </div>
    </header>
  );
}
