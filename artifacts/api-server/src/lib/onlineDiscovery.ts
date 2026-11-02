import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  jobPostingsTable,
  jobPostingSourcesTable,
  onlineDiscoverySourcesTable,
  userProfilesTable,
  onlineDiscoveryProgressTable,
  type DiscoveryProgress,
  type DiscoveryReport,
} from "@workspace/db";
import { canonicalizeJobUrl, isFuzzyDuplicate, normalizeFuzzy } from "./dedup";
import { logger } from "./logger";
import { fetchJobPageContent, type AvailabilityCheck, type JobPageMetadata } from "./pageScraper";
import { scorePostingBackground } from "./scoringService";
import { fetchArbeitnowJobs, type OnlineJobCandidate } from "./sources/arbeitnow";
import { fetchCustomFeed, validatePublicFeedUrl } from "./sources/customFeed";
import { fetchGoogleSearchResults, isGoogleSearchUrl } from "./sources/googleSearch";
import { fetchHiringCafeJobs, isHiringCafeUrl } from "./sources/hiringCafe";
import { DEFAULT_EMAIL_FILTER_CRITERIA, matchesEmailFilterCriteria, type EmailFilterCriteria } from "./gmailClient";
import { loadResponseHistory } from "./responseHistory";
import { evaluateResponses, type ResponseExample } from "./responseLearning";
import { searchBeyondKnown, pruneRejected } from "./discoverySearch";

const SOURCE = "online";
const MAX_CANDIDATES_PER_RUN = 12;
const MAX_SCREENED_CANDIDATES_PER_RUN = 24;
const activeDiscoveryRuns = new Set<string>();
const ARBEITNOW_URL = "https://www.arbeitnow.com/api/job-board-api";
const NORTH_AMERICA_LOCATION_PATTERN = /\b(?:united states|u\.?\s*s\.?\s*a?\.?|usa|canada|north america|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|ontario|quebec|nova scotia|new brunswick|manitoba|british columbia|prince edward island|saskatchewan|alberta|newfoundland and labrador|toronto|vancouver|montreal|calgary|ottawa|edmonton|winnipeg|quebec city)\b/i;
const NORTH_AMERICA_STATE_CODE_PATTERN = /\b(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;

type Experience = { title?: string; description?: string };
type CompanyFilter = { mode?: "off" | "include" | "exclude"; companies?: string[] };
class SourceClaimConflictError extends Error {}

export class DiscoveryProfileRequiredError extends Error {}

export const ONLINE_SOURCE_CATALOG = [
  { provider: "arbeitnow", name: "Arbeitnow", url: ARBEITNOW_URL },
  {
    provider: "brave-linkedin",
    name: "LinkedIn public jobs (Brave)",
    url: "https://www.google.com/search?q=site%3Alinkedin.com%2Fjobs%2Fview+jobs",
  },
  {
    provider: "brave-workatastartup",
    name: "Work at a Startup public jobs (Brave)",
    url: "https://www.google.com/search?q=site%3Aworkatastartup.com+jobs",
  },
  {
    provider: "brave-jobright",
    name: "Jobright public jobs (Brave)",
    url: "https://www.google.com/search?q=site%3Ajobright.ai%2Fjobs%2Finfo+jobs",
  },
] as const;

export async function ensureDefaultOnlineDiscoverySource(userId: string): Promise<void> {
  const source = ONLINE_SOURCE_CATALOG[0];
  if (!source) return;
  const [profile] = await db.select({
    initialized: userProfilesTable.onlineDiscoverySourcesInitialized,
  }).from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (profile?.initialized) return;

  await db.transaction(async (tx) => {
    await tx.insert(onlineDiscoverySourcesTable).values({
      userId,
      provider: source.provider,
      name: source.name,
      url: source.url,
      kind: "builtin",
    }).onConflictDoNothing();
    await tx.update(userProfilesTable)
      .set({ onlineDiscoverySourcesInitialized: true, updatedAt: new Date() })
      .where(eq(userProfilesTable.userId, userId));
  });
}

export async function getOnlineDiscoverySources(userId: string) {
  await ensureDefaultOnlineDiscoverySource(userId);
  const sources = await db.select()
    .from(onlineDiscoverySourcesTable)
    .where(eq(onlineDiscoverySourcesTable.userId, userId))
    .orderBy(onlineDiscoverySourcesTable.createdAt);
  return { sources, availableSources: ONLINE_SOURCE_CATALOG };
}

export function prepareCustomSourceInput(name: string, url: string) {
  const parsedUrl = validatePublicFeedUrl(url);
  if (isGoogleSearchUrl(parsedUrl.toString())) {
    const query = parsedUrl.searchParams.get("q") ?? "";
    return {
      provider: "brave",
      name: name.trim() || `Web search: ${query.slice(0, 72)}`,
      url: parsedUrl.toString(),
      kind: "search" as const,
    };
  }
  if (isHiringCafeUrl(parsedUrl.toString())) {
    return {
      provider: "hiringcafe",
      name: name.trim() || "HiringCafe",
      url: parsedUrl.toString(),
      kind: "search" as const,
    };
  }
  const hostname = parsedUrl.hostname.replace(/^www\./, "");
  return {
    provider: "custom",
    name: name.trim() || hostname,
    url: parsedUrl.toString(),
    kind: "custom" as const,
  };
}

function sourceSite(provider: string): string | null {
  const site =
    provider === "brave-linkedin"
      ? "linkedin.com/jobs/view"
      : provider === "brave-workatastartup"
        ? "workatastartup.com"
        : provider === "brave-jobright"
          ? "jobright.ai/jobs/info"
          : null;
  return site;
}

/**
 * Build a small rotating set of source/role/location-specific web searches.
 * Location in the search is only a relevance hint: parsed search results must
 * not treat it as verified listing metadata.
 */
export function buildFocusedSearchQueries(
  site: string,
  criteria: DiscoveryCriteria,
  rotation = 0,
  maxQueries = 2,
): string[] {
  const roles = criteria.roleTitles.slice(0, 6).map((value) => value.trim()).filter(Boolean);
  const skills = criteria.skills.slice(0, 6).map((value) => value.trim()).filter(Boolean);
  const terms = (roles.length ? roles : skills).slice(0, 6);
  if (terms.length === 0) return [];
  const locations = criteria.locations.filter((value) => value.trim() && value.trim().toLowerCase() !== "remote").slice(0, 10);
  const combinations = terms.flatMap((term) => (locations.length ? locations : [""]).map((location) => ({ term, location })));
  const start = ((rotation % combinations.length) + combinations.length) % combinations.length;
  const selected: string[] = [];
  for (let offset = 0; offset < combinations.length && selected.length < Math.max(1, Math.min(maxQueries, 3)); offset += 1) {
    const combination = combinations[(start + offset) % combinations.length];
    if (!combination) continue;
    const query = `site:${site} "${combination.term.replace(/"/g, "")}"${combination.location ? ` "${combination.location.replace(/"/g, "")}"` : ""} jobs`;
    selected.push(query);
  }
  return selected;
}

