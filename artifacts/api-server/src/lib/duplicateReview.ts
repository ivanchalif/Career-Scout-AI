import { setImmediate } from "node:timers/promises";
import { compareJobs, exactTitleCompanyKey, jobIdentityKeys, normalizeEmployer, pairKey, type DuplicateDecision } from "./duplicatePolicy";
import { isHistoricalDuplicateAnchor, type HistoricalPosting } from "./duplicateVisibility";

/** Every non-distinct decision requires either shared identity or employer.
 * Index those prerequisites once instead of parsing URLs for every history pair.
 * Yield between batches so even a large same-employer history cannot block writes.
 */
export async function findDuplicateReviews<T extends HistoricalPosting>(
  postings: T[], exceptions: Set<string>, limit = 40, postingIds?: Set<number>,
): Promise<{ a: T; b: T; decision: DuplicateDecision }[]> {
  const active = postings.filter(p => !p.appliedAt && !p.deletedAt && !p.closedAt);
  // Scope the subjects, not the comparison pool: a visible job may match any page.
  const subjects = postingIds ? active.filter(p => postingIds.has(p.id)) : active;
  const partners = [...postings.filter(isHistoricalDuplicateAnchor), ...active];
  const keys = new Map<number, string[]>();
  const index = new Map<string, Set<number>>();
  for (const [position, posting] of partners.entries()) {
    const employer = normalizeEmployer(posting.company);
    const postingKeys = [...jobIdentityKeys(posting), ...(employer ? [`employer:${employer}`] : [])];
    keys.set(posting.id, postingKeys);
    for (const key of postingKeys) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(position);
    }
    if (position % 100 === 99) await setImmediate();
  }
  const seen = new Set<number>();
  const results: { a: T; b: T; decision: DuplicateDecision }[] = [];
  let comparisons = 0;
  for (const a of subjects) {
    if (seen.has(a.id)) continue;
    const positions = new Set<number>();
    for (const key of keys.get(a.id) ?? []) {
      for (const position of index.get(key) ?? []) positions.add(position);
    }
    // Preserve historical-partner priority and the original stable pairing order.
    for (const position of [...positions].sort((a, b) => a - b)) {
      const b = partners[position];
      // A previously covered partner is still evidence for another copy. Pairing
      // jobs off exclusively left the last job in every odd-sized group unflagged.
      if (a.id === b.id || exceptions.has(pairKey(a.id, b.id))) continue;
      if (++comparisons % 25 === 0) await setImmediate();
      const decision = compareJobs(a, b);
      if (decision.kind === "distinct") continue;
      // Already classified automatically in Filtered; no human review needed.
      if ((b.appliedAt || b.deletedAt) && decision.kind === "duplicate" && exactTitleCompanyKey(a)
        && exactTitleCompanyKey(a) === exactTitleCompanyKey(b)) {
        seen.add(a.id);
        break;
      }
      seen.add(a.id);
      if (!b.appliedAt && !b.deletedAt) seen.add(b.id);
      results.push({ a, b, decision: decision.kind === "duplicate" && !b.appliedAt && !b.deletedAt
        ? { kind: "review", evidence: [...decision.evidence, "Both jobs are active — user review required"] }
        : decision });
      break;
    }
    // Scoped calls return at most one pair per subject, rather than silently
    // dropping visible subjects when unrelated account-wide matches use the cap.
    if (!postingIds && results.length >= limit) break;
  }
  return results;
}
