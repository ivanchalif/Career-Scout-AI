import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "./logger";

const PAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CONTENT_CHARS = 10_000;
const MAX_PAGE_HTML_BYTES = 1_000_000;
const MIN_USEFUL_CHARS = 150;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type AvailabilityStatus = "open" | "closed" | "unverified";

export interface JobPageMetadata {
  title?: string;
  company?: string;
  location?: string;
  remote?: boolean;
  sourcePostedAt?: Date;
  validThrough?: Date;
  fieldEvidence: Partial<Record<"title" | "company" | "location" | "remote" | "sourcePostedAt", {
    source: "jsonld";
    confidence: number;
  }>>;
}

export interface AvailabilityCheck {
  status: AvailabilityStatus;
  checkedAt: Date;
  reason: string;
  confidence: number;
  evidence: string[];
}

export interface PageResult {
  content: string;
  finalUrl: string;
  /** False when the page was an error/gate/short page — callers should not use content for description but should still use finalUrl for the link. */
  contentUsable: boolean;
  availability: AvailabilityCheck;
  metadata: JobPageMetadata | null;
}

/**
 * Fetches a job posting URL and extracts plain text from the page.
 * Fetch failures and unreadable pages return an unverified result. Null remains
 * in the signature for compatibility with existing callers.
 *
 * `finalUrl` is the URL after following all redirects — useful when the input
 * is a click-tracking URL (e.g. Jobgether, LinkedIn) so callers can store the
 * clean destination URL instead of the opaque tracking link.
 */