async function fetchConfiguredSource(
  source: typeof onlineDiscoverySourcesTable.$inferSelect,
  criteria: DiscoveryCriteria,
  progress: DiscoveryProgress,
  knownUrls: Set<string>,
  freshness: string,
  report: DiscoveryReport,
  warnings: string[],
): Promise<OnlineJobCandidate[]> {
  const signature = JSON.stringify([source.url, criteria, freshness]);
  const prior = progress.cursors[String(source.id)];
  const run = prior?.signature === signature ? prior.run : 0;
  async function search(queries: string[], provider: string) {
    const result = await searchBeyondKnown(queries, provider, run, freshness, knownUrls, fetchGoogleSearchResults);
    report.searchRequests += result.requests;
    if (result.errors.length) {
      if (!result.candidates.length) throw new Error(result.errors.join("; "));
      warnings.push(`${source.name}: ${result.errors.join("; ")}`);
    }
    progress.cursors[String(source.id)] = { signature, run: run + 1 };
    return result.candidates;
  }
  if (source.kind === "builtin" && source.provider === "arbeitnow") {
    const page = run % 3 + 1;
    const first = await fetchArbeitnowJobs(page);
    const unseen = first.filter(candidate => !knownUrls.has(canonicalizeJobUrl(candidate.url))).length;
    progress.cursors[String(source.id)] = { signature, run: run + 1 };
    if (unseen >= 4) return first;
    try {
      return [...first, ...await fetchArbeitnowJobs(page % 3 + 1)];
    } catch (error) {
      warnings.push(`${source.name}: ${error instanceof Error ? error.message : "Next feed page failed"}`);
      return first;
    }
  }
  const site = source.kind === "builtin" ? sourceSite(source.provider) : null;
  if (site) {
    const queries = buildFocusedSearchQueries(site, criteria, run * 2);
    return search(queries, `brave:${source.id}`);
  }
  if (source.kind === "search" && (source.provider === "brave" || source.provider === "google")) {
    return search([new URL(source.url).searchParams.get("q") ?? ""], `brave:${source.id}`);
  }
  if (source.provider === "hiringcafe" || isHiringCafeUrl(source.url)) {
    try {
      return await fetchHiringCafeJobs(source.url, `hiringcafe:${source.id}`);
    } catch (error) {
      const fallbackQueries = buildFocusedSearchQueries(
        "hiringcafe.com/job",
        criteria,
        run * 2,
      );
      if (fallbackQueries.length === 0) throw error;
      logger.warn(
        { sourceId: source.id, error },
        "HiringCafe direct request failed; falling back to Brave",
      );
      return search(fallbackQueries, `hiringcafe:${source.id}`);
    }
  }
  return fetchCustomFeed(source.url, `custom:${source.id}`);
}

export type DiscoveryCriteria = {
  roleTitles: string[];
  skills: string[];
  locations: string[];
  remotePreferences: string[];
};

