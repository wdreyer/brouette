export type MemberRole = "admin" | "referent" | "member";

export const DEFAULT_MEMBER_PASSWORD = "brouette2026";

export function normalizeMemberEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeMemberEmails(values: unknown, primary?: unknown) {
  const input = Array.isArray(values) ? values : [];
  const out: string[] = [];
  const seen = new Set<string>();

  [primary, ...input].forEach((value) => {
    const email = normalizeMemberEmail(value);
    if (!email || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  });

  return out;
}

export function normalizeMemberRole(value: unknown): MemberRole {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "admin" || role === "referent") return role;
  return "member";
}
