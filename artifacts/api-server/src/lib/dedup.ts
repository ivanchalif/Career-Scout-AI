import { sql, and, eq, inArray, isNull } from "drizzle-orm";
import { db, jobPostingsTable } from "@workspace/db";

// Common job-title abbreviations expanded before similarity comparison so that
// e.g. "Director AI Product Mgmt" matches "Director AI Product Management".
const JOB_TITLE_ABBREVIATIONS: [RegExp, string][] = [
  [/\bmgmt\b/gi, "management"],
  [/\bmgr\b/gi, "manager"],
  [/\bsvp\b/gi, "senior vice president"],
  [/\bevp\b/gi, "executive vice president"],
  [/\bvp\b/gi, "vice president"],
  [/\bdir\b/gi, "director"],
  [/\bsr\b/gi, "senior"],
  [/\bjr\b/gi, "junior"],
  [/\basst\b/gi, "assistant"],
  [/\bengg?\b/gi, "engineering"],
];

export function normalizeFuzzy(text: string): string {
  let s = text.toLowerCase();
  for (const [pattern, replacement] of JOB_TITLE_ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }
  return s
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(
      /\b(inc|llc|ltd|corp|co|gmbh|ag|plc|sa|technologies|technology|tech|solutions|group|holdings|services)\.?\b/gi,
      " ",
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Suffix list kept in sync with normalizeFuzzy() above so DB-side normalization
// produces the same output as the JS function.
const SUFFIX_REGEX =
  "\\m(inc|llc|ltd|corp|co|gmbh|ag|plc|sa|technologies|technology|tech|solutions|group|holdings|services)\\M";

// Job-title abbreviation expansions mirrored in SQL so stored titles are also
// expanded (handles the case where the stored title has the abbreviation).
const SQL_ABBREV_REPLACEMENTS: [string, string][] = [
  ["\\mmgmt\\M", "management"],
  ["\\mmgr\\M", "manager"],
  ["\\msvp\\M", "senior vice president"],
  ["\\mevp\\M", "executive vice president"],
  ["\\mvp\\M", "vice president"],
  ["\\mdir\\M", "director"],
  ["\\msr\\M", "senior"],
  ["\\mjr\\M", "junior"],
  ["\\masst\\M", "assistant"],
  ["\\mengg?\\M", "engineering"],
];

/**
 * Applies the same normalization as normalizeFuzzy() but inside PostgreSQL.
 *
 * Steps (matching normalizeFuzzy order):
 *   1. lowercase
 *   2. expand common job-title abbreviations (mgmt→management, etc.)
 *   3. strip common company suffixes using ARE word-boundary tokens (\m / \M)
 *   4. replace remaining non-alphanumeric chars with spaces
 *   5. collapse runs of spaces to a single space
 *   6. trim
 */
export function dbNormalizeSql(col: string): string {
  // Build nested regexp_replace calls for each abbreviation expansion
  let expr = `lower(${col})`;
  for (const [pattern, replacement] of SQL_ABBREV_REPLACEMENTS) {
    expr = `regexp_replace(${expr}, '${pattern}', '${replacement}', 'g')`;
  }
  return `btrim(regexp_replace(
      regexp_replace(
        regexp_replace(${expr}, '${SUFFIX_REGEX}', ' ', 'g'),
        '[^a-z0-9 ]', ' ', 'g'
      ),
      ' +', ' ', 'g'
    ))`;
}

/**
 * Returns true when a posting with a very similar (title, company) pair already
 * exists for this user — regardless of source (Gmail, IMAP, manual, etc.).
 *
 * Thresholds:
 *   title   > 0.70  (slightly looser to catch minor wording diffs)
 *   company > 0.60  (catches suffix/abbrev variants e.g. "Google LLC" vs "Google")
 *
 * Both must match simultaneously to flag a duplicate.
 *
 * All row states are included — active, applied, and soft-deleted — so that
 * previously applied or dismissed postings are never re-imported.
 * `wasDeleted` / `wasApplied` in the return value let callers log the reason.
 * Preference order: active-unapplied > applied > deleted.
 */
export async function isFuzzyDuplicate(
  userId: string,
  title: string,
  company: string,
  options?: {
    /** Exclude this posting ID from the match (used by dedup sweep to avoid self-match). */
    excludeId?: number;
    /** When true, only match against deleted or applied rows (ignores active duplicates). */
    deletedOrAppliedOnly?: boolean;
  },
): Promise<{
  isDuplicate: boolean;
  matchedTitle?: string;
  matchedCompany?: string;
  wasDeleted?: boolean;
  wasApplied?: boolean;
}> {
  const normTitle = normalizeFuzzy(title);
  const normCompany = normalizeFuzzy(company);

  if (!normTitle || !normCompany) return { isDuplicate: false };

  const titleNorm = dbNormalizeSql("title");
  const companyNorm = dbNormalizeSql("company");

  const excludeClause = options?.excludeId != null
    ? sql`AND id != ${options.excludeId}`
    : sql``;
  const stateClause = options?.deletedOrAppliedOnly
    ? sql`AND (deleted_at IS NOT NULL OR applied_at IS NOT NULL)`
    : sql``;

  const rows = await db.execute(sql`
    SELECT id, title, company, deleted_at, applied_at
    FROM job_postings
    WHERE user_id = ${userId}
      AND similarity(
        ${sql.raw(titleNorm)},
        ${normTitle}
      ) > 0.70
      AND similarity(
        ${sql.raw(companyNorm)},
        ${normCompany}
      ) > 0.60
      ${excludeClause}
      ${stateClause}
    ORDER BY
      deleted_at IS NOT NULL,   -- active rows first
      applied_at IS NOT NULL    -- unapplied before applied
    LIMIT 1
  `);

  if (rows.rows.length > 0) {
    const match = rows.rows[0] as {
      title: string;
      company: string;
      deleted_at: string | null;
      applied_at: string | null;
    };
    return {
      isDuplicate: true,
      matchedTitle: match.title,
      matchedCompany: match.company,
      wasDeleted: match.deleted_at !== null,
      wasApplied: match.applied_at !== null,
    };
  }
  return { isDuplicate: false };
}

/**
 * Sweeps all active postings for `userId` and soft-deletes any that fuzzy-match
 * a posting the user has already deleted or applied to.
 *
 * This is the shared implementation used by both the manual "dedup-sweep" HTTP
 * endpoint and the background Gmail scheduler so that duplicates introduced by
 * scheduled syncs are also cleaned up automatically.
 *
 * Returns the count of postings removed.
 */
export async function runDedupSweep(userId: string): Promise<number> {
  const activePostings = await db
    .select({ id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company })
    .from(jobPostingsTable)
    .where(and(
      eq(jobPostingsTable.userId, userId),
      isNull(jobPostingsTable.deletedAt),
      isNull(jobPostingsTable.appliedAt),
    ));

  const toDelete: number[] = [];

  for (const posting of activePostings) {
    const { isDuplicate, wasDeleted, wasApplied } = await isFuzzyDuplicate(
      userId, posting.title, posting.company,
      { excludeId: posting.id, deletedOrAppliedOnly: true },
    );
    if (isDuplicate && (wasDeleted || wasApplied)) {
      toDelete.push(posting.id);
    }
  }

  if (toDelete.length > 0) {
    await db
      .update(jobPostingsTable)
      .set({ deletedAt: new Date(), fullDescription: "" })
      .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, toDelete)));
  }

  return toDelete.length;
}

