"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Erreur globale non geree", error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="bg-stone text-ink font-sans antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="font-serif text-3xl">Le site a rencontré un problème</h1>
          <p className="text-sm text-ink/70">
            Réessaie dans un instant. Si ça persiste, préviens un admin.
          </p>
          <div className="flex gap-3">
            <button
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-stone"
              onClick={() => reset()}
            >
              Réessayer
            </button>
            {/* global-error remplace tout le root layout (html/body inclus) : un lien Next classique est
                le choix recommandé par la doc Next.js pour ce fichier précis. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              className="rounded-full border border-ink/20 bg-white px-5 py-2.5 text-sm font-semibold text-ink"
              href="/"
            >
              Retour à l&apos;accueil
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
