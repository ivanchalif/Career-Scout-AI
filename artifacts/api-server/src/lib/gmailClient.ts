import { createHmac } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { gmail_v1, google } from "googleapis";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
];

export const DEFAULT_SUBJECT_KEYWORDS = [
  "job", "jobs", "opportunity", "role", "position", "hiring",
  "recruiter", "job alert", "job opportunity", "open position",
  "just posted", "great match", "job matches", "job recommendations",
  "recommended jobs", "jobs you might like", "new jobs", "you may be a fit",
  "new job:", "are hiring",
];

export interface EmailFilterCriteria {
  subjectKeywords: string[];
  fromAddresses: string[];
  bodyKeywords: string[];
  blockedBodyKeywords?: string[];
}

export const DEFAULT_EMAIL_FILTER_CRITERIA: EmailFilterCriteria = {
  subjectKeywords: DEFAULT_SUBJECT_KEYWORDS,
  fromAddresses: [],
  bodyKeywords: [],
};

function buildGmailQuery(criteria: EmailFilterCriteria): string {
  const orParts: string[] = [];

  if (criteria.subjectKeywords.length > 0) {
    const terms = criteria.subjectKeywords
      .map((kw) => kw.includes(" ") ? `"${kw}"` : kw)
      .join(" OR ");
    orParts.push(`subject:(${terms})`);
  }

  if (criteria.fromAddresses.length > 0) {
    orParts.push(`from:(${criteria.fromAddresses.join(" OR ")})`);
  }

  if (criteria.bodyKeywords.length > 0) {
    const bodyTerms = criteria.bodyKeywords
      .map((kw) => kw.includes(" ") ? `"${kw}"` : kw)
      .join(" OR ");
    orParts.push(`(${bodyTerms})`);
  }

  const criteriaClause = orParts.length === 0
    ? "job"
    : orParts.length === 1
    ? orParts[0]
    : `{${orParts.join(" ")}}`;

  return `is:unread ${criteriaClause} newer_than:30d`;
}

export function getGmailRedirectUri(): string {
  if (process.env["GMAIL_REDIRECT_URI"]) {
    return process.env["GMAIL_REDIRECT_URI"];
  }
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) {
    return `https://${devDomain}/api/gmail/callback`;
  }
  return "http://localhost:3000/api/gmail/callback";
}

export function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client({
    clientId: process.env["GOOGLE_CLIENT_ID"],
    clientSecret: process.env["GOOGLE_CLIENT_SECRET"],
    redirectUri: getGmailRedirectUri(),
  });
}

export function getAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("OAuth token exchange did not return required tokens");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

export async function getGmailEmail(
  accessToken: string,
  refreshToken: string,
): Promise<string | null> {
  const client = createOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function revokeTokens(refreshToken: string): Promise<void> {
  const client = createOAuth2Client();
  try {
    await client.revokeToken(refreshToken);
  } catch {
    // Ignore revocation errors — tokens may already be expired
  }
}

export interface JobEmail {
  messageId: string;
  subject: string;
  sender: string;
  body: string;
}

export async function markEmailAsRead(
  accessToken: string,
  refreshToken: string,
  messageId: string,
): Promise<void> {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
  } catch {
    // Silently ignore — may fail for tokens that only have gmail.readonly scope
    // until the user reconnects with the updated permissions
  }
}

export async function fetchSingleEmail(
  accessToken: string,
  refreshToken: string,
  messageId: string,
): Promise<JobEmail | null> {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const detail = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const headers = detail.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
    const sender = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
    const body = extractBody(detail.data.payload);
    return { messageId, subject, sender, body };
  } catch {
    return null;
  }
}

/**
 * Returns Gmail's resultSizeEstimate for the subject/from filter criteria only
 * (body keywords excluded — not filterable at the list stage).
 * Used to compute pre-filter suppression. Non-fatal on failure.
 */
export async function estimateEmailCount(
  accessToken: string,
  refreshToken: string,
  criteria?: EmailFilterCriteria,
): Promise<number> {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const effectiveCriteria = criteria ?? DEFAULT_EMAIL_FILTER_CRITERIA;
  const baseQuery = buildGmailQuery({ ...effectiveCriteria, bodyKeywords: [] });
  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: baseQuery,
      maxResults: 1,
    });
    return res.data.resultSizeEstimate ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchJobEmails(
  accessToken: string,
  refreshToken: string,
  criteria?: EmailFilterCriteria,
): Promise<JobEmail[]> {
  const client = createOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const effectiveCriteria = criteria ?? DEFAULT_EMAIL_FILTER_CRITERIA;
  const query = buildGmailQuery(effectiveCriteria);

  const gmail = google.gmail({ version: "v1", auth: client });
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 50,
  });

  const messages = listRes.data.messages ?? [];
  const results: JobEmail[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const headers = detail.data.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name?.toLowerCase() === "subject")?.value ??
        "(no subject)";
      const sender =
        headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
      const body = extractBody(detail.data.payload);

      results.push({ messageId: msg.id, subject, sender, body });
    } catch {
      // Skip individual message failures
    }
  }

  return results;
}

function extractBody(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64url").toString("utf8");
    return stripHtml(html);
  }

  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }

  return "";
}

function decodeHref(raw: string): string {
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .trim();
}

function extractHrefFromAttrs(attrs: string): string | null {
  // 1. Standard single or double quotes: href="URL" or href='URL'
  const quoted = attrs.match(/\bhref=["']([^"']+)["']/i);
  if (quoted) return decodeHref(quoted[1]);

  // 2. HTML-entity-encoded quotes: href=&quot;URL&quot;
  const entityQuoted = attrs.match(/\bhref=&quot;([^<]*?)&quot;/i);
  if (entityQuoted) return decodeHref(entityQuoted[1]);

  // 3. Unquoted href terminated by whitespace or >: href=https://...
  const unquoted = attrs.match(/\bhref=([^\s>"'&][^\s>"']*)/i);
  if (unquoted) return decodeHref(unquoted[1]);

  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Preserve anchor hrefs — handles standard quotes, &quot;-encoded quotes, and unquoted hrefs
    .replace(/<a(\s[^>]*?)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
      const text = inner.replace(/<[^>]+>/g, " ").trim();
      const href = extractHrefFromAttrs(attrs);
      if (!href || href.startsWith("mailto:") || href.startsWith("#")) {
        return text;
      }
      return text ? `${text} [${href}]` : `[${href}]`;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getStateSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is required but was not set. " +
      "Set a strong random secret to enable Gmail OAuth state signing."
    );
  }
  return secret;
}

export function signState(userId: string): string {
  const ts = Date.now().toString();
  const data = `${userId}:${ts}`;
  const secret = getStateSecret();
  const sig = createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

export function verifyState(state: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as {
      data: string;
      sig: string;
    };
    const { data, sig } = parsed;
    const secret = getStateSecret();
    const expected = createHmac("sha256", secret).update(data).digest("hex");
    if (sig !== expected) return null;
    const [userId, ts] = data.split(":");
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return null;
    return userId ?? null;
  } catch {
    return null;
  }
}
