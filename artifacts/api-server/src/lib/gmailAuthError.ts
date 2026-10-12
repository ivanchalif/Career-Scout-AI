/** Safe, typed failure shared by manual and scheduled Gmail syncs. */
export class GmailAuthorizationExpiredError extends Error {
  readonly code = "gmail_token_expired";

  constructor() {
    super("Gmail authorization has expired. Please reconnect your Gmail account.");
    this.name = "GmailAuthorizationExpiredError";
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
