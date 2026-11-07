import { buildSourceHealth, eligibleSourcePostings } from "./sourceHealth";
import { isGoogleSearchUrl } from "./sources/googleSearch";
import type { InvestigateOnlineDiscoverySourceResponse } from "@workspace/api-zod";
import type { z } from "zod";

type HealthArgs = Parameters<typeof buildSourceHealth>;
export type InvestigationProbe = z.infer<typeof InvestigateOnlineDiscoverySourceResponse>["probe"];
type Recommendation = z.infer<typeof InvestigateOnlineDiscoverySourceResponse>["recommendations"][number];
export type InvestigationSource = HealthArgs[0] & { name: string; url: string; kind: string; updatedAt: Date };

/** Recommendations are bounded configuration changes, never guessed edits to
 * application code or automatic changes to global eligibility/history.
 */
export function analyzeSource(
  source: InvestigationSource, sources: HealthArgs[1], postings: HealthArgs[2],
  provenance: HealthArgs[3], feedback: HealthArgs[4], profile: HealthArgs[5],
  runs: HealthArgs[6], probe: InvestigationProbe, now = new Date(),
) {
  const health = buildSourceHealth(source, sources, postings, provenance, feedback, profile, runs, now);
  const kinds = new Map(feedback.map(row => [row.jobPostingId, row.kind]));
  const recent = eligibleSourcePostings(source, sources, postings, provenance, profile)
    .filter(posting => posting.createdAt.getTime() >= now.getTime() - 30 * 86400_000);
  const counts = new Map<string, number>();
  for (const posting of recent) {
    if (posting.appliedAt || !posting.deletedAt) continue;
    const kind = kinds.get(posting.id);
    if (!["user", "manual", "duplicate"].includes(posting.deletedBy ?? "") &&
      !(posting.deletedBy == null && kind && kind !== "more_like_this")) continue;
    const reason = kind && kind !== "more_like_this" ? kind : "no_reason";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const dismissals = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const findings = [
    `${health.recentAdded} eligible additions, ${health.applied} applications and ${health.dismissed} dismissals in the last 30 days.`,
    ...health.reasons,
  ];
  if (dismissals[0]) findings.push(`Most common recorded dismissal: ${dismissals[0].reason.replaceAll("_", " ")} (${dismissals[0].count}). This is feedback, not proof the parser is broken.`);
  if (probe.status === "ok") {
    findings.push(`Live retrieval returned ${probe.retrieved} distinct links; ${probe.unseen} are not in saved URL history and ${probe.eligibleBySavedFilters} pass current saved visibility filters.`);
    findings.push("These are retrieval checks, not promised additions: full-posting screening, identity checks and fit scoring still apply during discovery.");
    if (!probe.knownPostingDates) findings.push("Live posting dates are unknown; no freshness conclusion can be drawn.");
    if (probe.retrieved && probe.unseen === 0) findings.push("All tested links are already known. Discovery already rotates and broadens retrieval within its request budget; duplicate protection should remain enabled.");
  } else if (probe.status === "failed") findings.push(`Live retrieval failed: ${probe.error}`);
  else findings.push(probe.error ?? "Live retrieval was not run.");

  const recommendations: Recommendation[] = [];
  if (source.kind !== "builtin" && isGoogleSearchUrl(source.url) && (counts.get("too_junior") ?? 0) >= 2) {
    const url = new URL(source.url);
    const query = url.searchParams.get("q") ?? "";
    const additions = ["-junior", "-intern"].filter(term => !query.toLowerCase().includes(term));
    if (additions.length) {
      url.searchParams.set("q", `${query} ${additions.join(" ")}`.trim());
      recommendations.push({
        id: "exclude-junior", action: "update_query", title: "Exclude junior and intern search terms",
        explanation: `${counts.get("too_junior")} recent jobs were explicitly dismissed as too junior. Add ${additions.join(" ")} to this source only. This may reduce retrieval volume; existing jobs, search operators and global filters are unchanged.`,
        proposedUrl: url.toString(),
      });
    }
  }
  if (source.kind !== "builtin") recommendations.push({
    id: "edit-source", action: "edit", title: "Review and edit this source's URL or search query",
    explanation: "Use the observed dismissal reasons to refine the source. Review the exact URL/query before saving; domain and location feedback alone do not identify safe automatic exclusions.",
    proposedUrl: null,
  });
  if (!source.isSuppressed && (health.color === "red" || probe.status === "failed")) recommendations.push({
    id: "pause-source", action: "pause", title: "Pause this source",
    explanation: "Stop future searches from this source while you review its relevance. All existing jobs and history stay intact; Restore re-enables it.",
    proposedUrl: null,
  });
  recommendations.push({
    id: "retest", action: "retry", title: "Run the investigation again",
    explanation: "Retry bounded live retrieval after a temporary failure or after changing the source. This does not import jobs or advance normal discovery progress.",
    proposedUrl: null,
  });
  return {
    sourceId: source.id, sourceUpdatedAt: source.updatedAt, investigatedAt: now,
    summary: health.label === "Low usefulness"
      ? "This source is producing jobs, but recent user responses indicate poor relevance."
      : probe.status === "failed" ? "A retrieval issue needs attention; historical usefulness is reported separately."
      : "Review usefulness evidence separately from the live retrieval check.",
    health, findings, dismissals, probe, recommendations,
  };
}
