"use client";

import { firebaseApp } from "@/lib/firebase/client";

export default function FirebaseStatus() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-stone px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink/70">
      Firebase: <span className="text-ink">{firebaseApp.name}</span>
    </div>
  );
}
