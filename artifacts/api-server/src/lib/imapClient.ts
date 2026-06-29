import { ImapFlow } from "imapflow";
import { logger } from "./logger";
import type { JobEmail, EmailFilterCriteria } from "./gmailClient";
import { DEFAULT_EMAIL_FILTER_CRITERIA } from "./gmailClient";

export interface ImapCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}

function createImapClient(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.tls,
    auth: {
      user: creds.username,
      pass: creds.password,
    },
    logger: false,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export async function testImapConnection(creds: ImapCredentials): Promise<void> {
  const client = createImapClient(creds);
  try {
    await client.connect();
    await client.logout();
  } catch (err) {
    throw new Error(`IMAP connection failed: ${(err as Error).message}`);
  }
}

function isJobEmail(subject: string, sender: string, body: string, criteria: EmailFilterCriteria): boolean {
  const allEmpty = criteria.subjectKeywords.length === 0
    && criteria.fromAddresses.length === 0
    && criteria.bodyKeywords.length === 0;
  if (allEmpty) return true;

  const subjectLower = subject.toLowerCase();
  const senderLower = sender.toLowerCase();
  const bodyLower = body.toLowerCase();

  const subjectMatch = criteria.subjectKeywords.length > 0
    && criteria.subjectKeywords.some((kw) => subjectLower.includes(kw.toLowerCase()));
  const fromMatch = criteria.fromAddresses.length > 0
    && criteria.fromAddresses.some((addr) => senderLower.includes(addr.toLowerCase()));
  const bodyMatch = criteria.bodyKeywords.length > 0
    && criteria.bodyKeywords.some((kw) => bodyLower.includes(kw.toLowerCase()));

  if (!(subjectMatch || fromMatch || bodyMatch)) return false;

  if (criteria.blockedBodyKeywords?.length) {
    if (criteria.blockedBodyKeywords.some((kw) => bodyLower.includes(kw.toLowerCase()))) {
      return false;
    }
  }

  return true;
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

export async function fetchImapJobEmails(creds: ImapCredentials, criteria?: EmailFilterCriteria): Promise<JobEmail[]> {
  const effectiveCriteria = criteria ?? DEFAULT_EMAIL_FILTER_CRITERIA;
  const client = createImapClient(creds);
  const results: JobEmail[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const uids = await client.search({ since, seen: false });

      for (const uid of uids.slice(0, 50)) {
        try {
          const msg = await client.fetchOne(String(uid), {
            uid: true,
            envelope: true,
            bodyStructure: true,
            source: true,
          });

          const subject = msg.envelope?.subject ?? "(no subject)";
          const sender = msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address ?? ""}>`.trim()
            : "";

          const rawSource = msg.source ? msg.source.toString("utf8") : "";
          const body = extractBodyFromRaw(rawSource);

          if (!body.trim()) continue;
          if (!isJobEmail(subject, sender, body, effectiveCriteria)) continue;

          results.push({
            messageId: `imap:${uid}`,
            subject,
            sender,
            body,
          });
        } catch (err) {
          logger.warn({ uid, err }, "imapClient: failed to fetch message");
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.error({ host: creds.host, err }, "imapClient: fetchImapJobEmails failed");
    throw err;
  }

  return results;
}

function extractBodyFromRaw(raw: string): string {
  const boundary = (() => {
    const m = raw.match(/boundary="?([^"\r\n;]+)"?/i);
    return m?.[1] ?? null;
  })();

  if (!boundary) {
    const headerEnd = raw.indexOf("\r\n\r\n");
    const body = headerEnd >= 0 ? raw.slice(headerEnd + 4) : raw;
    if (raw.toLowerCase().includes("content-type: text/html")) {
      return stripHtml(body);
    }
    return body.replace(/\s+/g, " ").trim();
  }

  const parts = raw.split(`--${boundary}`);
  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    const lc = part.toLowerCase();
    const bodyStart = part.indexOf("\r\n\r\n");
    if (bodyStart < 0) continue;
    const body = part.slice(bodyStart + 4);

    if (lc.includes("content-type: text/plain")) {
      plainText = body.replace(/\s+/g, " ").trim();
    } else if (lc.includes("content-type: text/html")) {
      htmlText = stripHtml(body);
    }
  }

  return plainText || htmlText;
}
