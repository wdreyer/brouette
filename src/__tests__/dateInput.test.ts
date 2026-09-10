import { describe, expect, it } from "vitest";
import { formatDateForInput, timestampFromDateInput } from "@/lib/dateInput";

describe("dateInput", () => {
  it("keeps the selected calendar day when creating a timestamp from a date input", () => {
    const timestamp = timestampFromDateInput("2026-09-10");

    expect(timestamp).not.toBe("");
    expect(formatDateForInput(timestamp.toDate())).toBe("2026-09-10");
  });
});
