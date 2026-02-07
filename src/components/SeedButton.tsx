"use client";

import { useState } from "react";
import { resetDistributions } from "@/lib/firebase/seed";

export default function SeedButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const handleSeed = async () => {
    try {
      setStatus("loading");
      setMessage("");
      const result = await resetDistributions();
      setStatus("done");
      setMessage(
        `Periode reinitialisee: ${result.deleted} supprimees, ${result.created} creee.`,
      );
    } catch (error) {
      const err = error instanceof Error ? error.message : "Erreur inconnue.";
      setStatus("error");
      setMessage(err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        className="inline-flex w-fit items-center justify-center rounded-full bg-ember px-5 py-2 text-sm font-semibold text-white transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-70"
        onClick={handleSeed}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Reinitialisation..." : "Reinitialiser les distributions"}
      </button>
      {message ? (
        <p className={status === "error" ? "text-sm text-ember" : "text-sm text-moss"}>{message}</p>
      ) : null}
    </div>
  );
}
