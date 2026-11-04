import type { OnlineJobCandidate } from "./arbeitnow";
import { jobLinkKind } from "./jobLinks";
import { canonicalizeJobUrl } from "../dedup";

type FetchListing = (url: string, provider: string) => Promise<OnlineJobCandidate[]>;

/** Expand known category/company boards once, never import the board as a job. */
export async function expandSearchListings(
  candidates: OnlineJobCandidate[],
  fetchListing: FetchListing,
  warn: (message: string) => void,
): Promise<OnlineJobCandidate[]> {
  const result: OnlineJobCandidate[] = [];
  const visited = new Set<string>();
  let requests = 0;
  for (const candidate of candidates) {
    if (jobLinkKind(candidate.url) !== "listing") {
      result.push(candidate);
      continue;
    }
    const key = canonicalizeJobUrl(candidate.url);
    if (visited.has(key)) continue;
    visited.add(key);
    if (requests >= 3) {
      warn("Additional listing pages deferred by the three-page expansion limit.");
      continue;
    }
    requests++;
    try {
      const jobs = await fetchListing(candidate.url, candidate.provider);
      result.push(...jobs.filter(job => jobLinkKind(job.url) !== "listing").slice(0, 120));
    } catch (error) {
      warn(`Could not extract jobs from ${candidate.url}: ${error instanceof Error ? error.message : "page request failed"}`);
    }
  }
  return result;
}
