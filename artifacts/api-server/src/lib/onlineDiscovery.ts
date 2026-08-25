import { and, eq } from "drizzle-orm";
import { db, jobPostingsTable, jobPostingSourcesTable, userProfilesTable } from "@workspace/db";
import { canonicalizeJobUrl, isFuzzyDuplicate, normalizeFuzzy } from "./dedup";
import { logger } from "./logger";
import { fetchJobPageContent } from "./pageScraper";
import { scorePostingBackground } from "./scoringService";
import { fetchArbeitnowJobs, type OnlineJobCandidate } from "./sources/arbeitnow";
import { DEFAULT_EMAIL_FILTER_CRITERIA, matchesEmailFilterCriteria, type EmailFilterCriteria } from "./gmailClient";

const SOURCE = "arbeitnow";
const MAX_CANDIDATES_PER_RUN = 12;
const activeDiscoveryRuns = new Set<string>();
const NORTH_AMERICA_LOCATION_PATTERN = /\b(?:united states|u\.?\s*s\.?\s*a?\.?|usa|canada|north america|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|ontario|quebec|nova scotia|new brunswick|manitoba|british columbia|prince edward island|saskatchewan|alberta|newfoundland and labrador|toronto|vancouver|montreal|calgary|ottawa|edmonton|winnipeg|quebec city)\b/i;
const NORTH_AMERICA_STATE_CODE_PATTERN = /\b(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;

type Experience = { title?: string; description?: string };
type CompanyFilter = { mode?: "off" | "include" | "exclude"; companies?: string[] };
class SourceClaimConflictError extends Error {}

export class DiscoveryProfileRequiredError extends Error {}

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
  return matchesEmailFilterCriteria(
    candidate.title,
    onlineSenderText(candidate),
    candidate.description,
    criteria,
  );
}

function normalWords(value: string): Set<string> {
  return new Set(normalizeFuzzy(value).split(" ").filter((word) => word.length > 2));
}

