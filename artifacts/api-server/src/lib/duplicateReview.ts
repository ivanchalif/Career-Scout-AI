import { setImmediate } from "node:timers/promises";
import { compareJobs, exactTitleCompanyKey, jobIdentityKeys, mayMatchJobs, normalizeEmployer, pairKey, type DuplicateDecision } from "./duplicatePolicy";
import { isHistoricalDuplicateAnchor, type HistoricalPosting } from "./duplicateVisibility";

/** Every non-distinct decision requires either shared identity or employer.
 * Index those prerequisites once instead of parsing URLs for every history pair.
 * Yield between batches so even a large same-employer history cannot block writes.
 */
export async function findDuplicateReviews<T extends HistoricalPosting>(
  postings: T[], exceptions: Set<string>, limit = 40, postingIds?: Set<number>,
  loadDescriptions?: (ids: number[]) => Promise<{ id: number; fullDescription: string }[]>,
): Promise<{ a: T; b: T; decision: DuplicateDecision }[]> {
  // Do not mutate the caller's metadata or pretend an unloaded description is
  // empty evidence. A failed fetch rejects the request rather than hiding warnings.
  const descriptions = new Map<number, string>();
  async function hydrate(jobs: T[]): Promise<void> {
    if (!loadDescriptions) return;
    const ids = [...new Set(jobs.map(p => p.id))].filter(id => !descriptions.has(id));
    if (!ids.length) return;
    for (const row of await loadDescriptions(ids)) descriptions.set(row.id, row.fullDescription);
    // Jobs may have been removed between the metadata and evidence reads. Retry
    // the request with a fresh snapshot instead of comparing incomplete evidence.
    if (ids.some(id => !descriptions.has(id))) throw new Error("Duplicate review candidates changed; retry the request");
  }
  const withDescription = (job: T): T => loadDescriptions
    ? { ...job, fullDescription: descriptions.get(job.id)! } : job;
  const active = postings.filter(p => !p.appliedAt && !p.deletedAt && !p.closedAt);
  // Scope the subjects, not the comparison pool: a visible job may match any page.
  const subjects = postingIds ? active.filter(p => postingIds.has(p.id)) : active;
  if (!subjects.length) return [];
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
      for (const position of index.get(key) ?? []) {
        positions.add(position);
        if (++comparisons % 100 === 0) await setImmediate();
      }
    }
    async function* candidates() {
      // Preserve historical priority and stable ordering. Previously covered
      // partners remain evidence for the remaining copies in odd-sized groups.
      for (const position of [...positions].sort((a, b) => a - b)) {
        const b = partners[position];
        if (++comparisons % 25 === 0) await setImmediate();
        if (a.id === b.id || exceptions.has(pairKey(a.id, b.id))) continue;
        // Permissive metadata-only policy: descriptions could still match.
        if (!loadDescriptions || mayMatchJobs(a, b)) yield b;
      }
    }
    const iterator = candidates();
    let covered = false;
    while (!covered) {
      const batch: T[] = [];
      // At most 50 descriptions per query, after identity/employer indexing,
      // pair exceptions and title/location/ATS prerequisites. Stop fetching once
      // a decisive partner covers the subject, even in same-title histories.
      // Try one partner first: filling a large first batch would scan the whole
      // employer history just to discover a single eligible off-page match.
      const batchSize = loadDescriptions && descriptions.has(a.id) ? 49 : 1;
      while (batch.length < batchSize) {
        const next = await iterator.next();
        if (next.done) break;
        batch.push(next.value);
      }
      if (!batch.length) break;
      await hydrate([a, ...batch]);
      for (const b of batch) {
        if (++comparisons % 25 === 0) await setImmediate();
        const decision = compareJobs(withDescription(a), withDescription(b));
        if (decision.kind === "distinct") continue;
        covered = true;
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
    }
    // Scoped calls return at most one pair per subject, rather than silently
    // dropping visible subjects when unrelated account-wide matches use the cap.
    if (!postingIds && results.length >= limit) break;
  }
  return results;
}
