import { logger } from "./logger";

const PAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CONTENT_CHARS = 10_000;
const MIN_USEFUL_CHARS = 150;

export interface PageResult {
  content: string;
  finalUrl: string;
}

/**
 * Fetches a job posting URL and extracts plain text from the page.
 * Returns null if the fetch fails, times out, or the page produces too little
 * readable content (e.g. JavaScript-only SPA with no SSR).
 *
 * `finalUrl` is the URL after following all redirects — useful when the input
 * is a click-tracking URL (e.g. Jobgether, LinkedIn) so callers can store the
 * clean destination URL instead of the opaque tracking link.
 */
export async function fetchJobPageContent(url: string): Promise<PageResult | null> {
  let controller: AbortController | undefined;
  let tid: ReturnType<typeof setTimeout> | undefined;

  try {
    controller = new AbortController();
    tid = setTimeout(() => controller!.abort(), PAGE_FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CareerScout/1.0; job-aggregator)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    clearTimeout(tid);

    if (!res.ok) {
      logger.debug({ url, status: res.status }, "pageScraper: non-OK response");
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      logger.debug({ url, contentType }, "pageScraper: skipping non-HTML content");
      return null;
    }

    const html = await res.text();
    const text = htmlToText(html);

    if (text.length < MIN_USEFUL_CHARS) {
      logger.debug(
        { url, chars: text.length },
        "pageScraper: extracted text too short — likely JS-only page",
      );
      return null;
    }

    const errorReason = detectErrorPage(text);
    if (errorReason) {
      logger.info({ url, reason: errorReason }, "pageScraper: error/redirect page detected, skipping");
      return null;
    }

    const finalUrl = res.url && res.url !== url ? res.url : url;
    logger.info({ url, finalUrl, chars: text.length }, "pageScraper: page fetched successfully");
    return { content: text.slice(0, MAX_PAGE_CONTENT_CHARS), finalUrl };
  } catch (err) {
    clearTimeout(tid);
    const msg = (err as Error)?.message ?? String(err);
    const isAbort = msg.includes("aborted") || msg.includes("abort");
    logger.debug(
      { url, err: msg },
      isAbort ? "pageScraper: fetch timed out" : "pageScraper: fetch error",
    );
    return null;
  }
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
