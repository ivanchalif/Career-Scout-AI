import { compareJobs, duplicateMatchKeys, exactTitleCompanyKey, pairKey, type DuplicateCandidate } from "./duplicatePolicy";

export type HistoricalPosting = DuplicateCandidate & {
  id: number;
  appliedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  closedAt?: Date | string | null;
};

/** Automatic, recoverable duplicate classification. Preserve all history and
 * keep one stable active original; explicit pair exceptions always win.
 */
export function historicalDuplicateMatches<T extends HistoricalPosting>(
  postings: T[], exceptions: Set<string>,
): Map<number, T[]> {
  const anchors = new Map<string, T[]>();
  for (const posting of postings) {
    if (!posting.appliedAt && !posting.deletedAt) continue;
    for (const key of duplicateMatchKeys(posting)) {
      const matches = anchors.get(key) ?? [];
      matches.push(posting);
      anchors.set(key, matches);
    }
  }
  const result = new Map<number, T[]>();
  // Oldest ID is a stable original, independent of sort order or pagination.
  for (const posting of [...postings].sort((a, b) => a.id - b.id)) {
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
    else {
      // Active-to-active auto-classification is limited to exact title/company.
      const key = exactTitleCompanyKey(posting);
      if (key) {
        const originals = anchors.get(key) ?? [];
        originals.push(posting);
        anchors.set(key, originals);
      }
    }
  }
  return result;
}
