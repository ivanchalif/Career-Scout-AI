/** Old listing keys prove only partial progress, never completion of a digest. */
export function completedGmailMessages(keys: Array<{ gmailKey: string }>): Set<string> {
  return new Set(keys
    .filter(({ gmailKey }) => /:(?:complete|blocked|appresponse)$/.test(gmailKey))
    .map(({ gmailKey }) => gmailKey.slice(0, gmailKey.lastIndexOf(":"))));
}

/** Processing completion and Gmail label acknowledgment are separate states. */
export function successfulGmailMessages(keys: Array<{ gmailKey: string }>): Set<string> {
  return new Set(keys.filter(({ gmailKey }) => gmailKey.endsWith(":complete"))
    .map(({ gmailKey }) => gmailKey.slice(0, -":complete".length)));
}

export function acknowledgedGmailMessages(keys: Array<{ gmailKey: string }>): Set<string> {
  return new Set(keys.filter(({ gmailKey }) => gmailKey.endsWith(":mailbox_done"))
    .map(({ gmailKey }) => gmailKey.slice(0, -":mailbox_done".length)));
}

export function pendingGmailMailboxMessages(keys: Array<{ gmailKey: string }>): string[] {
  const completed = successfulGmailMessages(keys);
  const acknowledged = acknowledgedGmailMessages(keys);
  return [...new Set(keys.filter(({ gmailKey }) => gmailKey.endsWith(":mailbox_pending"))
    .map(({ gmailKey }) => gmailKey.slice(0, -":mailbox_pending".length)))]
    .filter((id) => completed.has(id) && !acknowledged.has(id));
}
