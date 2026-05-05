import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export function normalizeFuzzy(text: string): string {
  return text
    .toLowerCase()
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

/**
 * Applies the same normalization as normalizeFuzzy() but inside PostgreSQL.
 *
 * Steps (matching normalizeFuzzy order):
 *   1. lowercase
 *   2. strip common company suffixes using ARE word-boundary tokens (\m / \M)
 *   3. replace remaining non-alphanumeric chars (incl. paren content) with spaces
 *   4. collapse runs of spaces to a single space
 *   5. trim
 *
 * Note: '\(' in PostgreSQL ARE is a capturing-group opener, not a literal paren.
 * That's why we strip suffixes BEFORE the non-alphanumeric sweep rather than
 * using a paren-aware regex.
 */
function dbNormalize(col: string): string {
  return `btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(${col}), '${SUFFIX_REGEX}', ' ', 'g'),
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

  const titleNorm = dbNormalize("title");
  const companyNorm = dbNormalize("company");

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
