import { logger } from "./logger";

const PAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CONTENT_CHARS = 10_000;
const MIN_USEFUL_CHARS = 150;

/**
 * Fetches a job posting URL and extracts plain text from the page.
 * Returns null if the fetch fails, times out, or the page produces too little
 * readable content (e.g. JavaScript-only SPA with no SSR).
 */
export async function fetchJobPageContent(url: string): Promise<string | null> {
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

    logger.info({ url, chars: text.length }, "pageScraper: page fetched successfully");
    return text.slice(0, MAX_PAGE_CONTENT_CHARS);
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
