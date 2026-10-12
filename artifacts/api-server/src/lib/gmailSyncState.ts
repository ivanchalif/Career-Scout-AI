import type { GetGmailStatusResponse } from "@workspace/api-zod";
import type { z } from "zod";

type GmailSyncProgress = NonNullable<z.infer<typeof GetGmailStatusResponse>["progress"]>;

export interface SyncUserResult {
  synced: number;
  lastSyncedAt: Date;
}

export type ReportGmailSyncProgress = (update: Partial<GmailSyncProgress>) => void;
const activeSyncs = new Map<string, {
  promise: Promise<SyncUserResult>;
  progress: GmailSyncProgress;
}>();

/** Return a snapshot so callers cannot mutate a running sync's state. */
export function getGmailSyncProgress(userId: string): GmailSyncProgress | null {
  const active = activeSyncs.get(userId);
  return active ? { ...active.progress } : null;
}

export function isGmailSyncRunning(userId: string): boolean {
  return activeSyncs.has(userId);
}

/** Concurrent callers share the real result instead of receiving a synthetic zero. */
export function runGmailSync(
  userId: string,
  operation: (reportProgress: ReportGmailSyncProgress) => Promise<SyncUserResult>,
): Promise<SyncUserResult> {
  const existing = activeSyncs.get(userId);
  if (existing) return existing.promise;

  // Register before starting any asynchronous work, including the email estimate.
  const progress: GmailSyncProgress = {
    phase: "fetching", emailsProcessed: 0, emailsTotal: null, jobsImported: 0,
  };
  const pending = Promise.resolve().then(() => operation((update) => {
    // A callback from an old run must never update a newer run.
    if (activeSyncs.get(userId)?.promise === pending) Object.assign(progress, update);
  })).finally(() => {
    if (activeSyncs.get(userId)?.promise === pending) activeSyncs.delete(userId);
  });
  activeSyncs.set(userId, { promise: pending, progress });
  return pending;
}
