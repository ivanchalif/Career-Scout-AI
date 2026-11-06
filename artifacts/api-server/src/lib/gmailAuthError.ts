/** Safe, typed failure shared by manual and scheduled Gmail syncs. */
export class GmailAuthorizationExpiredError extends Error {
  readonly code = "gmail_token_expired";

  constructor() {
    super("Gmail authorization has expired. Please reconnect your Gmail account.");
    this.name = "GmailAuthorizationExpiredError";
  }
}

/** A failed label update must not be reported as a successful sync. */
export class GmailMailboxUpdateError extends Error {
  constructor(permissionDenied = false) {
    super(permissionDenied
      ? "Gmail could not update processed emails. Reconnect Gmail and allow permission to mark messages as read and archive them. Saved jobs are safe."
      : "Jobs were processed, but Gmail could not mark the email as read and archive it. Saved jobs are safe; retry Sync now.");
    this.name = "GmailMailboxUpdateError";
  }
}

/** Google may put invalid_grant in either the message or the OAuth response. */
export function isGmailAuthorizationExpired(error: unknown): boolean {
  if (error instanceof GmailAuthorizationExpiredError) return true;
  if (!error || typeof error !== "object") return false;
  const oauthError = error as {
    message?: unknown;
    response?: { data?: { error?: unknown } };
  };
  return (typeof oauthError.message === "string" && oauthError.message.includes("invalid_grant"))
    || oauthError.response?.data?.error === "invalid_grant";
}
