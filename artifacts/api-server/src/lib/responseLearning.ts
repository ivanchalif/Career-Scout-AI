import { compareJobs, individualJobUrl } from "./duplicatePolicy";
import { explicitTitleDomain, juniorScope } from "./responseEvidence";

export type ResponseExample = {
  kind: string;
  title: string;
  company?: string | null;
  location: string | null;
  link: string | null;
  skills?: string[];
  at?: Date | string | null;
  excludeExact?: boolean;
};

export type PreferenceCandidate = {
  title: string;
  company?: string | null;
  location?: string | null;
  link?: string | null;
  url?: string | null;
  tags?: string[];
};

function normalized(value: string): string {
  return value.toLowerCase().replace(/\bvp\b/g, "vice president").replace(/\bsr\.?\b/g, "senior")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function roleWords(value: string): Set<string> {
  return new Set(normalized(value).split(" ").filter((word) => word && !["of", "the", "and", "for", "at", "in", "a", "an", "to"].includes(word)));
}

function similarity(a: string, b: string): number {
  const first = roleWords(a);
  const second = roleWords(b);
  if (!first.size || !second.size) return 0;
  return [...first].filter((word) => second.has(word)).length / Math.max(first.size, second.size);
}

function listingUrl(value?: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|tracking|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

export function isWorkdayListing(value?: string | null): boolean {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    return ["myworkdayjobs.com", "myworkdaysite.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function knownLocation(value?: string | null): string | null {
  const location = normalized(value ?? "");
  if (!location || /^(remote|hybrid|onsite|anywhere|worldwide|unknown|unspecified|united states|us|usa|canada|north america)$/.test(location)) return null;
  return location;
}

/**
 * Feedback changes preference ranking, never the capability/AI fit score.
 * A single dislike is a modest signal; filtering a pattern requires two
 * independent examples, and a matching positive response prevents that filter.
 */
export function evaluateResponses(
  candidate: PreferenceCandidate,
  examples: ResponseExample[],
  now = Date.now(),
): { adjustment: number; reasons: string[]; suppress: boolean } {
  const url = individualJobUrl(candidate.link ?? candidate.url);
  const location = knownLocation(candidate.location);
  const workday = isWorkdayListing(candidate.link ?? candidate.url);
  const scope = juniorScope(candidate.title);
  const domain = explicitTitleDomain(candidate.title);
  const votes = new Map<string, { positive: number; negative: number; strong: boolean; reason: string }>();
  let repeat = false;

  for (const example of examples) {
    const sameIdentity = compareJobs(
      { title: candidate.title, company: candidate.company ?? "", link: candidate.link ?? candidate.url },
      { title: example.title, company: example.company ?? "", link: example.link },
    ).kind === "duplicate";
    const sameClosedListing = Boolean(url && url === individualJobUrl(example.link));
    if (example.kind === "already_closed" ? sameClosedListing
      : (example.excludeExact || ["applied", "dismissed", "duplicate"].includes(example.kind)) && sameIdentity) {
      repeat = true;
    }
    if (["dismissed", "duplicate", "already_closed"].includes(example.kind)) continue;

    const age = example.at ? Math.max(0, (now - new Date(example.at).getTime()) / 86_400_000) : 0;
    // Old choices gradually lose influence; exact-listing suppression does not.
    const recency = Number.isFinite(age) ? Math.max(0.25, 1 - age / 365) : 0.25;
    const role = similarity(candidate.title, example.title);
    const specificRole = roleWords(candidate.title).size >= 2 && roleWords(example.title).size >= 2;
    let positive = 0;
    let negative = 0;
    let strong = false;
    let reason = "";
    if (["applied", "more_like_this"].includes(example.kind) && role >= 0.5) {
      positive = (example.kind === "applied" ? 8 : 10) * role * recency;
      reason = example.kind === "applied" ? "Similar to jobs you applied for" : "Similar to jobs you liked";
    } else if (example.kind === "not_my_role" && role >= 0.5) {
      negative = 8 * role * recency;
      strong = specificRole && role >= 0.8 && recency >= 0.5;
      reason = "Similar to roles you dismissed as not your role";
    } else if (example.kind === "wrong_location" && location && location === knownLocation(example.location) && role >= 0.5) {
      negative = 8 * role * recency;
      strong = specificRole && role >= 0.8 && recency >= 0.5;
      reason = "Similar to jobs dismissed for their location";
    } else if (example.kind === "too_junior" && scope && scope === juniorScope(example.title) && role >= 0.5) {
      negative = 6 * role * recency;
      // New inferred preferences rank only; they never discard an import.
      reason = `Lower priority: ${scope} scope explicitly named in the title, like jobs you marked Too junior`;
    } else if (example.kind === "wrong_domain" && domain && domain === explicitTitleDomain(example.title) && role >= 0.5) {
      negative = 6 * role * recency;
      reason = `Lower priority: ${domain} explicitly named in the title, like jobs you marked Wrong domain`;
    } else if (example.kind === "workday" && workday) {
      negative = 8 * recency;
      // Explicit ATS visibility settings keep these imports recoverable.
      // Historical Workday feedback still ranks jobs, but must not drop them.
      strong = false;
      reason = "Uses Workday, which you dismissed previously";
    }
    if (!positive && !negative) continue;
    // Mirrors of the same job must not turn one response into many votes.
    const key = example.company
      ? `${normalized(example.title)}|${normalized(example.company)}`
      : listingUrl(example.link) ?? normalized(example.title);
    const prior = votes.get(key);
    if (!prior || positive + negative > prior.positive + prior.negative) {
      votes.set(key, { positive, negative, strong, reason });
    }
  }
  const signals = [...votes.values()];
  const positives = signals.filter((signal) => signal.positive > 0);
  const negatives = signals.filter((signal) => signal.negative > 0);
  const positive = Math.min(12, positives.reduce((sum, signal) => sum + signal.positive, 0));
  const negative = Math.min(20, negatives.reduce((sum, signal) => sum + signal.negative, 0));
  const adjustment = Math.round(Math.max(-20, Math.min(12, positive - negative)));
  const suppress = repeat || (negatives.filter((signal) => signal.strong).length >= 2
    && positives.length === 0 && adjustment <= -12);
  const explanations = new Map<string, number>();
  for (const signal of signals) {
    explanations.set(signal.reason, (explanations.get(signal.reason) ?? 0) + 1);
  }
  return {
    adjustment,
    suppress,
    reasons: [...new Set([
      ...(repeat ? ["Previously applied, dismissed, closed, or reported as a duplicate"] : []),
      ...[...explanations].map(([reason, count]) =>
        `${reason} (${count} independent ${count === 1 ? "response" : "responses"})`),
    ])],
  };
}