export function rankCandidate(candidate: OnlineJobCandidate, criteria: DiscoveryCriteria, profile: {
  titleExcludeKeywords?: string[] | null;
  companyFilterSettings?: unknown;
  emailFilterSettings?: EmailFilterCriteria | null;
}): number | null {
  if (!isUsOrCanadaCandidate(candidate)) return null;
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
  if (workModes.length > 0) {
    if (candidate.remote && !workModes.includes("remote")) return null;
    // Arbeitnow supplies only a remote flag. Treat non-remote roles as eligible
    // only when the profile explicitly accepts onsite or hybrid work.
    if (!candidate.remote && !workModes.some((mode) => mode === "onsite" || mode === "hybrid")) return null;
  }
  if (!candidate.remote && criteria.locations.length > 0) {
    if (!candidate.location) return null;
    const location = candidate.location.toLowerCase();
    if (!criteria.locations.some((wanted) => location.includes(wanted.toLowerCase()) || wanted.toLowerCase().includes(location))) return null;
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

export function toDiscoveryStatus(profile: typeof userProfilesTable.$inferSelect | undefined) {
  const criteria = buildDiscoveryCriteria(profile ?? {});
  return {
    source: SOURCE,
    scheduleHours: profile?.onlineDiscoveryScheduleHours ?? null,
    minimumMatchScore: profile?.onlineDiscoveryMinMatchScore ?? 12,
    lastRunAt: profile?.lastOnlineDiscoveryAt ?? null,
    nextRunAt: nextRunAt(profile?.lastOnlineDiscoveryAt ?? null, profile?.onlineDiscoveryScheduleHours ?? null),
    lastFound: profile?.lastOnlineDiscoveryFound ?? 0,
    lastImported: profile?.lastOnlineDiscoveryImported ?? 0,
    lastDuplicates: profile?.lastOnlineDiscoveryDuplicates ?? 0,
    lastError: profile?.lastOnlineDiscoveryError ?? null,
    criteria,
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

    const [feed, sourceRows, postingRows] = await Promise.all([
      fetchArbeitnowJobs(),
      db.select().from(jobPostingSourcesTable).where(eq(jobPostingSourcesTable.userId, userId)),
      db.select({ id: jobPostingsTable.id, link: jobPostingsTable.link }).from(jobPostingsTable).where(eq(jobPostingsTable.userId, userId)),
    ]);
    const minimum = profile?.onlineDiscoveryMinMatchScore ?? 12;
    const emailFilterSettings = profile?.emailFilterSettings ?? DEFAULT_EMAIL_FILTER_CRITERIA;
    const candidates = feed
      .map((candidate) => ({
        candidate,
        score: rankCandidate(candidate, criteria, { ...(profile ?? {}), emailFilterSettings }),
      }))
      .filter((entry): entry is { candidate: OnlineJobCandidate; score: number } => entry.score !== null && entry.score >= minimum)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES_PER_RUN);

    const sourceByUrl = new Map(sourceRows.map((row) => [row.canonicalUrl, row.jobPostingId]));
    const sourceById = new Map(sourceRows.filter((row) => row.sourceJobId).map((row) => [`${row.provider}:${row.sourceJobId}`, row.jobPostingId]));
    const postingByUrl = new Map(postingRows.filter((row): row is { id: number; link: string } => Boolean(row.link)).map((row) => [canonicalizeJobUrl(row.link), row.id]));
    let imported = 0;
    let duplicates = 0;
    let matchedExisting = 0;

    for (const { candidate } of candidates) {
      let screenedCandidate = candidate;
      const pageResult = await fetchJobPageContent(candidate.url);
      if (pageResult) {
        screenedCandidate = {
          ...candidate,
          url: pageResult.finalUrl,
          description: pageResult.contentUsable ? pageResult.content : candidate.description,
        };
      }

      const blockedKeyword = blockedKeywordForCandidate(screenedCandidate, emailFilterSettings.blockedBodyKeywords ?? []);
      if (blockedKeyword) {
        logger.info(
          { userId, title: candidate.title, company: candidate.company, blockedKeyword },
          "online discovery skipped listing with blocked keyword",
        );
        continue;
      }
      if (!matchesOnlineEmailCriteria(screenedCandidate, emailFilterSettings)) {
        logger.info(
          { userId, title: candidate.title, company: candidate.company },
          "online discovery skipped listing that did not match email filter criteria",
        );
        continue;
      }

      const canonicalUrl = canonicalizeJobUrl(screenedCandidate.url);
      let existingId = sourceByUrl.get(canonicalUrl) ?? postingByUrl.get(canonicalUrl) ?? (candidate.sourceJobId ? sourceById.get(`${candidate.provider}:${candidate.sourceJobId}`) : undefined);
      if (!existingId) {
        const fuzzy = await isFuzzyDuplicate(userId, screenedCandidate.title, screenedCandidate.company);
        existingId = fuzzy.matchedId;
      }
      if (existingId) {
        await attachSource(userId, existingId, screenedCandidate);
        duplicates++;
        matchedExisting++;
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
            source: SOURCE,
              sourcePostedAt: screenedCandidate.postedAt,
              location: screenedCandidate.location,
              remoteType: screenedCandidate.remote ? "remote" : "unknown",
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
        continue;
      }
      scorePostingBackground(posting.id, userId);
      sourceByUrl.set(canonicalUrl, posting.id);
      if (screenedCandidate.sourceJobId) sourceById.set(`${screenedCandidate.provider}:${screenedCandidate.sourceJobId}`, posting.id);
      imported++;
    }

    const now = new Date();
    const [updatedProfile] = await db.update(userProfilesTable).set({
      lastOnlineDiscoveryAt: now,
      lastOnlineDiscoveryFound: candidates.length,
      lastOnlineDiscoveryImported: imported,
      lastOnlineDiscoveryDuplicates: duplicates,
      lastOnlineDiscoveryError: null,
      updatedAt: now,
    }).where(eq(userProfilesTable.userId, userId)).returning();

    logger.info({ userId, fetched: feed.length, considered: candidates.length, imported, duplicates }, "online discovery completed");
    return { ...toDiscoveryStatus(updatedProfile), fetched: feed.length, considered: candidates.length, imported, duplicates, matchedExisting };
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