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

/**
 * Returns true when a posting with a very similar (title, company) pair already
 * exists for this user — regardless of source (Gmail, IMAP, manual, etc.).
 *
 * Thresholds:
 *   title   > 0.70  (slightly looser to catch minor wording diffs)
 *   company > 0.60  (catches suffix/abbrev variants)
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

  const rows = await db.execute(sql`
    SELECT id, title, company, deleted_at, applied_at
    FROM job_postings
    WHERE user_id = ${userId}
      AND similarity(
        regexp_replace(lower(title), '[^a-z0-9 ]', ' ', 'g'),
        ${normTitle}
      ) > 0.70
      AND similarity(
        regexp_replace(
          regexp_replace(lower(company), '\s*\([^)]*\)', ' ', 'g'),
          '[^a-z0-9 ]', ' ', 'g'
        ),
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
