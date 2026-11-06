import type { JobIdentityEvidence } from "@workspace/db";
import { atsIdentity, individualJobUrl, canonicalizeJobUrl } from "./duplicatePolicy";
import { jobLinkKind, publicJobUrl } from "./sources/jobLinks";

/** Only a single, unambiguous JobPosting can describe the current opening. */
function jobPostings(html: string): Record<string, unknown>[] {
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    return [record, ...flatten(record["@graph"])];
  };
  const postings: Record<string, unknown>[] = [];
  for (const script of (html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []).slice(0, 20)) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script\s*>$/i, "");
    if (raw.length > 200_000) continue;
    try {
      postings.push(...flatten(JSON.parse(raw)).filter((record) =>
        [record["@type"]].flat().some((type) => typeof type === "string" && type.split(/[\/#]/).at(-1)?.toLowerCase() === "jobposting")));
    } catch { /* Malformed metadata is not identity evidence. */ }
  }
  return postings;
}

function urlValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return urlValue((value as Record<string, unknown>)["@id"]);
  return null;
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4]).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  }
  return result;
}

export function extractJobIdentity(input: {
  inputUrl: string; finalUrl: string; redirectChain: string[]; observedAt: Date;
  html?: string; usable: boolean; failureReason?: string;
}): JobIdentityEvidence {
  const evidence: JobIdentityEvidence = {
    version: 1, status: "uncertain", reason: input.failureReason ?? "no_original_posting_evidence",
    observedAt: input.observedAt.toISOString(), inputUrl: input.inputUrl, finalUrl: input.finalUrl,
    redirectChain: input.redirectChain, signals: [],
  };
  if (!input.usable || !input.html) return evidence;
  if (input.redirectChain.length > 1 && (jobLinkKind(input.finalUrl) === "listing"
    || /\/(?:login|signin|sign-in|signup|sign-up|auth|oauth)(?:\/|$)/i.test(new URL(input.finalUrl).pathname)))
    return { ...evidence, reason: "redirect_to_collection_or_login" };
  const html = input.html.replace(/<!--[\s\S]*?-->/g, "");
  const postings = jobPostings(html);
  if (postings.length > 1) return { ...evidence, reason: "multiple_job_postings" };
  const posting = postings[0];
  const org = posting?.hiringOrganization;
  const orgUrl = org && typeof org === "object" ? urlValue((org as Record<string, unknown>).url) : null;
  let employerHost: string | undefined;
  try { employerHost = orgUrl ? new URL(orgUrl).hostname.replace(/^www\./, "") : undefined; } catch { /* No employer scope. */ }
  const candidates: Array<{ url: string; signal: string }> = [];
  const add = (raw: string | null, signal: string, redirect = false) => {
    if (!raw) return;
    const publicUrl = publicJobUrl(raw, input.finalUrl);
    const url = individualJobUrl(publicUrl);
    if (!url) return;
    const ats = atsIdentity(url);
    // Provider job IDs (LinkedIn/Jobright) are not employer requisitions.
    const employerAts = ats && !["linkedin", "jobright"].includes(ats.scope);
    const host = new URL(url).hostname;
    const employerUrl = employerHost && (host === employerHost || host.endsWith(`.${employerHost}`));
    // Redirects are actual checked requests; metadata needs a known ATS or an
    // explicit hiringOrganization URL, never a guessed company name/domain.
    if (!employerAts && !employerUrl && !redirect) return;
    candidates.push({ url, signal });
  };
  if (input.redirectChain.length > 1 || atsIdentity(input.finalUrl)) {
    add(input.finalUrl, "safe_http_destination", true);
    for (const url of input.redirectChain.slice(1, -1)) add(url, "safe_http_redirect");
  }
  if (posting) {
    add(urlValue(posting.url), "jsonld_jobposting_url");
    add(urlValue(posting.mainEntityOfPage), "jsonld_main_entity");
  }
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<(?:template|noscript)\b[^>]*>[\s\S]*?<\/(?:template|noscript)>/gi, "");
  for (const tag of markup.match(/<(?:link|meta)\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if (attrs.rel?.toLowerCase().split(/\s+/).includes("canonical")) add(attrs.href, "canonical_link");
    if (posting && attrs.property?.toLowerCase() === "og:url") add(attrs.content, "og_url");
  }
  // A redirect to an aggregator's own page isn't contradictory to its explicit
  // employer/ATS target. Only employer-scoped destinations compete.
  const employerCandidates = candidates.filter(({ url }) => {
    const ats = atsIdentity(url);
    const host = new URL(url).hostname;
    return ats && !["linkedin", "jobright"].includes(ats.scope)
      || employerHost && (host === employerHost || host.endsWith(`.${employerHost}`));
  });
  const selected = employerCandidates.length ? employerCandidates : candidates;
  const key = (url: string) => {
    const ats = atsIdentity(url);
    return ats ? `${ats.scope}:${ats.id}` : canonicalizeJobUrl(url);
  };
  if (new Set(selected.map(({ url }) => key(url))).size > 1)
    return { ...evidence, reason: "conflicting_original_postings" };
  if (!selected.length) return evidence;
  return { ...evidence, status: "verified", reason: "verified_original_posting",
    originalUrl: selected[0].url, signals: [...new Set(selected.map(({ signal }) => signal))] };
}
