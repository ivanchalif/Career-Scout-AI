import { describe, expect, it } from "vitest";
import { completedGmailMessages, successfulGmailMessages, pendingGmailMailboxMessages } from "../gmailCompletion";

describe("Gmail digest completion", () => {
  it("retries mailbox acknowledgments, not extraction or unrelated filtered mail", () => {
    const keys = [
      "a:complete", "a:mailbox_pending", "b:complete", "b:mailbox_pending", "b:mailbox_done",
      "c:blocked", "c:mailbox_pending", "d:appresponse", "e:0", "e:mailbox_pending",
    ].map(gmailKey => ({ gmailKey }));
    expect(successfulGmailMessages(keys)).toEqual(new Set(["a", "b"]));
    expect(pendingGmailMailboxMessages(keys)).toEqual(["a"]);
    expect(completedGmailMessages(keys)).toEqual(new Set(["a", "b", "c", "d"]));
  });
  it("retries a partially processed digest including legacy listing keys", () => {
    expect(completedGmailMessages([{ gmailKey: "digest:0" }, { gmailKey: "digest:1" }]).has("digest")).toBe(false);
  });
  it("only skips messages with a terminal outcome", () => {
    expect(completedGmailMessages([
      { gmailKey: "a:complete" }, { gmailKey: "b:blocked" }, { gmailKey: "c:appresponse" },
    ])).toEqual(new Set(["a", "b", "c"]));
  });
});
