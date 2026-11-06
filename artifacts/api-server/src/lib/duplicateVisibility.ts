import { jobIdentityKeys, pairKey, type DuplicateCandidate } from "./duplicatePolicy";

export type HistoricalPosting = DuplicateCandidate & {
  id: number;
  appliedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  closedAt?: Date | string | null;
};

/** Read-only suppression: undoing the anchor action or declaring the pair
 * distinct immediately restores visibility, without rewriting either record.
 */
export function historicalDuplicateMatches<T extends HistoricalPosting>(
  postings: T[], exceptions: Set<string>,
): Map<number, T[]> {
  const anchors = new Map<string, T[]>();
  for (const posting of postings) {
    if (!posting.appliedAt && !posting.deletedAt) continue;
    for (const key of jobIdentityKeys(posting)) {
      const matches = anchors.get(key) ?? [];
      matches.push(posting);
      anchors.set(key, matches);
    }
  }
  const result = new Map<number, T[]>();
  for (const posting of postings) {
    if (posting.appliedAt || posting.deletedAt || posting.closedAt) continue;
    const matches = new Map<number, T>();
    for (const key of jobIdentityKeys(posting)) {
      for (const anchor of anchors.get(key) ?? []) {
        if (anchor.id !== posting.id && !exceptions.has(pairKey(posting.id, anchor.id))) {
          matches.set(anchor.id, anchor);
        }
      }
    }
    if (matches.size) result.set(posting.id, [...matches.values()]);
  }
  return result;
}
