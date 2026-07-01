import { toast } from "sonner";

/**
 * Point d'entrée unique pour les erreurs qui doivent être diagnosticables :
 * log console (pour retrouver le détail technique) + toast visible (pour que
 * l'utilisateur sache que quelque chose a échoué au lieu de deviner).
 */
export function reportError(userMessage: string, error: unknown, options?: { silent?: boolean }) {
  console.error(userMessage, error);
  if (options?.silent) return;
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  toast.error(detail ? `${userMessage} : ${detail}` : userMessage);
}
