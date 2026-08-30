import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_PASSWORD,
  normalizeMemberEmail,
  normalizeMemberEmails,
  normalizeMemberRole,
} from "@/lib/memberAuthSync";

describe("member auth sync helpers", () => {
  it("normalizes a login email consistently for Firestore and Firebase Auth", () => {
    expect(normalizeMemberEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("keeps the primary email first and removes duplicates", () => {
    expect(normalizeMemberEmails(["Other@Example.com", "MAIN@example.com"], " Main@Example.com ")).toEqual([
      "main@example.com",
      "other@example.com",
    ]);
  });

  it("falls back to member for unknown roles", () => {
    expect(normalizeMemberRole("admin")).toBe("admin");
    expect(normalizeMemberRole("referent")).toBe("referent");
    expect(normalizeMemberRole("owner")).toBe("member");
    expect(DEFAULT_MEMBER_PASSWORD).toBe("brouette2026");
  });
});