export function buildDiscoveryCriteria(profile: {
  experienceHistory?: unknown;
  skills?: string[] | null;
  locationPreferences?: string[] | null;
  remotePreferences?: string[] | null;
}): DiscoveryCriteria {
  const experience = Array.isArray(profile.experienceHistory) ? profile.experienceHistory as Experience[] : [];
  const roleTitles = [...new Set(experience.map((item) => item.title?.trim()).filter((title): title is string => Boolean(title)))].slice(0, 6);
  return {
    roleTitles,
    skills: [...new Set((profile.skills ?? []).map((skill) => skill.trim()).filter(Boolean))].slice(0, 25),
    locations: [...new Set((profile.locationPreferences ?? []).map((location) => location.trim()).filter(Boolean))].slice(0, 10),
    remotePreferences: [...new Set(profile.remotePreferences ?? [])],
  };
}

/**
 * Arbeitnow is a worldwide feed. Keep online discovery focused on the user's
 * requested market instead of importing a remote job with no geographic scope.
 * The feed's location field is the source of truth; for generic remote labels,
 * inspect only the beginning of the description where eligibility is usually
 * stated.
 */
export function isUsOrCanadaCandidate(candidate: OnlineJobCandidate): boolean {
  const location = candidate.location?.trim() ?? "";
  const locationText = location || (candidate.remote ? candidate.description.slice(0, 800) : "");
  if (!locationText) return false;
  return NORTH_AMERICA_LOCATION_PATTERN.test(locationText)
    || NORTH_AMERICA_STATE_CODE_PATTERN.test(locationText);
}

export function blockedKeywordForCandidate(candidate: OnlineJobCandidate, blockedKeywords: string[]): string | null {
  const description = candidate.description.toLowerCase();
  return blockedKeywords.find((keyword) => keyword.trim() && description.includes(keyword.toLowerCase())) ?? null;
}

function onlineSenderText(candidate: OnlineJobCandidate): string {
  // Online listings have no email sender. Include the company, provider, and
  // URL so existing sender/domain filters still work for source domains.
  return `${candidate.company} ${candidate.provider} ${candidate.url}`;
}

export function matchesOnlineEmailCriteria(
  candidate: OnlineJobCandidate,
  criteria: EmailFilterCriteria,
): boolean {
  // Email sender/subject include terms describe alert envelopes, not job fit.
  // Online sources have no sender, and titles such as "Head of Product" need
  // not contain generic alert words such as "job" or "hiring". Reuse only
  // the blocked-body exclusions; profile criteria and source queries handle
  // online inclusion.
  return matchesEmailFilterCriteria(candidate.title, onlineSenderText(candidate), candidate.description, {
    subjectKeywords: [],
    fromAddresses: [],
    bodyKeywords: [],
    blockedBodyKeywords: criteria.blockedBodyKeywords,
  });
}

function normalWords(value: string): Set<string> {
  return new Set(normalizeFuzzy(value).split(" ").filter((word) => word.length > 2));
}

function locationsMatch(candidateLocation: string, wantedLocation: string): boolean {
  const candidate = normalizeFuzzy(candidateLocation);
  const wanted = normalizeFuzzy(wantedLocation);
  if (candidate.includes(wanted) || wanted.includes(candidate)) return true;
  const sanFranciscoArea = /\b(?:san francisco|sf|bay area)\b/;
  return sanFranciscoArea.test(candidate) && sanFranciscoArea.test(wanted);
}

type DiscoveryFeedback = ResponseExample;

function feedbackAdjustment(candidate: OnlineJobCandidate, feedback: DiscoveryFeedback[]): number {
  return evaluateResponses(candidate, feedback).adjustment;
}

function freshnessAdjustment(
  postedAt: Date | null,
  freshnessWindow: string | null | undefined,
  now = Date.now(),
): number {
  if (!postedAt || !freshnessWindow || freshnessWindow === "any_time") return 0;
  const windowDays = freshnessWindow === "past_week" ? 7 : 30;
  const ageDays = (now - postedAt.getTime()) / 86_400_000;
  if (ageDays < 0) return 0;
  // Freshness is a ranking preference, not an eligibility gate. Missing source
  // dates remain untouched rather than being inferred from fetch time.
  return ageDays <= windowDays ? 4 : -Math.min(12, 4 + (ageDays - windowDays) / windowDays * 4);
}

export function compareCandidateRecency(
  a: Pick<OnlineJobCandidate, "postedAt">,
  b: Pick<OnlineJobCandidate, "postedAt">,
): number {
  return (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0);
}

const GENERIC_UNVERIFIED_LOCATION = /^(?:remote|hybrid|onsite|work from home|anywhere|unknown|not specified|not provided|unspecified)$/i;
const EXPLICIT_GLOBAL_REMOTE = /\b(?:worldwide|anywhere in the world|global remote|work from anywhere|all countries)\b/i;

export type CandidateScoreOptions = {
  remoteKnown?: boolean;
  feedback?: DiscoveryFeedback[];
  freshnessWindow?: string | null;
  now?: number;
};

/**
 * Scores using the candidate's current (preferably page-verified) fields.
 * Missing location/work-mode facts reduce relevance but do not disqualify;
 * explicit out-of-market locations and confirmed work-mode mismatches do.
 */
