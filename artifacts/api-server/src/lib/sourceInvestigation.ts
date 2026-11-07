import { and, eq } from "drizzle-orm";
import {
  db, onlineDiscoverySourcesTable as s, userProfilesTable as u, jobPostingsTable as p,
  jobPostingSourcesTable as ps, jobPostingFeedbackTable as f, onlineDiscoveryProgressTable as progressTable,
  type DiscoveryReport,
} from "@workspace/db";
import { buildDiscoveryCriteria, fetchConfiguredSource } from "./onlineDiscovery";
import { canonicalizeJobUrl } from "./duplicatePolicy";
import { analyzeSource, type InvestigationProbe } from "./sourceInvestigationAnalysis";
import { countsAsAdded } from "./sourceHealth";

// Only one user-triggered probe per user at a time, across sources. The existing
// search adapter also coordinates provider quota with scheduled discovery.
const active = new Set<string>();
export class SourceInvestigationBusyError extends Error {}

export async function investigateSource(userId: string, sourceId: number) {
  if (active.has(userId)) throw new SourceInvestigationBusyError("A source investigation is already running. Wait for it to finish.");
  active.add(userId);
  try {
    // Check ownership before loading history or making any external request.
    const [source] = await db.select().from(s).where(and(eq(s.userId, userId), eq(s.id, sourceId)));
    if (!source) return null;
    const [sources, profiles, postings, provenance, feedback, progress] = await Promise.all([
      db.select().from(s).where(eq(s.userId, userId)),
      db.select().from(u).where(eq(u.userId, userId)),
      db.select({
        id: p.id, source: p.source, title: p.title, company: p.company, link: p.link,
        location: p.location, remoteType: p.remoteType, sourcePostedAt: p.sourcePostedAt,
        createdAt: p.createdAt, appliedAt: p.appliedAt, deletedAt: p.deletedAt, deletedBy: p.deletedBy,
      }).from(p).where(eq(p.userId, userId)),
      db.select({ jobPostingId: ps.jobPostingId, provider: ps.provider, isPrimary: ps.isPrimary, canonicalUrl: ps.canonicalUrl })
        .from(ps).where(eq(ps.userId, userId)),
      db.select({ jobPostingId: f.jobPostingId, kind: f.kind }).from(f).where(eq(f.userId, userId)),
      db.select().from(progressTable).where(eq(progressTable.userId, userId)),
    ]);
    const profile = profiles[0];
    const criteria = buildDiscoveryCriteria(profile ?? {});
    const knownUrls = new Set([
      ...postings.flatMap(row => row.link ? [canonicalizeJobUrl(row.link)] : []),
      ...provenance.map(row => row.canonicalUrl),
    ]);
    const probe: InvestigationProbe = {
      status: "not_run", error: null, retrieved: 0, unseen: 0,
      eligibleBySavedFilters: 0, knownPostingDates: 0, recoveryNotes: [], warnings: [],
    };
    if (!criteria.roleTitles.length && !criteria.skills.length) {
      probe.error = "Add work experience or skills to your profile before testing live retrieval.";
    } else {
      const report: DiscoveryReport = { retrieved: 0, alreadySaved: 0, repeated: 0, excluded: 0, recentlyChecked: 0, deferred: 0, imported: 0, pageChecks: 0, unverified: 0, sourceFailures: 0, searchRequests: 0 };
      try {
        // fetchConfiguredSource advances cursors on its argument. Clone so a
        // diagnostic never consumes the user's discovery pages or result budget.
        const state = structuredClone(progress[0]?.state ?? { cursors: {}, rejected: {} });
        const candidates = await fetchConfiguredSource(source, criteria, state, knownUrls,
          profile?.onlineDiscoveryFreshnessWindow ?? "any_time", report, probe.warnings, probe.recoveryNotes);
        const unique = [...new Map(candidates.map(job => [canonicalizeJobUrl(job.url), job])).values()];
        probe.status = "ok";
        probe.retrieved = unique.length;
        probe.unseen = unique.filter(job => !knownUrls.has(canonicalizeJobUrl(job.url))).length;
        probe.eligibleBySavedFilters = unique.filter(job => countsAsAdded({
          ...job, link: job.url, remoteType: job.remote ? "remote" : null,
        }, profile)).length;
        probe.knownPostingDates = unique.filter(job => job.postedAt && job.postedAt <= new Date()).length;
      } catch (error) {
        probe.status = "failed";
        probe.error = (error instanceof Error ? error.message : "Retrieval failed.").slice(0, 1000);
      }
    }
    return analyzeSource(source, sources, postings, provenance, feedback, profile, progress[0]?.state.sourceRuns, probe);
  } finally {
    active.delete(userId);
  }
}