/**
 * Finds all active (non-deleted, non-applied) postings for `userId` that
 * fuzzy-match `title` + `company`, excludes the posting that was just actioned
 * (`excludeId`), and soft-deletes them in bulk.
 *
 * Intended to be called in the background after a posting is deleted or marked
 * applied so that near-duplicate active cards disappear automatically.
 *
 * Returns the count of postings removed.
 */
export async function sweepDuplicatesOf(
  userId: string,
  title: string,
  company: string,
  excludeId: number,
): Promise<number> {
  const normTitle = normalizeFuzzy(title);
  const normCompany = normalizeFuzzy(company);

  if (!normTitle || !normCompany) return 0;

  const titleNorm = dbNormalizeSql("title");
  const companyNorm = dbNormalizeSql("company");

  const rows = await db.execute(sql`
    SELECT id
    FROM job_postings
    WHERE user_id = ${userId}
      AND id != ${excludeId}
      AND deleted_at IS NULL
      AND applied_at IS NULL
      AND similarity(
        ${sql.raw(titleNorm)},
        ${normTitle}
      ) > 0.70
      AND similarity(
        ${sql.raw(companyNorm)},
        ${normCompany}
      ) > 0.60
  `);

  if (rows.rows.length === 0) return 0;

  const ids = (rows.rows as { id: number }[]).map((r) => r.id);

  await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), fullDescription: "" })
    .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, ids)));

  return ids.length;
}