export function scoreCandidateForDiscovery(
  candidate: OnlineJobCandidate,
  criteria: DiscoveryCriteria,
  profile: {
    titleExcludeKeywords?: string[] | null;
    companyFilterSettings?: unknown;
    emailFilterSettings?: EmailFilterCriteria | null;
  },
  options: CandidateScoreOptions = {},
): number | null {
  const rawLocation = candidate.location?.trim() ?? "";
  const genericRemoteLocation = !rawLocation || GENERIC_UNVERIFIED_LOCATION.test(rawLocation);
  const geographicCandidate = genericRemoteLocation ? { ...candidate, location: null } : candidate;
  const hasNorthAmericanEvidence = isUsOrCanadaCandidate(geographicCandidate);

  if (rawLocation && !genericRemoteLocation && !hasNorthAmericanEvidence) return null;
  if (candidate.remote && EXPLICIT_GLOBAL_REMOTE.test(`${rawLocation} ${candidate.description}`)
    && !hasNorthAmericanEvidence) return null;

  const profileLocations = criteria.locations.filter((location) => location.toLowerCase() !== "remote");
  if (!candidate.remote && rawLocation && !genericRemoteLocation && profileLocations.length > 0
    && !profileLocations.some((wanted) => locationsMatch(rawLocation, wanted))) return null;

  const remoteKnown = options.remoteKnown ?? candidate.remote;
  const workModes = criteria.remotePreferences.map((preference) => preference.toLowerCase());
  if (remoteKnown && workModes.length > 0) {
    if (candidate.remote && !workModes.includes("remote")) return null;
    if (!candidate.remote && !workModes.some((mode) => mode === "onsite" || mode === "hybrid")) return null;
  }

  const baseScore = rankCandidate(candidate, criteria, profile, true);
  if (baseScore === null) return null;
  const unknownLocationPenalty = !hasNorthAmericanEvidence ? 5 : 0;
  const unknownWorkModePenalty = workModes.length > 0 && !remoteKnown ? 3 : 0;
  return baseScore
    - unknownLocationPenalty
    - unknownWorkModePenalty
    + feedbackAdjustment(candidate, options.feedback ?? [])
    + freshnessAdjustment(candidate.postedAt, options.freshnessWindow, options.now);
}

export function rankCandidate(candidate: OnlineJobCandidate, criteria: DiscoveryCriteria, profile: {
  titleExcludeKeywords?: string[] | null;
  companyFilterSettings?: unknown;
  emailFilterSettings?: EmailFilterCriteria | null;
}, allowMissingListingMetadata = false): number | null {
  if (!allowMissingListingMetadata && !isUsOrCanadaCandidate(candidate)) return null;
  if (profile.emailFilterSettings && !matchesOnlineEmailCriteria(candidate, profile.emailFilterSettings)) return null;

  const title = candidate.title.toLowerCase();
  const company = candidate.company.toLowerCase();
  const excluded = profile.titleExcludeKeywords ?? [];
  if (excluded.some((term) => term.trim() && title.includes(term.trim().toLowerCase()))) return null;

  const companyFilter = (profile.companyFilterSettings as CompanyFilter | null) ?? { mode: "off", companies: [] };
  const listedCompanies = (companyFilter.companies ?? []).map((entry) => entry.toLowerCase()).filter(Boolean);
  const companyMatches = listedCompanies.some((entry) => company.includes(entry) || entry.includes(company));
  if ((companyFilter.mode === "exclude" && companyMatches) || (companyFilter.mode === "include" && listedCompanies.length > 0 && !companyMatches)) return null;

  const workModes = criteria.remotePreferences.map((preference) => preference.toLowerCase());
  if (workModes.length > 0 && !allowMissingListingMetadata) {
    if (candidate.remote && !workModes.includes("remote")) return null;
    // Arbeitnow supplies only a remote flag. Treat non-remote roles as eligible
    // only when the profile explicitly accepts onsite or hybrid work.
    if (!candidate.remote && !workModes.some((mode) => mode === "onsite" || mode === "hybrid")) return null;
  }
  if (!candidate.remote && criteria.locations.length > 0 && !allowMissingListingMetadata) {
    if (!candidate.location) return null;
    if (!criteria.locations.some((wanted) => wanted.toLowerCase() !== "remote" && locationsMatch(candidate.location ?? "", wanted))) return null;
  }

  const titleWords = normalWords(candidate.title);
  const candidateText = `${candidate.title} ${candidate.description} ${candidate.tags.join(" ")}`.toLowerCase();
  const roleHits = criteria.roleTitles.reduce((count, role) => {
    const words = [...normalWords(role)];
    return count + (words.length > 0 && words.filter((word) => titleWords.has(word)).length / words.length >= 0.5 ? 1 : 0);
  }, 0);
  const skillHits = criteria.skills.filter((skill) => candidateText.includes(skill.toLowerCase())).length;
  if (roleHits === 0 && skillHits === 0) return null;
  return Math.min(100, roleHits * 30 + skillHits * 9 + (candidate.remote ? 4 : 0));
}

function nextRunAt(lastRunAt: Date | null, scheduleHours: number | null): Date | null {
  return lastRunAt && scheduleHours ? new Date(lastRunAt.getTime() + scheduleHours * 3_600_000) : null;
}

