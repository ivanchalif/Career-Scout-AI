/** Old listing keys prove only partial progress, never completion of a digest. */
export function completedGmailMessages(keys: Array<{ gmailKey: string }>): Set<string> {
  return new Set(keys
    .filter(({ gmailKey }) => /:(?:complete|blocked|appresponse)$/.test(gmailKey))
    .map(({ gmailKey }) => gmailKey.slice(0, gmailKey.lastIndexOf(":"))));
}
