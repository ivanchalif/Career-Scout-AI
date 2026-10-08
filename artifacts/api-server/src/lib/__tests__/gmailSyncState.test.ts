import { describe, expect, it, vi } from "vitest";
import { isGmailSyncRunning, runGmailSync } from "../gmailSyncState";

describe("Gmail sync lifecycle", () => {
  it("is busy before preliminary work starts and shares the real result with overlapping callers", async () => {
    let finish!: (result: { synced: number; lastSyncedAt: Date }) => void;
    const operation = vi.fn(() => new Promise<{ synced: number; lastSyncedAt: Date }>((resolve) => {
      finish = resolve;
    }));
    const first = runGmailSync("shared-user", operation);
    expect(isGmailSyncRunning("shared-user")).toBe(true);
    const secondOperation = vi.fn();
    const second = runGmailSync("shared-user", secondOperation);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(secondOperation).not.toHaveBeenCalled();
    const result = { synced: 26, lastSyncedAt: new Date() };
    finish(result);
    expect(await first).toEqual(result);
    expect(await second).toEqual(result);
    expect(isGmailSyncRunning("shared-user")).toBe(false);
  });

  it("clears busy state on error and allows a later retry", async () => {
    const failure = runGmailSync("retry-user", async () => { throw new Error("Gmail unavailable"); });
    expect(isGmailSyncRunning("retry-user")).toBe(true);
    await expect(failure).rejects.toThrow("Gmail unavailable");
    expect(isGmailSyncRunning("retry-user")).toBe(false);
    expect(await runGmailSync("retry-user", async () => ({ synced: 2, lastSyncedAt: new Date() }))).toMatchObject({ synced: 2 });
    expect(isGmailSyncRunning("retry-user")).toBe(false);
  });

  it("keeps different users' sync state independent", async () => {
    let finish!: (result: { synced: number; lastSyncedAt: Date }) => void;
    const first = runGmailSync("user-a", () => new Promise((resolve) => { finish = resolve; }));
    expect(isGmailSyncRunning("user-a")).toBe(true);
    expect(isGmailSyncRunning("user-b")).toBe(false);
    await runGmailSync("user-b", async () => ({ synced: 1, lastSyncedAt: new Date() }));
    expect(isGmailSyncRunning("user-a")).toBe(true);
    expect(isGmailSyncRunning("user-b")).toBe(false);
    finish({ synced: 0, lastSyncedAt: new Date() });
    await first;
  });
});
