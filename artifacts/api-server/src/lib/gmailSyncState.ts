export interface SyncUserResult {
  synced: number;
  lastSyncedAt: Date;
}

const activeSyncs = new Map<string, Promise<SyncUserResult>>();

export function isGmailSyncRunning(userId: string): boolean {
  return activeSyncs.has(userId);
}

/** Concurrent callers share the real result instead of receiving a synthetic zero. */
export function runGmailSync(
  userId: string,
  operation: () => Promise<SyncUserResult>,
): Promise<SyncUserResult> {
  const existing = activeSyncs.get(userId);
  if (existing) return existing;

  // Register before starting any asynchronous work, including the email estimate.
  const pending = Promise.resolve().then(operation).finally(() => {
    if (activeSyncs.get(userId) === pending) activeSyncs.delete(userId);
  });
  activeSyncs.set(userId, pending);
  return pending;
}
