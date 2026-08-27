import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";
import { validatePublicFeedUrl } from "./customFeed";

const MAX_RESULTS = 20;
const LOCATION_HINTS = [
  "San Francisco", "New York", "Los Angeles", "Seattle", "Chicago", "Boston", "Austin",
  "Denver", "Washington DC", "Washington, DC", "Atlanta", "Miami", "Dallas", "Houston",
  "San Diego", "Portland", "Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa",
  "Edmonton", "Winnipeg", "Canada", "United States", "USA",
];

function decodeHtml(value: string): string {
  return htmlToPlainText(value)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function isGoogleHost(hostname: string): boolean {
  return hostname === "google.com" || hostname.endsWith(".google.com") || /^google\.[a-z]{2,}$/i.test(hostname) || /^www\.google\.[a-z]{2,}$/i.test(hostname);
}

export function isGoogleSearchUrl(rawUrl: string): boolean {
  try {
    const url = validatePublicFeedUrl(rawUrl);
    return isGoogleHost(url.hostname) && url.pathname === "/search" && Boolean(url.searchParams.get("q")?.trim());
  } catch {
    return false;
  }
}

export function validateGoogleSearchUrl(rawUrl: string): URL {
  const url = validatePublicFeedUrl(rawUrl);
  if (!isGoogleHost(url.hostname) || url.pathname !== "/search" || !url.searchParams.get("q")?.trim()) {
    throw new Error("Google source URL must be a Google /search URL with a query.");
  }
  return url;
}

function resultUrl(href: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href, "https://www.google.com");
  } catch {
    return null;
  }
  if (isGoogleHost(parsed.hostname)) {
    if (parsed.pathname !== "/url" && parsed.pathname !== "/search") return null;
    const target = parsed.searchParams.get("q") || parsed.searchParams.get("url");
    if (!target) return null;
    try {
      parsed = new URL(target);
    } catch {
      return null;
    }
  }
  if (!["http:", "https:"].includes(parsed.protocol) || isGoogleHost(parsed.hostname)) return null;
  if (!/\/(?:jobs?|careers?|positions?|openings?)\b/i.test(parsed.pathname) && !/greenhouse\.io$/i.test(parsed.hostname)) return null;
  return parsed.toString();
}

function locationHint(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  const hint = LOCATION_HINTS.find((candidate) => lowerQuery.includes(candidate.toLowerCase()));
  if (!hint) return null;
  if (["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Winnipeg", "Canada"].includes(hint)) {
    return hint === "Canada" ? hint : `${hint}, Canada`;
  }
  return ["United States", "USA"].includes(hint) ? hint : `${hint}, United States`;
}

function companyFromResult(title: string, url: URL): { title: string; company: string } {
  const cleanedTitle = title.replace(/^\s*job application for\s+/i, "").trim();
  const atMatch = cleanedTitle.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch?.[1] && atMatch[2]) return { title: atMatch[1].trim(), company: atMatch[2].trim() };
  const pathParts = url.pathname.split("/").filter(Boolean);
  const greenhouseCompany = url.hostname.includes("greenhouse.io") ? pathParts[0] : "";
  return {
    title: cleanedTitle,
    company: greenhouseCompany ? greenhouseCompany.replace(/[-_]/g, " ") : url.hostname.replace(/^www\./, ""),
  };
}

export function parseGoogleSearchResults(raw: string, searchUrl: string, provider: string): OnlineJobCandidate[] {
  const query = validateGoogleSearchUrl(searchUrl).searchParams.get("q") ?? "";
  const location = locationHint(query);
  const candidates: OnlineJobCandidate[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(raw)) && candidates.length < MAX_RESULTS) {
    const url = resultUrl(decodeHtml(match[2] ?? ""));
    if (!url || seen.has(url)) continue;
    const parsedUrl = new URL(url);
    const anchorText = decodeHtml(match[3] ?? "").replace(/\s+/g, " ").trim();
    if (anchorText.length < 5) continue;
    const { title, company } = companyFromResult(anchorText, parsedUrl);
    if (!title || !company) continue;
    seen.add(url);
    candidates.push({
      provider,
      sourceJobId: url,
      title,
      company,
      description: anchorText.slice(0, 2_000),
      url,
      location,
      remote: /\bremote\b/i.test(query),
      tags: [],
      postedAt: null,
    });
  }
  return candidates;
}

export async function fetchGoogleSearchResults(rawUrl: string, provider: string): Promise<OnlineJobCandidate[]> {
  const searchUrl = validateGoogleSearchUrl(rawUrl);
  searchUrl.searchParams.set("num", String(MAX_RESULTS));
  searchUrl.searchParams.set("gbv", "1");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "CareerScout/1.0",
      },
    });
    if (!response.ok) throw new Error(`Google Search request failed (${response.status}).`);
    return parseGoogleSearchResults(await response.text(), rawUrl, provider);
  } finally {
    clearTimeout(timeout);
  }
}