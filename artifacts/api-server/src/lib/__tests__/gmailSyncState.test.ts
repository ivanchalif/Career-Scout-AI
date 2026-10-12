import { describe, expect, it, vi } from "vitest";
import { getGmailSyncProgress, isGmailSyncRunning, runGmailSync, type ReportGmailSyncProgress } from "../gmailSyncState";

describe("Gmail sync lifecycle", () => {
  it("is busy before preliminary work starts and shares the real result with overlapping callers", async () => {
    let finish!: (result: { synced: number; lastSyncedAt: Date }) => void;
    const operation = vi.fn(() => new Promise<{ synced: number; lastSyncedAt: Date }>((resolve) => {
      finish = resolve;
    }));
    const first = runGmailSync("shared-user", operation);
    expect(isGmailSyncRunning("shared-user")).toBe(true);
    expect(getGmailSyncProgress("shared-user")).toEqual({
      phase: "fetching", emailsProcessed: 0, emailsTotal: null, jobsImported: 0,
    });
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
    expect(getGmailSyncProgress("shared-user")).toBeNull();
  });

  it("clears busy state on error and allows a later retry", async () => {
    const failure = runGmailSync("retry-user", async () => { throw new Error("Gmail unavailable"); });
    expect(isGmailSyncRunning("retry-user")).toBe(true);
    await expect(failure).rejects.toThrow("Gmail unavailable");
    expect(isGmailSyncRunning("retry-user")).toBe(false);
    expect(getGmailSyncProgress("retry-user")).toBeNull();
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

  it("isolates progress snapshots and ignores updates from a completed run", async () => {
    let oldReport!: ReportGmailSyncProgress;
    await runGmailSync("snapshot-user", async (report) => {
      oldReport = report;
      report({ phase: "processing", emailsTotal: 5, emailsProcessed: 2, jobsImported: 3 });
      const snapshot = getGmailSyncProgress("snapshot-user")!;
      snapshot.jobsImported = 999;
      expect(getGmailSyncProgress("snapshot-user")?.jobsImported).toBe(3);
      expect(getGmailSyncProgress("other-user")).toBeNull();
      return { synced: 3, lastSyncedAt: new Date() };
    });
    const next = runGmailSync("snapshot-user", async () => ({ synced: 0, lastSyncedAt: new Date() }));
    oldReport({ jobsImported: 999 });
    expect(getGmailSyncProgress("snapshot-user")?.jobsImported).toBe(0);
    await next;
  });
});