export async function fetchJobPageContent(url: string): Promise<PageResult | null> {
  let controller: AbortController | undefined;
  let tid: ReturnType<typeof setTimeout> | undefined;
  const checkedAt = new Date();
  let currentUrl = safeDisplayUrl(url);

  try {
    controller = new AbortController();
    tid = setTimeout(() => controller!.abort(), PAGE_FETCH_TIMEOUT_MS);

    let parsedUrl: URL;
    try {
      parsedUrl = await validatePublicPageUrl(url);
      currentUrl = parsedUrl.toString();
    } catch {
      return pageFailure(currentUrl, checkedAt, "unsafe_url");
    }

    let res: Response | undefined;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      // Redirects are never followed by fetch itself; each destination is
      // validated and DNS-checked before it becomes the next request URL.
      currentUrl = parsedUrl.toString();
      res = await fetch(parsedUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CareerScout/1.0; job-aggregator)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
      });

      if (!REDIRECT_STATUSES.has(res.status)) break;
      const location = res.headers.get("location");
      if (!location) break;
      if (redirectCount === MAX_REDIRECTS) {
        await res.body?.cancel();
        return pageFailure(currentUrl, checkedAt, "too_many_redirects");
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, parsedUrl);
        nextUrl = await validatePublicPageUrl(nextUrl.toString());
      } catch {
        await res.body?.cancel();
        return pageFailure(currentUrl, checkedAt, "unsafe_redirect");
      }
      await res.body?.cancel();
      parsedUrl = nextUrl;
      res = undefined;
    }
    if (!res) return pageFailure(currentUrl, checkedAt, "too_many_redirects");

    // Use the checked request URL rather than Response.url: manual redirects
    // keep the latter implementation-dependent and it must never override the
    // URL that passed validation.
    const finalUrl = currentUrl;

    if (!res.ok) {
      logger.debug({ url: safeLogUrl(url), finalUrl: safeLogUrl(finalUrl), status: res.status }, "pageScraper: non-OK response");
      return pageFailure(finalUrl, checkedAt, res.status === 403 ? "http_403" : `http_${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      logger.debug({ url: safeLogUrl(url), finalUrl: safeLogUrl(finalUrl), contentType }, "pageScraper: skipping non-HTML content");
      return pageFailure(finalUrl, checkedAt, "non_html_response");
    }

    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_HTML_BYTES) {
      return pageFailure(finalUrl, checkedAt, "page_too_large");
    }
    const html = await readBoundedHtml(res);
    if (html === null) return pageFailure(finalUrl, checkedAt, "page_too_large");
    const text = htmlToText(html);
    const metadata = extractJobPostingMetadata(html);
    const closedReason = detectExplicitClosedSignal(text, metadata);

    // Explicit expiry/closure evidence still applies to a short removed-job page.
    // Gates take precedence because they do not expose the listing itself.
    const errorReason = detectErrorPage(text);
    if (errorReason) {
      return pageFailure(finalUrl, checkedAt, errorReason, metadata);
    }
    if (closedReason) {
      return {
        content: text.slice(0, MAX_PAGE_CONTENT_CHARS),
        finalUrl,
        contentUsable: false,
        availability: { status: "closed", checkedAt, reason: closedReason, confidence: 0.98, evidence: [closedReason] },
        metadata,
      };
    }

    if (text.length < MIN_USEFUL_CHARS) {
      logger.debug(
        { url: safeLogUrl(url), finalUrl: safeLogUrl(finalUrl), chars: text.length },
        "pageScraper: extracted text too short — likely JS-only page",
      );
      return pageFailure(finalUrl, checkedAt, "insufficient_rendered_content", metadata);
    }

    logger.info({ url: safeLogUrl(url), finalUrl: safeLogUrl(finalUrl), chars: text.length }, "pageScraper: page fetched successfully");
    const hasListingMetadata = Boolean(metadata?.title && metadata?.company);
    const hasApplication = /\b(?:apply now|apply for (?:this|the) (?:job|position|role)|submit (?:your |an )?application)\b/i.test(text);
    const hasJobDetails = /\b(?:responsibilities|qualifications|requirements)\b/i.test(text);
    const verifiedOpen = hasJobDetails && (hasListingMetadata || hasApplication);
    const evidence = [
      ...(hasListingMetadata ? ["jsonld_job_posting"] : []),
      ...(hasApplication ? ["application_invitation"] : []),
      ...(hasJobDetails ? ["job_details"] : []),
    ];
    return {
      content: text.slice(0, MAX_PAGE_CONTENT_CHARS),
      finalUrl,
      contentUsable: true,
      availability: {
        status: verifiedOpen ? "open" : "unverified",
        checkedAt,
        reason: verifiedOpen ? "job_details_and_active_listing_evidence" : "no_active_listing_evidence",
        confidence: verifiedOpen ? 0.8 : 0,
        evidence,
      },
      metadata,
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const isAbort = msg.includes("aborted") || msg.includes("abort");
    logger.debug(
      { url: safeLogUrl(currentUrl), reason: isAbort ? "timeout" : "fetch_error" },
      isAbort ? "pageScraper: fetch timed out" : "pageScraper: fetch error",
    );
    return pageFailure(currentUrl, checkedAt, isAbort ? "timeout" : "fetch_error");
  } finally {
    clearTimeout(tid);
  }
}

async function validatePublicPageUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid page URL");
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:")
    || !parsed.hostname
    || parsed.username
    || parsed.password) {
    throw new Error("Unsafe page URL");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan|corp|intranet|arpa)$/.test(hostname)
    || !isIP(hostname) && !hostname.includes(".")) {
    throw new Error("Unsafe page host");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname, literalFamily)) throw new Error("Unsafe page address");
    return parsed;
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0 || resolved.some(({ address }) => {
    const family = isIP(address);
    return family === 0 || !isPublicAddress(address, family);
  })) {
    throw new Error("Unsafe page DNS result");
  }
  return parsed;
}

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = octets;
    return !(
      a === 0
      || a === 10
      || a === 100 && b >= 64 && b <= 127
      || a === 127
      || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 0 && c === 0 || b === 2 || b === 168)
      || a === 192 && b === 88 && c === 99
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113
      || a >= 224
    );
  }
  if (family !== 6) return false;

  const segments = address.split(":");
  const first = Number.parseInt(segments[0] || "0", 16);
  const second = Number.parseInt(segments[1] || "0", 16);
  // Only global-unicast 2000::/3 is accepted. Exclude documentation,
  // transition/tunnel ranges, and the reserved 3fff::/20 documentation block.
  return first >= 0x2000 && first <= 0x3fff
    && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
    && first !== 0x2002
    && first !== 0x3fff;
}

function safeDisplayUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeLogUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function pageFailure(finalUrl: string, checkedAt: Date, reason: string, metadata: JobPageMetadata | null = null): PageResult {
  return {
    content: "",
    finalUrl,
    contentUsable: false,
    availability: { status: "unverified", checkedAt, reason, confidence: 0, evidence: [] },
    metadata,
  };
}

async function readBoundedHtml(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PAGE_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function firstText(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstText(value[0]);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstText(record.name ?? record["@value"]);
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...flattenJsonLd(record["@graph"])];
}

export function extractJobPostingMetadata(html: string): JobPageMetadata | null {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts.slice(0, 20)) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script\s*>$/i, "").trim();
    if (!raw || raw.length > 200_000) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const posting = flattenJsonLd(parsed).find((item) => {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        return types.some((type) => typeof type === "string" && type.toLowerCase().split(/[\/#]/).at(-1) === "jobposting");
      });
      if (!posting) continue;

      const metadata: JobPageMetadata = { fieldEvidence: {} };
      const title = firstText(posting.title);
      const company = firstText(posting.hiringOrganization);
      const sourcePostedAt = parseDate(posting.datePosted);
      const validThrough = parseDate(posting.validThrough);
      const locationObject = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
      const address = locationObject && typeof locationObject === "object"
        ? (locationObject as Record<string, unknown>).address
        : undefined;
      const addressRecord = address && typeof address === "object" ? address as Record<string, unknown> : {};
      const location = [
        firstText(addressRecord.addressLocality),
        firstText(addressRecord.addressRegion),
        firstText(addressRecord.addressCountry),
      ].filter(Boolean).join(", ") || firstText(locationObject && typeof locationObject === "object"
        ? (locationObject as Record<string, unknown>).name
        : undefined) || "";
      const jobLocationType = firstText(posting.jobLocationType);
      const remote = Boolean(jobLocationType && /telecommute|remote/i.test(jobLocationType));
      if (title) {
        metadata.title = title;
        metadata.fieldEvidence.title = { source: "jsonld", confidence: 0.98 };
      }
      if (company) {
        metadata.company = company;
        metadata.fieldEvidence.company = { source: "jsonld", confidence: 0.98 };
      }
      if (location) {
        metadata.location = location;
        metadata.fieldEvidence.location = { source: "jsonld", confidence: 0.95 };
      }
      if (jobLocationType) {
        metadata.remote = remote;
        metadata.fieldEvidence.remote = { source: "jsonld", confidence: 0.95 };
      }
      if (sourcePostedAt) {
        metadata.sourcePostedAt = sourcePostedAt;
        metadata.fieldEvidence.sourcePostedAt = { source: "jsonld", confidence: 0.98 };
      }
      if (validThrough) metadata.validThrough = validThrough;
      return metadata;
    } catch {
      // Ignore malformed JSON-LD and continue looking for another JobPosting block.
    }
  }
  return null;
}

function detectExplicitClosedSignal(text: string, metadata: JobPageMetadata | null): string | null {
  if (metadata?.validThrough && metadata.validThrough.getTime() < Date.now()) return "jsonld_valid_through_expired";
  const sample = text.slice(0, 4_000);
  const signals: Array<[RegExp, string]> = [
    [/\bthis (?:job|position|role|vacancy) (?:is )?no longer available\b/i, "explicit_job_unavailable"],
    [/\bthis (?:job|position|role|vacancy) (?:is )?no longer accepting applications\b/i, "explicit_applications_closed"],
    [/\bapplications for (?:this )?(?:job|position|role) are closed\b/i, "explicit_applications_closed"],
    [/\b(?:this )?(?:job|position|role) (?:has been|was) filled\b/i, "explicit_position_filled"],
    [/\bthis job posting has expired\b/i, "explicit_posting_expired"],
  ];
  return signals.find(([pattern]) => pattern.test(sample))?.[1] ?? null;
}

/**
 * Phrases that appear in error/redirect/gate pages rather than real job postings.
 * Checked against a small prefix of the extracted text so we don't scan 10 KB
 * for every page — these messages always appear near the top.
 */
const ERROR_PAGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Email link-checker / wrong-link pages
  { pattern: /wrong link/i, label: "wrong-link page" },
  { pattern: /invalid link/i, label: "invalid-link page" },
  { pattern: /you have clicked on an invalid/i, label: "invalid-link page" },
  { pattern: /copying this link from a mail reader/i, label: "mail-reader link error" },
  // Link expiry / single-use links
  { pattern: /this link has expired/i, label: "expired link" },
  { pattern: /link (is|has been) (no longer valid|expired)/i, label: "expired link" },
  // Generic 404 / not found
  { pattern: /page (was )?not found/i, label: "404 page" },
  { pattern: /404\s*(—|-|:)?\s*not found/i, label: "404 page" },
  // Access denied / login walls
  { pattern: /access denied/i, label: "access denied" },
  { pattern: /403\s*(—|-|:)?\s*forbidden/i, label: "403 forbidden" },
  { pattern: /please (log in|sign in) to (continue|view|access)/i, label: "login wall" },
  { pattern: /\b(?:log in|sign in)\s+to\s+(?:view|apply|continue|see|access)\b/i, label: "login wall" },
  { pattern: /\bcreate an account\s+to\s+(?:apply|view|continue)\b/i, label: "login wall" },
  // Bot/browser checks
  { pattern: /just a moment/i, label: "cloudflare challenge" },
  { pattern: /checking your browser/i, label: "bot check" },
  { pattern: /enable javascript (and )?cookies/i, label: "JS required" },
  // SafeLinks and similar email link-scanners
  { pattern: /microsoft safelinks/i, label: "safelinks page" },
  { pattern: /this link has been (disabled|blocked)/i, label: "blocked link" },
];

/**
 * Returns a human-readable reason string if the page looks like an error or
 * gate page rather than real content, otherwise returns null.
 * Only inspects the first 1 KB to keep it fast.
 */
function detectErrorPage(text: string): string | null {
  const sample = text.slice(0, 1_000);
  for (const { pattern, label } of ERROR_PAGE_PATTERNS) {
    if (pattern.test(sample)) return label;
  }
  return null;
}

/**
 * Converts HTML to readable plain text suitable for LLM consumption.
 * Strips scripts, styles, nav/header/footer chrome, then collapses markup.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    // Remove common non-content chrome sections
    .replace(/<(nav|header|footer|aside|dialog|banner)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Block-level elements → line breaks so paragraphs are preserved
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|label)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]{2,8};/gi, " ")
    .replace(/&#\d+;/g, " ")
    // Normalise whitespace — keep newlines but collapse spaces/tabs on each line
    .replace(/[ \t]+/g, " ")
    .replace(/^ /gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
