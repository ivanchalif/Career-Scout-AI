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

  it("preserves the existing read-only permission fallback", async () => {
    messages.modify.mockRejectedValueOnce(new Error("insufficient permissions"));
    await expect(markEmailAsRead("mock-access", "mock-refresh", "message")).resolves.toBeUndefined();
  });
});
