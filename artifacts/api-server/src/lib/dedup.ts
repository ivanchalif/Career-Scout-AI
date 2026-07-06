import { sql, and, eq, inArray } from "drizzle-orm";
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
      AND closed_at IS NULL
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
 * Uses tiered thresholds so that same-company near-duplicates are caught even
 * when the wording differs slightly:
 *   Standard path  — title > 0.70 AND company > 0.60 (original behaviour)
 *   Same-co path   — title > 0.50 AND company > 0.85 (catches role variants at
 *                    the same company, e.g. "Director PM" vs "Director PM – AI"
 *                    when the company name is essentially identical)
 *
 * Both conditions only match against applied or deleted rows so that active
 * duplicates of *other* active postings are never silently removed here
 * (that is handled by sweepDuplicatesOf).
 *
 * Runs as a single SQL query instead of N+1 isFuzzyDuplicate calls.
 *
 * Returns the count of postings removed.
 */
export async function runDedupSweep(userId: string): Promise<number> {
  // Pre-compute normalised strings in CTEs so similarity() is evaluated on
  // the small pre-filtered sets rather than the full O(total²) cross-product.
  // Simple normalisation (lowercase + strip non-alphanum) is used here because:
  //   a) it is computed once per row, not once per pair
  //   b) it is adequate for the advisory sweep (full normalisation including
  //      abbreviation expansion is still used by isFuzzyDuplicate at import time)
  const simpleNorm = "btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g'))";
  const simpleNormCo = "btrim(regexp_replace(regexp_replace(lower(company), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g'))";

  const rows = await db.execute(sql`
    WITH active AS (
      SELECT id,
        ${sql.raw(simpleNorm)} AS ntitle,
        ${sql.raw(simpleNormCo)} AS ncompany
      FROM job_postings
      WHERE user_id = ${userId}
        AND deleted_at IS NULL AND closed_at IS NULL AND applied_at IS NULL
    ),
    already_actioned AS (
      SELECT id,
        ${sql.raw(simpleNorm)} AS ntitle,
        ${sql.raw(simpleNormCo)} AS ncompany
      FROM job_postings
      WHERE user_id = ${userId}
        AND closed_at IS NULL
        AND (deleted_at IS NOT NULL OR applied_at IS NOT NULL)
    )
    SELECT DISTINCT a.id
    FROM active a, already_actioned p
    WHERE (
      (similarity(a.ntitle, p.ntitle) > 0.70 AND similarity(a.ncompany, p.ncompany) > 0.60)
      OR
      (similarity(a.ntitle, p.ntitle) > 0.50 AND similarity(a.ncompany, p.ncompany) > 0.85)
    )
  `);

  const toDelete = (rows.rows as { id: number }[]).map((r) => r.id);

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
 * Uses the same tiered thresholds as runDedupSweep:
 *   Standard  — title > 0.70 AND company > 0.60
 *   Same-co   — title > 0.50 AND company > 0.85
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

  const rows = await db.execute(sql`
    SELECT id
    FROM job_postings
    WHERE user_id = ${userId}
      AND id != ${excludeId}
      AND deleted_at IS NULL
      AND closed_at IS NULL
      AND applied_at IS NULL
      AND (
        (
          similarity(
            btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')),
            ${normTitle}
          ) > 0.70
          AND similarity(
            btrim(regexp_replace(regexp_replace(lower(company), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')),
            ${normCompany}
          ) > 0.60
        ) OR (
          similarity(
            btrim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')),
            ${normTitle}
          ) > 0.50
          AND similarity(
            btrim(regexp_replace(regexp_replace(lower(company), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g')),
            ${normCompany}
          ) > 0.85
        )
      )
  `);

  if (rows.rows.length === 0) return 0;

  const ids = (rows.rows as { id: number }[]).map((r) => r.id);

  await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), fullDescription: "" })
    .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, ids)));

  return ids.length;
}
