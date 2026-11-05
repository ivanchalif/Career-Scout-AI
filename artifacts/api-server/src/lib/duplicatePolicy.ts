import { jobLinkKind } from "./sources/jobLinks";

export type DuplicateCandidate = {
  id?: number; title: string; company: string; link?: string | null;
  location?: string | null; fullDescription?: string | null;
};
export type DuplicateDecision = { kind: "distinct" | "review" | "duplicate"; evidence: string[] };

export function canonicalizeJobUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|src$|gclid$|fbclid$|trk$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch { return ""; }
}

/** Legal suffixes only; meaningful employer words are never discarded. */
export function normalizeEmployer(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(?:incorporated|inc|llc|ltd|limited|corporation|corp|plc|gmbh)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\bmgmt\b/g, "management").replace(/\bmgr\b/g, "manager")
    .replace(/\bsvp\b/g, "senior vice president").replace(/\bevp\b/g, "executive vice president")
    .replace(/\bvp\b/g, "vice president").replace(/\bdir\b/g, "director")
    .replace(/\bsr\b/g, "senior").replace(/\bjr\b/g, "junior")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Unknown collection/tracking URLs are not evidence of one specific opening. */
export function individualJobUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (jobLinkKind(raw) === "listing") return null;
    if (jobLinkKind(raw) === "job") return canonicalizeJobUrl(raw);
    if (/\b(?:search|category|department|team|board|all-jobs)\b/i.test(url.pathname)) return null;
    const jobId = ["jobId", "job_id", "jid", "gh_jid", "requisitionId"].find((key) => url.searchParams.get(key));
    if (jobId || /\/(?:jobs?|careers?|positions?|openings?|requisitions?)\/.+/i.test(url.pathname)) return canonicalizeJobUrl(raw);
    return null;
  } catch { return null; }
}

/** IDs include platform and employer scope; unrelated employers may reuse IDs. */
export function atsIdentity(raw?: string | null): { scope: string; id: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (/^jobs(?:\.eu)?\.lever\.co$/.test(host) && parts[0] && parts[1] && !["search", "apply"].includes(parts[1]))
      return { scope: `lever:${parts[0].toLowerCase()}`, id: parts[1] };
    if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(host) && parts[0] !== "embed") {
      const id = url.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? url.searchParams.get("gh_jid");
      if (parts[0] && id) return { scope: `greenhouse:${parts[0].toLowerCase()}`, id };
    }
    if (host === "jobs.ashbyhq.com" && parts[0] && parts[1])
      return { scope: `ashby:${parts[0].toLowerCase()}`, id: parts[1] };
    if (host.endsWith(".myworkdayjobs.com")) {
      const id = url.pathname.match(/_([^/_]+)\/?$/)?.[1];
      if (id) return { scope: `workday:${host.split(".")[0]}`, id };
    }
    return null;
  } catch { return null; }
}

const words = (value: string) => new Set(normalizeTitle(value).split(" ").filter(Boolean));
function overlap(a: Set<string>, b: Set<string>): number {
  return a.size && b.size ? [...a].filter((word) => b.has(word)).length / Math.max(a.size, b.size) : 0;
}
const GENERIC_TITLE = new Set("senior junior principal staff lead head director vice president executive assistant associate manager management product products engineering engineer software of the and for ii iii iv".split(" "));
function level(title: string): string {
  const normalized = normalizeTitle(title);
  return ["vice president", "head", "director", "principal", "staff", "senior", "junior", "associate"].find((word) => new RegExp(`\\b${word}\\b`).test(normalized)) ?? "unspecified";
}

export function compareJobs(a: DuplicateCandidate, b: DuplicateCandidate): DuplicateDecision {
  const distinct: DuplicateDecision = { kind: "distinct", evidence: [] };
  const aUrl = individualJobUrl(a.link), bUrl = individualJobUrl(b.link);
  if (aUrl && aUrl === bUrl) return { kind: "duplicate", evidence: ["Same individual-job URL after removing tracking parameters"] };
  const aId = atsIdentity(a.link), bId = atsIdentity(b.link);
  if (aId && bId && aId.scope === bId.scope) {
    if (aId.id !== bId.id) return distinct;
    return { kind: "duplicate", evidence: ["Same employer-scoped ATS requisition ID"] };
  }
  const employer = normalizeEmployer(a.company);
  if (!employer || employer !== normalizeEmployer(b.company)) return distinct;
  // A missing seniority marker is not permission to equate senior and generic roles.
  if (level(a.title) !== level(b.title)) return distinct;
  const aWords = words(a.title), bWords = words(b.title);
  if (overlap(aWords, bWords) < 0.75) return distinct;
  const aSpecific = new Set([...aWords].filter((word) => !GENERIC_TITLE.has(word)));
  const bSpecific = new Set([...bWords].filter((word) => !GENERIC_TITLE.has(word)));
  if (aSpecific.size && bSpecific.size && overlap(aSpecific, bSpecific) < 0.75) return distinct;
  const locationA = normalizeTitle(a.location ?? ""), locationB = normalizeTitle(b.location ?? "");
  if (locationA && locationB && locationA !== locationB) return distinct;
  const descriptionMatch = (a.fullDescription?.length ?? 0) >= 250 && (b.fullDescription?.length ?? 0) >= 250
    && overlap(words(a.fullDescription!), words(b.fullDescription!)) >= 0.85;
  const domainMatch = aSpecific.size > 0 && bSpecific.size > 0 && overlap(aSpecific, bSpecific) >= 0.9;
  if (!descriptionMatch && !domainMatch) return distinct;
  return { kind: "review", evidence: [
    "Same employer (legal suffixes normalized)", "Matching role title and seniority",
    ...(domainMatch ? ["Matching specialty or team terms in both titles"] : []),
    ...(descriptionMatch ? ["Closely matching job descriptions"] : []),
    ...(locationA && locationB ? ["Same stated location"] : []),
    "Different or unverified listing identities — review required",
  ] };
}

export function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}
