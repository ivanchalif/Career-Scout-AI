import { canonicalizeJobUrl } from "./dedup";
import type { OnlineJobCandidate } from "./sources/arbeitnow";

export type SearchOptions = { offset?: number; freshness?: "pw" | "pm" };
type Search = (url: string, provider: string, options?: SearchOptions) => Promise<OnlineJobCandidate[]>;

/** Preserve the requested site while dropping exact-title and location constraints. */
export function buildBroaderSearchQuery(query: string, role: string): string {
  const site = query.match(/(?:^|\s)site:([^\s]+)/i)?.[1];
  if (!site) return query; // Do not reinterpret arbitrary custom searches.
  const requestedRole = query.match(/"([^"]+)"/)?.[1] || role;
  let terms = requestedRole
    .replace(/\b(?:senior|sr\.?|junior|jr\.?|principal|staff|lead|head|director|vice president|vp|svp|executive|of)\b/gi, " ")
    .replace(/["<>]/g, "").replace(/\s+/g, " ").trim();
  if (/^product(?:\s+management)?$/i.test(terms)) terms = "product manager";
  if (!terms) return query;
  // Keep explicit negative terms from a user-authored search.
  const exclusions = query.match(/(?:^|\s)(-[^\s"]+|-"[^"]+")/g)?.map(term => term.trim()) ?? [];
  return [`site:${site}`, terms, ...exclusions].join(" ");
}

/** At most two requests per query and two queries per source; keep undated jobs eligible. */
export async function searchBeyondKnown(
  queries: string[],
  provider: string,
  run: number,
  freshnessWindow: string,
  knownUrls: Set<string>,
  fetchPage: Search,
  broaderQueries: string[] = [],
): Promise<{ candidates: OnlineJobCandidate[]; requests: number; errors: string[] }> {
  const candidates: OnlineJobCandidate[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let requests = 0;
  const page = run % 3;
  const freshness = freshnessWindow === "past_week" ? "pw" : freshnessWindow === "past_month" ? "pm" : undefined;
  for (const [index, query] of queries.slice(0, 2).entries()) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    requests++;
    let first: OnlineJobCandidate[];
    try {
      first = await fetchPage(url, provider, { offset: page, freshness });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Search page failed");
      continue;
    }
    let unseen = 0;
    for (const candidate of first) {
      const canonical = canonicalizeJobUrl(candidate.url);
      if (!seen.has(canonical) && !knownUrls.has(canonical)) unseen++;
      seen.add(canonical);
      candidates.push(candidate);
    }
    // Broaden a thin/repeat-heavy search, rather than asking for the next page
    // of the same overly exact phrase. Stay within the existing request budget.
    if (unseen < 4) {
      requests++;
      try {
        const broader = broaderQueries[index];
        const changedQuery = broader && broader !== query;
        const fallbackUrl = changedQuery ? `https://www.google.com/search?q=${encodeURIComponent(broader)}` : url;
        const fallback = await fetchPage(fallbackUrl, provider, { offset: changedQuery ? page : (page + 1) % 3 });
        for (const candidate of fallback) {
          seen.add(canonicalizeJobUrl(candidate.url));
          candidates.push(candidate);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Fallback page failed");
      }
    }
  }
  return { candidates, requests, errors };
}

export function pruneRejected<T extends { expiresAt: number; context: string }>(
  rejected: Record<string, T>, context: string, now = Date.now(),
): Record<string, T> {
  return Object.fromEntries(Object.entries(rejected)
    .filter(([, value]) => value.context === context && value.expiresAt > now)
    .slice(-1000));
}