export function toDiscoveryStatus(profile: typeof userProfilesTable.$inferSelect | undefined, report?: DiscoveryReport) {
  const criteria = buildDiscoveryCriteria(profile ?? {});
  return {
    source: SOURCE,
    scheduleHours: profile?.onlineDiscoveryScheduleHours ?? null,
    minimumMatchScore: profile?.onlineDiscoveryMinMatchScore ?? 12,
    freshnessWindow: profile?.onlineDiscoveryFreshnessWindow ?? "any_time",
    lastRunAt: profile?.lastOnlineDiscoveryAt ?? null,
    nextRunAt: nextRunAt(profile?.lastOnlineDiscoveryAt ?? null, profile?.onlineDiscoveryScheduleHours ?? null),
    lastFound: profile?.lastOnlineDiscoveryFound ?? 0,
    lastImported: profile?.lastOnlineDiscoveryImported ?? 0,
    lastDuplicates: profile?.lastOnlineDiscoveryDuplicates ?? 0,
    lastError: profile?.lastOnlineDiscoveryError ?? null,
    criteria,
    report,
  };
}

async function attachSource(userId: string, postingId: number, candidate: OnlineJobCandidate): Promise<void> {
  const canonicalUrl = canonicalizeJobUrl(candidate.url);
  await db.insert(jobPostingSourcesTable).values({
    userId,
    jobPostingId: postingId,
    provider: candidate.provider,
    sourceJobId: candidate.sourceJobId,
    url: candidate.url,
    canonicalUrl,
    isPrimary: false,
  }).onConflictDoUpdate({
    target: [jobPostingSourcesTable.userId, jobPostingSourcesTable.canonicalUrl],
    set: { lastSeenAt: new Date(), url: candidate.url, sourceJobId: candidate.sourceJobId },
  });
}

