import { canonicalizeJobUrl } from "./dedup";
import type { OnlineJobCandidate } from "./sources/arbeitnow";

export type SearchOptions = { offset?: number; freshness?: "pw" | "pm" };
type Search = (url: string, provider: string, options?: SearchOptions) => Promise<OnlineJobCandidate[]>;

/** At most two pages per query and two queries per source; keep undated jobs eligible. */
export async function searchBeyondKnown(
  queries: string[],
  provider: string,
  run: number,
  freshnessWindow: string,
  knownUrls: Set<string>,
  fetchPage: Search,
): Promise<{ candidates: OnlineJobCandidate[]; requests: number; errors: string[] }> {
  const candidates: OnlineJobCandidate[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let requests = 0;
  const page = run % 3;
  const freshness = freshnessWindow === "past_week" ? "pw" : freshnessWindow === "past_month" ? "pm" : undefined;
  for (const query of queries.slice(0, 2)) {
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
    // A thin or repeat-heavy page gets a deeper, date-unrestricted fallback.
    if (unseen < 4) {
      requests++;
      try {
        const fallback = await fetchPage(url, provider, { offset: (page + 1) % 3 });
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
