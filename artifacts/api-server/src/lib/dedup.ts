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
 *   title   > 0.70  (was 0.75 — slightly looser to catch minor wording diffs)
 *   company > 0.60  (was 0.65 — catches suffix/abbrev variants)
 *
 * Both must match simultaneously to flag a duplicate.
 * Soft-deleted rows are excluded so a previously dismissed job can be re-imported
 * if the user later encounters it again.
 */
export async function isFuzzyDuplicate(
  userId: string,
  title: string,
  company: string,
): Promise<{ isDuplicate: boolean; matchedTitle?: string; matchedCompany?: string }> {
  const normTitle = normalizeFuzzy(title);
  const normCompany = normalizeFuzzy(company);

  if (!normTitle || !normCompany) return { isDuplicate: false };

  const rows = await db.execute(sql`
    SELECT id, title, company
    FROM job_postings
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
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
    LIMIT 1
  `);

  if (rows.rows.length > 0) {
    const match = rows.rows[0] as { title: string; company: string };
    return { isDuplicate: true, matchedTitle: match.title, matchedCompany: match.company };
  }
  return { isDuplicate: false };
}
