import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ events: [] as string[], fail: false }));
vi.mock("@workspace/db", () => ({
  gmailSeenKeysTable: {},
  db: { insert: () => ({ values: (value: { gmailKey: string }) => ({
    onConflictDoNothing: async () => { state.events.push(value.gmailKey); },
  }) }) },
}));
vi.mock("../gmailClient", () => ({
  markEmailAsRead: async () => {
    state.events.push("google-modify");
    if (state.fail) throw new Error("Gmail unavailable");
  },
}));
import { finalizeGmailMailboxMessage } from "../gmailMailboxCompletion";
const conn = { userId: "test-owner", accessToken: "test-access", refreshToken: "test-refresh" };
beforeEach(() => { state.events = []; state.fail = false; });
describe("durable mailbox completion", () => {
  it("acknowledges Gmail only after its label update succeeds", async () => {
    await finalizeGmailMailboxMessage(conn, "message");
    expect(state.events).toEqual(["message:mailbox_pending", "google-modify", "message:mailbox_done"]);
  });
  it("retains pending intent and never writes done when the label update fails", async () => {
    state.fail = true;
    await expect(finalizeGmailMailboxMessage(conn, "message")).rejects.toThrow("Gmail unavailable");
    expect(state.events).toEqual(["message:mailbox_pending", "google-modify"]);
  });
});