export async function runOnlineDiscovery(userId: string) {
  if (activeDiscoveryRuns.has(userId)) throw new Error("Online discovery is already running.");
  activeDiscoveryRuns.add(userId);

  try {
    const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    const criteria = buildDiscoveryCriteria(profile ?? {});
    if (criteria.roleTitles.length === 0 && criteria.skills.length === 0) {
      throw new DiscoveryProfileRequiredError("Add work experience or skills to your profile before discovering online jobs.");
    }

    const configuredSources = await getOnlineDiscoverySources(userId);
    const activeSources = configuredSources.sources.filter((source) => !source.isSuppressed);
    const [sourceRows, postingRows, feedbackRows, progressRows] = await Promise.all([
      db.select().from(jobPostingSourcesTable).where(eq(jobPostingSourcesTable.userId, userId)),
      db.select({ id: jobPostingsTable.id, link: jobPostingsTable.link }).from(jobPostingsTable).where(eq(jobPostingsTable.userId, userId)),
      loadResponseHistory(userId),
      db.select().from(onlineDiscoveryProgressTable).where(eq(onlineDiscoveryProgressTable.userId, userId)),
    ]);
    const progress: DiscoveryProgress = progressRows[0]?.state ?? { cursors: {}, rejected: {} };
    const sourceByUrl = new Map(sourceRows.map((row) => [row.canonicalUrl, row.jobPostingId]));
    const sourceById = new Map(sourceRows.filter((row) => row.sourceJobId).map((row) => [`${row.provider}:${row.sourceJobId}`, row.jobPostingId]));
    const postingByUrl = new Map(postingRows.filter((row): row is { id: number; link: string } => Boolean(row.link)).map((row) => [canonicalizeJobUrl(row.link), row.id]));
    const knownUrls = new Set([...sourceByUrl.keys(), ...postingByUrl.keys()]);
    const report: DiscoveryReport = { retrieved: 0, alreadySaved: 0, repeated: 0, excluded: 0, recentlyChecked: 0, deferred: 0, imported: 0, pageChecks: 0, unverified: 0, sourceFailures: 0, searchRequests: 0 };
    const context = createHash("sha256").update(JSON.stringify([
      criteria, profile?.titleExcludeKeywords, profile?.companyFilterSettings,
      profile?.emailFilterSettings, profile?.onlineDiscoveryMinMatchScore,
      profile?.onlineDiscoveryFreshnessWindow, feedbackRows,
    ])).digest("hex");
    progress.rejected = pruneRejected(progress.rejected, context);
    for (const url of Object.keys(progress.rejected)) knownUrls.add(url);
    const searchWarnings: string[] = [];
    const sourceFetches = await Promise.allSettled(activeSources.map((source) =>
      fetchConfiguredSource(source, criteria, progress, knownUrls, profile?.onlineDiscoveryFreshnessWindow ?? "any_time", report, searchWarnings)));
    const sourceErrors = sourceFetches.flatMap((result, index) => {
      if (result.status === "fulfilled") return [];
      return [`${activeSources[index]?.name ?? "Unknown source"}: ${result.reason instanceof Error ? result.reason.message : "request failed"}`];
    });
    const feed = sourceFetches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (activeSources.length > 0 && feed.length === 0 && sourceErrors.length === activeSources.length) {
      throw new Error(`All online job sources failed. ${sourceErrors.join(" ")}`);
    }
    sourceErrors.push(...searchWarnings);

    report.retrieved = feed.length;
    report.sourceFailures = sourceErrors.length;
    let duplicates = 0;
    let matchedExisting = 0;
    const seenFeed = new Set<string>();
    const freshFeed: OnlineJobCandidate[] = [];
    for (const candidate of feed) {
      const url = canonicalizeJobUrl(candidate.url);
      if (seenFeed.has(url)) { report.repeated++; duplicates++; continue; }
      seenFeed.add(url);
      const existing = sourceByUrl.get(url) ?? postingByUrl.get(url)
        ?? (candidate.sourceJobId ? sourceById.get(`${candidate.provider}:${candidate.sourceJobId}`) : undefined);
      if (existing) {
        await attachSource(userId, existing, candidate);
        report.alreadySaved++; duplicates++; matchedExisting++;
      } else if (progress.rejected[url]) {
        report.recentlyChecked++;
      } else {
        freshFeed.push(candidate);
      }
    }
    const minimum = profile?.onlineDiscoveryMinMatchScore ?? 12;
    const emailFilterSettings = profile?.emailFilterSettings ?? DEFAULT_EMAIL_FILTER_CRITERIA;
    const flaggedClosedUrls = new Set(feedbackRows
      .filter((feedback) => feedback.kind === "already_closed" && feedback.link)
      .map((feedback) => canonicalizeJobUrl(feedback.link as string)));
    const candidates = freshFeed
      .map((candidate) => ({
        candidate,
        preliminaryScore: scoreCandidateForDiscovery(
          candidate,
          criteria,
          {
            ...(profile ?? {}),
            // Page JSON-LD may correct these search-snippet fields; apply such
            // hard profile filters only after the bounded page-screening pass.
            titleExcludeKeywords: [],
            companyFilterSettings: { mode: "off", companies: [] },
            emailFilterSettings,
          },
          {
            remoteKnown: candidate.remote || candidate.provider === "arbeitnow",
            feedback: feedbackRows,
            freshnessWindow: profile?.onlineDiscoveryFreshnessWindow,
          },
        ),
      }))
      .filter((entry): entry is { candidate: OnlineJobCandidate; preliminaryScore: number } =>
        entry.preliminaryScore !== null
        && !flaggedClosedUrls.has(canonicalizeJobUrl(entry.candidate.url)))
      .sort((a, b) => b.preliminaryScore - a.preliminaryScore
        || compareCandidateRecency(a.candidate, b.candidate));

    report.excluded += freshFeed.length - candidates.length;
    let imported = 0;
    let screened = 0;
    let visited = 0;
    const seenScreenedUrls = new Set<string>();
    const screenedShortlist: Array<{
      candidate: OnlineJobCandidate;
      score: number;
      availability: AvailabilityCheck;
      metadata: JobPageMetadata | null;
      canonicalUrl: string;
    }> = [];
    const availabilityChecks: Array<{
      provider: string;
      url: string;
      status: AvailabilityCheck["status"];
      checkedAt: Date;
      reason: string;
      confidence: number;
      evidence: string[];
      sourcePostedAt: Date | null;
      listingMetadata: { title?: string; company?: string; location?: string; remote?: boolean } | null;
      fieldEvidence: JobPageMetadata["fieldEvidence"];
    }> = [];

    for (const { candidate } of candidates) {
      if (screened >= MAX_SCREENED_CANDIDATES_PER_RUN) break;
      visited++;

      // Keep the inexpensive URL/provider duplicate check before page fetches.
      const initialCanonicalUrl = canonicalizeJobUrl(candidate.url);
      const knownId = sourceByUrl.get(initialCanonicalUrl)
        ?? postingByUrl.get(initialCanonicalUrl)
        ?? (candidate.sourceJobId ? sourceById.get(`${candidate.provider}:${candidate.sourceJobId}`) : undefined);
      if (knownId) {
        await attachSource(userId, knownId, candidate);
        duplicates++;
        matchedExisting++;
        report.alreadySaved++;
        continue;
      }

      // The same new URL may arrive from multiple configured sources. It must
      // not consume the bounded page budget more than once.
      if (seenScreenedUrls.has(initialCanonicalUrl)) {
        duplicates++;
        report.repeated++;
        continue;
      }
      seenScreenedUrls.add(initialCanonicalUrl);
      screened++;
      const pageResult = await fetchJobPageContent(candidate.url);
      const availability = pageResult?.availability ?? {
        status: "unverified" as const,
        checkedAt: new Date(),
        reason: "page_fetch_failed",
        confidence: 0,
        evidence: [],
      };
      const metadata = pageResult?.metadata ?? null;
      if (availability.status === "unverified") report.unverified++;
      function reject() {
        report.excluded++;
        // Never cache a network failure or an unreadable page as a mismatch.
        if (pageResult?.metadata?.title) {
          progress.rejected[initialCanonicalUrl] = { context, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
        }
      }
      const screenedCandidate: OnlineJobCandidate = pageResult
        ? {
            ...candidate,
            url: pageResult.finalUrl,
            description: pageResult.contentUsable ? pageResult.content : candidate.description,
            title: metadata?.title ?? candidate.title,
            company: metadata?.company ?? candidate.company,
            location: metadata?.location ?? candidate.location,
            remote: metadata?.remote ?? candidate.remote,
            postedAt: metadata?.sourcePostedAt ?? candidate.postedAt,
          }
        : candidate;
      const canonicalUrl = canonicalizeJobUrl(screenedCandidate.url);
      availabilityChecks.push({
        provider: candidate.provider,
        url: screenedCandidate.url,
        status: availability.status,
        checkedAt: availability.checkedAt,
        reason: availability.reason,
        confidence: availability.confidence,
        evidence: availability.evidence,
        sourcePostedAt: metadata?.sourcePostedAt ?? candidate.postedAt,
        listingMetadata: metadata ? {
          title: metadata.title,
          company: metadata.company,
          location: metadata.location,
          remote: metadata.remote,
        } : null,
        fieldEvidence: metadata?.fieldEvidence ?? {},
      });
      if (availability.status === "closed") {
        reject();
        logger.info(
          { userId, title: screenedCandidate.title, company: screenedCandidate.company, availability },
          "online discovery skipped confirmed-closed listing",
        );
        continue;
      }
      // Also reject an alias whose final URL was previously reported closed.
      if (flaggedClosedUrls.has(canonicalUrl)) {
        reject();
        logger.info({ userId, url: screenedCandidate.url }, "online discovery skipped URL previously marked closed");
        continue;
      }

      const redirectedExistingId = sourceByUrl.get(canonicalUrl)
        ?? postingByUrl.get(canonicalUrl)
        ?? (candidate.sourceJobId ? sourceById.get(`${candidate.provider}:${candidate.sourceJobId}`) : undefined);
      if (redirectedExistingId) {
        await attachSource(userId, redirectedExistingId, screenedCandidate);
        duplicates++;
        matchedExisting++;
        report.alreadySaved++;
        continue;
      }

      const blockedKeyword = blockedKeywordForCandidate(screenedCandidate, emailFilterSettings.blockedBodyKeywords ?? []);
      if (blockedKeyword || !matchesOnlineEmailCriteria(screenedCandidate, emailFilterSettings)) { reject(); continue; }
      const remoteKnown = Boolean(metadata?.fieldEvidence.remote)
        || candidate.remote
        || candidate.provider === "arbeitnow";
      const score = scoreCandidateForDiscovery(
        screenedCandidate,
        criteria,
        { ...(profile ?? {}), emailFilterSettings },
        {
          remoteKnown,
          feedback: feedbackRows,
          freshnessWindow: profile?.onlineDiscoveryFreshnessWindow,
        },
      );
      const preference = evaluateResponses(screenedCandidate, feedbackRows);
      if (preference.suppress) {
        reject();
        logger.info({ userId, reasons: preference.reasons }, "online discovery skipped listing based on job responses");
        continue;
      }
      const baseMatchScore = scoreCandidateForDiscovery(
        screenedCandidate,
        criteria,
        { ...(profile ?? {}), emailFilterSettings },
        { remoteKnown },
      );
      const matchScore = baseMatchScore === null ? null : baseMatchScore + preference.adjustment;
      // One dislike changes ranking only. A pattern is filtered only by the
      // repeated-evidence rule above; positive examples may improve eligibility.
      if (score === null || baseMatchScore === null || baseMatchScore + Math.max(0, preference.adjustment) < minimum) {
        reject();
        logger.info(
          { userId, title: screenedCandidate.title, company: screenedCandidate.company, score, matchScore, minimum },
          "online discovery skipped listing below final match threshold",
        );
        continue;
      }
      screenedShortlist.push({ candidate: screenedCandidate, score, availability, metadata, canonicalUrl });
    }

    report.deferred += candidates.length - visited;
    screenedShortlist.sort((a, b) => b.score - a.score
      || compareCandidateRecency(a.candidate, b.candidate));
    for (const { candidate: screenedCandidate, availability, metadata, canonicalUrl } of screenedShortlist) {
      const preference = evaluateResponses(screenedCandidate, feedbackRows);
      if (imported >= MAX_CANDIDATES_PER_RUN) { report.deferred++; continue; }

      let existingId = sourceByUrl.get(canonicalUrl)
        ?? postingByUrl.get(canonicalUrl)
        ?? (screenedCandidate.sourceJobId
          ? sourceById.get(`${screenedCandidate.provider}:${screenedCandidate.sourceJobId}`)
          : undefined);
      if (!existingId) {
        const fuzzy = await isFuzzyDuplicate(userId, screenedCandidate.title, screenedCandidate.company);
        existingId = fuzzy.matchedId;
      }
      if (existingId) {
        await attachSource(userId, existingId, screenedCandidate);
        duplicates++;
        matchedExisting++;
        report.alreadySaved++;
        continue;
      }

      let posting: typeof jobPostingsTable.$inferSelect;
      try {
        posting = await db.transaction(async (tx) => {
          const [created] = await tx.insert(jobPostingsTable).values({
            userId,
              title: screenedCandidate.title,
              company: screenedCandidate.company,
              link: screenedCandidate.url,
              fullDescription: screenedCandidate.description || `${screenedCandidate.title} at ${screenedCandidate.company}`,
              extractedSkills: screenedCandidate.tags,
              source: screenedCandidate.provider,
              sourcePostedAt: screenedCandidate.postedAt,
              location: screenedCandidate.location,
              remoteType: screenedCandidate.remote ? "remote" : "unknown",
              availabilityStatus: availability.status,
              availabilityCheckedAt: availability.checkedAt,
              availabilityReason: availability.reason,
              availabilityConfidence: availability.confidence,
              availabilityEvidence: availability.evidence,
              fieldEvidence: {
                title: { source: screenedCandidate.provider.startsWith("brave:") ? "search_result" : "source_feed", confidence: 0.6 },
                company: { source: screenedCandidate.provider.startsWith("brave:") ? "search_result_or_url" : "source_feed", confidence: 0.4 },
                ...(screenedCandidate.location ? { location: { source: "source_feed", confidence: 0.8 } } : {}),
                ...(screenedCandidate.postedAt ? { sourcePostedAt: { source: "source_feed", confidence: 0.8 } } : {}),
                ...metadata?.fieldEvidence,
              },
              preferenceAdjustment: preference.adjustment,
              preferenceReasons: preference.reasons,
          }).returning();
          const claimed = await tx.insert(jobPostingSourcesTable).values({
            userId,
            jobPostingId: created.id,
              provider: screenedCandidate.provider,
              sourceJobId: screenedCandidate.sourceJobId,
              url: screenedCandidate.url,
            canonicalUrl,
            isPrimary: true,
          }).onConflictDoNothing().returning({ id: jobPostingSourcesTable.id });
          if (claimed.length === 0) throw new SourceClaimConflictError();
          return created;
        });
      } catch (error) {
        if (!(error instanceof SourceClaimConflictError)) throw error;
        const [winner] = await db.select({ jobPostingId: jobPostingSourcesTable.jobPostingId })
          .from(jobPostingSourcesTable)
          .where(and(eq(jobPostingSourcesTable.userId, userId), eq(jobPostingSourcesTable.canonicalUrl, canonicalUrl)));
        if (!winner) throw error;
        sourceByUrl.set(canonicalUrl, winner.jobPostingId);
        if (screenedCandidate.sourceJobId) sourceById.set(`${screenedCandidate.provider}:${screenedCandidate.sourceJobId}`, winner.jobPostingId);
        duplicates++;
        matchedExisting++;
        report.alreadySaved++;
        continue;
      }
      scorePostingBackground(posting.id, userId);
      sourceByUrl.set(canonicalUrl, posting.id);
      if (screenedCandidate.sourceJobId) sourceById.set(`${screenedCandidate.provider}:${screenedCandidate.sourceJobId}`, posting.id);
      imported++;
    }

    const now = new Date();
    report.imported = imported;
    report.pageChecks = screened;
    progress.rejected = pruneRejected(progress.rejected, context);
    progress.lastReport = report;
    await db.insert(onlineDiscoveryProgressTable).values({ userId, state: progress })
      .onConflictDoUpdate({ target: onlineDiscoveryProgressTable.userId, set: { state: progress, updatedAt: now } });
    const [updatedProfile] = await db.update(userProfilesTable).set({
      lastOnlineDiscoveryAt: now,
      lastOnlineDiscoveryFound: candidates.length,
      lastOnlineDiscoveryImported: imported,
      lastOnlineDiscoveryDuplicates: duplicates,
      lastOnlineDiscoveryError: sourceErrors.length > 0 ? `Some sources failed: ${sourceErrors.join(" ")}` : null,
      updatedAt: now,
    }).where(eq(userProfilesTable.userId, userId)).returning();

    logger.info({
      userId,
      sourceCount: activeSources.length,
      failedSourceCount: sourceErrors.length,
      fetched: feed.length,
      matched: candidates.length,
      screened,
      imported,
      duplicates,
      sourceErrors,
    }, "online discovery completed");
    return {
      ...toDiscoveryStatus(updatedProfile, report),
      fetched: feed.length,
      considered: screened,
      imported,
      duplicates,
      matchedExisting,
      availabilityChecks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Online discovery failed.";
    // Record the attempt even when it fails so scheduled discovery keeps the
    // cadence chosen by the user rather than retrying a provider outage each minute.
    await db.update(userProfilesTable).set({
      lastOnlineDiscoveryAt: new Date(),
      lastOnlineDiscoveryError: message,
      updatedAt: new Date(),
    }).where(eq(userProfilesTable.userId, userId));
    throw error;
  } finally {
    activeDiscoveryRuns.delete(userId);
  }
}

export function startOnlineDiscoveryScheduler(): void {
  const poll = async () => {
    const profiles = await db.select().from(userProfilesTable);
    const now = Date.now();
    for (const profile of profiles) {
      const hours = profile.onlineDiscoveryScheduleHours;
      if (!hours || hours <= 0 || activeDiscoveryRuns.has(profile.userId)) continue;
      if (profile.lastOnlineDiscoveryAt && now < profile.lastOnlineDiscoveryAt.getTime() + hours * 3_600_000) continue;
      runOnlineDiscovery(profile.userId).catch((error) => logger.warn({ userId: profile.userId, error }, "scheduled online discovery failed"));
    }
  };
  setTimeout(() => poll().catch((error) => logger.warn({ error }, "online discovery scheduler failed")), 15_000);
  setInterval(() => poll().catch((error) => logger.warn({ error }, "online discovery scheduler failed")), 60_000);
}