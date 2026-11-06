import { beforeEach, describe, expect, it, vi } from "vitest";

const messages = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), modify: vi.fn() }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { setCredentials() {} },
}));
vi.mock("googleapis", () => ({
  google: { gmail: () => ({ users: { messages } }) },
}));

import { estimateEmailCount, fetchJobEmails, markEmailAsRead } from "../gmailClient";

describe("Gmail client authorization expiry (no real mail)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("marks only the processed message read and archives it without trashing it", async () => {
    messages.modify.mockResolvedValueOnce({});
    await markEmailAsRead("mock-access", "mock-refresh", "processed");
    expect(messages.modify).toHaveBeenCalledWith({
      userId: "me", id: "processed", requestBody: { removeLabelIds: ["UNREAD", "INBOX"] },
    });
  });
  it("reports insufficient permissions rather than silently succeeding", async () => {
    messages.modify.mockRejectedValueOnce({ response: { status: 403 } });
    await expect(markEmailAsRead("mock-access", "mock-refresh", "processed")).rejects.toThrow("Reconnect Gmail");
  });
  it("reports temporary label-update failures so they can retry", async () => {
    messages.modify.mockRejectedValueOnce(new Error("network failure"));
    await expect(markEmailAsRead("mock-access", "mock-refresh", "processed")).rejects.toThrow("retry Sync now");
  });
  it("treats an already-deleted message as no longer needing mailbox updates", async () => {
    messages.modify.mockRejectedValueOnce({ code: 404 });
    await expect(markEmailAsRead("mock-access", "mock-refresh", "deleted")).resolves.toBeUndefined();
  });
  it("repairs completed read-inbox mail but leaves new already-read mail alone", async () => {
    messages.list.mockResolvedValueOnce({ data: { messages: [{ id: "completed" }, { id: "already-read" }] } });
    messages.get.mockResolvedValue({ data: { labelIds: ["INBOX"], payload: {} } });
    const result = await fetchJobEmails("mock-access", "mock-refresh", undefined, { completedMessageIds: new Set(["completed"]) });
    expect(result.map(email => email.messageId)).toEqual(["completed"]);
    expect(messages.list.mock.calls[0][0].q).toContain("{is:unread in:inbox}");
  });
  it("looks beyond intentionally skipped messages on the first page", async () => {
    messages.list.mockResolvedValueOnce({ data: { messages: [{ id: "blocked" }], nextPageToken: "next" } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "new" }] } });
    messages.get.mockResolvedValue({ data: { labelIds: ["UNREAD", "INBOX"], payload: {} } });
    const result = await fetchJobEmails("mock-access", "mock-refresh", undefined, { skipMessageIds: new Set(["blocked"]) });
    expect(result.map(email => email.messageId)).toEqual(["new"]);
    expect(messages.get).toHaveBeenCalledTimes(1);
    expect(messages.list.mock.calls[1][0].pageToken).toBe("next");
  });

  it("propagates expiry from the preliminary estimate", async () => {
    messages.list.mockRejectedValueOnce(new Error("invalid_grant"));
    await expect(estimateEmailCount("mock-access", "mock-refresh")).rejects.toThrow("invalid_grant");
  });

  it("keeps ordinary estimate failures non-fatal", async () => {
    messages.list.mockRejectedValueOnce(new Error("network failure"));
    expect(await estimateEmailCount("mock-access", "mock-refresh")).toBe(0);
  });

  it("propagates expiry while listing messages", async () => {
    messages.list.mockRejectedValueOnce(new Error("invalid_grant"));
    await expect(fetchJobEmails("mock-access", "mock-refresh")).rejects.toThrow("invalid_grant");
  });

  it("does not return partial results when expiry occurs while fetching a message", async () => {
    messages.list.mockResolvedValueOnce({ data: { messages: [{ id: "first" }, { id: "expired" }] } });
    messages.get.mockResolvedValueOnce({ data: { payload: {} } })
      .mockRejectedValueOnce({ response: { data: { error: "invalid_grant" } } });
    await expect(fetchJobEmails("mock-access", "mock-refresh"))
      .rejects.toMatchObject({ response: { data: { error: "invalid_grant" } } });
  });

  it("still skips an individual unavailable message without disconnecting", async () => {
    messages.list.mockResolvedValueOnce({ data: { messages: [{ id: "missing" }, { id: "good" }] } });
    messages.get.mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({ data: { payload: {} } });
    expect(await fetchJobEmails("mock-access", "mock-refresh")).toMatchObject([{ messageId: "good" }]);
  });

  it("propagates expiry when marking read instead of letting the sync report success", async () => {
    messages.modify.mockRejectedValueOnce(new Error("invalid_grant"));
    await expect(markEmailAsRead("mock-access", "mock-refresh", "message"))
      .rejects.toThrow("invalid_grant");
  });

  it("no longer reports success when a read-only token cannot modify the mailbox", async () => {
    messages.modify.mockRejectedValueOnce(new Error("insufficient permissions"));
    await expect(markEmailAsRead("mock-access", "mock-refresh", "message")).rejects.toThrow("Reconnect Gmail");
  });
});
