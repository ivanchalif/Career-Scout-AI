import { compareJobs, duplicateMatchKeys, pairKey, type DuplicateCandidate } from "./duplicatePolicy";

export type HistoricalPosting = DuplicateCandidate & {
  id: number;
  appliedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  closedAt?: Date | string | null;
  deletedBy?: string | null;
  dismissalReason?: string | null;
};

/** A discarded extra copy is not evidence that the retained opening is unwanted. */
export function isHistoricalDuplicateAnchor(posting: HistoricalPosting): boolean {
  return !!posting.appliedAt || (!!posting.deletedAt
    && posting.deletedBy !== "duplicate" && posting.dismissalReason !== "duplicate");
}

/** Only applied/dismissed records can anchor automatic duplicate flags.
 * Two active copies remain visible for review; pair exceptions always win.
 */
export function historicalDuplicateMatches<T extends HistoricalPosting>(
  postings: T[], exceptions: Set<string>,
): Map<number, T[]> {
  const anchors = new Map<string, T[]>();
  for (const posting of postings) {
    if (!isHistoricalDuplicateAnchor(posting)) continue;
    for (const key of duplicateMatchKeys(posting)) {
      const matches = anchors.get(key) ?? [];
      matches.push(posting);
      anchors.set(key, matches);
    }
  }
  const result = new Map<number, T[]>();
  for (const posting of postings) {
    if (posting.appliedAt || posting.deletedAt || posting.closedAt) continue;
    const matches = new Map<number, T>();
    for (const key of duplicateMatchKeys(posting)) {
      for (const anchor of anchors.get(key) ?? []) {
        if (anchor.id !== posting.id && !exceptions.has(pairKey(posting.id, anchor.id))
          && compareJobs(posting, anchor).kind === "duplicate") {
          matches.set(anchor.id, anchor);
        }
      }
    }
    if (matches.size) result.set(posting.id, [...matches.values()]);
  }
  return result;
}
