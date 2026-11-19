import { describe, expect, it } from "vitest";
import { gmailScheduleHours } from "../gmailSchedule";

describe("Gmail schedule selection", () => {
  it("preserves Manual only rather than replacing it with the default", () => {
    expect(gmailScheduleHours({ syncScheduleHours: null }, 1)).toBeNull();
  });
  it("preserves each supported automatic frequency", () => {
    for (const hours of [0.5, 1, 6, 12, 24]) {
      expect(gmailScheduleHours({ syncScheduleHours: hours }, 1)).toBe(hours);
    }
  });
  it("uses the default only when no profile exists", () => {
    expect(gmailScheduleHours(undefined, 1)).toBe(1);
  });
});
