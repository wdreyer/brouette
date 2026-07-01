"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Erreur de rendu non geree", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="font-serif text-3xl">Un imprévu est survenu</h1>
      <p className="text-sm text-ink/70">
        Quelque chose s&apos;est mal passé pendant l&apos;affichage de cette page. Réessaie, et si le
        problème persiste, préviens un admin.
      </p>
      <div className="flex gap-3">
        <button
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-stone"
          onClick={() => reset()}
        >
          Réessayer
        </button>
        <Link
          className="rounded-full border border-ink/20 bg-white px-5 py-2.5 text-sm font-semibold text-ink"
          href="/"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
