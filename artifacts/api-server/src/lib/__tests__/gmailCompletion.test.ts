import { describe, expect, it } from "vitest";
import { completedGmailMessages } from "../gmailCompletion";

describe("Gmail digest completion", () => {
  it("retries a partially processed digest including legacy listing keys", () => {
    expect(completedGmailMessages([{ gmailKey: "digest:0" }, { gmailKey: "digest:1" }]).has("digest")).toBe(false);
  });
  it("only skips messages with a terminal outcome", () => {
    expect(completedGmailMessages([
      { gmailKey: "a:complete" }, { gmailKey: "b:blocked" }, { gmailKey: "c:appresponse" },
    ])).toEqual(new Set(["a", "b", "c"]));
  });
});
