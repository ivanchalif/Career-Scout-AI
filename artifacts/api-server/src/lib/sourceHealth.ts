import type { DiscoveryProgress } from "@workspace/db";
import { bayAreaFilterReason } from "./bayAreaFilter";
import { isHiddenByWorkday } from "./workdayFilter";

type Source = { id: number; provider: string; isSuppressed: boolean };
type Posting = {
  id: number; source: string; title: string; company: string; link: string | null;
  location: string | null; remoteType: string | null; sourcePostedAt: Date | null;
  createdAt: Date; appliedAt: Date | null; deletedAt: Date | null; deletedBy: string | null;
};
type Profile = {
  companyFilterSettings?: { mode: string; companies: string[]; excludeWorkday?: boolean; bayAreaNonRemoteOnly?: boolean } | null;
  titleExcludeKeywords?: string[] | null;
};
type Provenance = { jobPostingId: number; provider: string; isPrimary: boolean };

export function eligibleSourcePostings(
  source: Source, sources: Source[], postings: Posting[], provenance: Provenance[], profile?: Profile | null,
) {
  const primary = new Map(provenance.filter(row => row.isPrimary).map(row => [row.jobPostingId, row.provider]));
  return postings.filter(posting =>
    sourceIdForProvider(primary.get(posting.id) ?? posting.source, sources) === source.id && countsAsAdded(posting, profile));
}

/** Same reversible visibility preferences as the dashboard; dismissal is an outcome, not a filter. */
export function countsAsAdded(posting: Pick<Posting, "title" | "company" | "link" | "location" | "remoteType">, profile?: Profile | null): boolean {
  const settings = profile?.companyFilterSettings;
  if (isHiddenByWorkday(posting, settings) || bayAreaFilterReason(posting, settings)) return false;
  if (profile?.titleExcludeKeywords?.some(keyword => posting.title.toLowerCase().includes(keyword.toLowerCase()))) return false;
  if (settings && settings.mode !== "off" && settings.companies.length) {
    const company = posting.company.toLowerCase();
    const matches = settings.companies.some(entry => company.includes(entry.toLowerCase()) || entry.toLowerCase().includes(company));
    if (settings.mode === "include" && !matches || settings.mode === "exclude" && matches) return false;
  }
  return true;
}

export function sourceIdForProvider(provider: string, sources: Source[]): number | null {
  const id = provider.match(/^(?:brave|custom|hiringcafe):(\d+)$/)?.[1];
  if (id) return sources.find(source => source.id === Number(id))?.id ?? null;
  const matches = sources.filter(source => source.provider === provider);
  return matches.length === 1 ? matches[0].id : null;
}

export function buildSourceHealth(
  source: Source, sources: Source[], postings: Posting[], provenance: Provenance[],
  feedback: Array<{ jobPostingId: number; kind: string }>, profile: Profile | null | undefined,
  runs: DiscoveryProgress["sourceRuns"], now = new Date(),
) {
  const attributed = eligibleSourcePostings(source, sources, postings, provenance, profile);
  const history = runs?.[String(source.id)] ?? [];
  const last = history.at(-1);
  const cutoff = now.getTime() - 30 * 86400_000;
  const recent = attributed.filter(posting => new Date(posting.createdAt).getTime() >= cutoff);
  const kinds = new Map(feedback.map(row => [row.jobPostingId, row.kind]));
  const applied = recent.filter(posting => posting.appliedAt != null).length;
  const negative = new Set(["not_my_role", "wrong_location", "already_closed", "workday", "duplicate", "wrong_domain", "too_junior"]);
  const dismissed = recent.filter(posting => !posting.appliedAt && posting.deletedAt != null && (
    ["user", "manual", "duplicate"].includes(posting.deletedBy ?? "") ||
    posting.deletedBy == null && negative.has(kinds.get(posting.id) ?? "")
  )).length;
  const dated = recent.filter(posting => posting.sourcePostedAt && new Date(posting.sourcePostedAt).getTime() <= now.getTime());
  const fresh = dated.filter(posting => new Date(posting.sourcePostedAt!).getTime() >= cutoff).length;
  const eligibleIds = new Set(attributed.map(posting => posting.id));
  const metrics = {
    latestSearchAdded: last ? last.addedPostingIds.filter(id => eligibleIds.has(id)).length : null,
    totalAdded: attributed.length, recentAdded: recent.length, applied, dismissed,
    knownPostingDates: dated.length, recentPostings: fresh,
    lastSearchAt: last?.at ?? null,
  };
  let color: "green" | "yellow" | "red" = "yellow";
  let label = "Learning";
  const reasons: string[] = [];
  const responses = applied + dismissed;
  const dismissalShare = responses ? dismissed / responses : 0;
  const lastThree = history.slice(-3);
  const repeatedLowYield = lastThree.length === 3 && lastThree.every(run => !run.error && run.addedPostingIds.length === 0) &&
    now.getTime() - new Date(lastThree[0].at).getTime() >= 14 * 86400_000 && recent.length === 0;
  if (source.isSuppressed) {
    label = "Paused";
    reasons.push("Source is paused; its historical additions are retained.");
  } else if (last?.error) {
    color = "red"; label = "Needs attention";
    reasons.push(`Latest search failed: ${last.error}`);
  } else if (responses >= 3 && dismissalShare >= 0.8) {
    color = "red"; label = "Low usefulness";
    reasons.push("At least 80% of three or more recent responses were dismissals.");
  } else if (repeatedLowYield) {
    color = "red"; label = "Low yield";
    reasons.push("No eligible additions in the last 30 days, with three zero-add searches spanning at least 14 days.");
  } else if (recent.length > 0 && (applied > 0 || recent.length >= 3 && dated.length >= 3 && fresh / dated.length >= 0.6) &&
    !(responses >= 3 && dismissalShare >= 0.6)) {
    color = "green"; label = "Healthy";
    reasons.push(applied > 0 ? "Recent additions led to at least one application." : "At least three recent additions have known dates; 60% or more were posted in the last 30 days.");
  } else {
    label = attributed.length ? "Watch" : "Learning";
    reasons.push(attributed.length ? "Not enough recent additions, fresh dated postings, or positive responses for a green rating." : "No eligible additions yet; retrieved and excluded results do not count.");
  }
  if (!dated.length) reasons.push("Posting dates are unknown; import time is not used as the posting date.");
  if (!responses) reasons.push("No applied or dismissed responses to recent additions yet.");
  for (const note of last?.recoveryNotes ?? []) reasons.push(`Latest search recovery: ${note}`);
  reasons.push("Health uses a rolling 30-day window. Counts exclude current dashboard filters and credit only the original importing source, not duplicate sightings.");
  return { color, label, reasons, ...metrics };
}
