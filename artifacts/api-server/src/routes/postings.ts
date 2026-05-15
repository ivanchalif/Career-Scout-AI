import { Router, type IRouter } from "express";
import { sql, eq, and, ilike, or, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import { db, jobPostingsTable, matchReportsTable, userProfilesTable, gmailConnectionsTable } from "@workspace/db";
import {
  CreatePostingBody,
  GetPostingParams,
  DeletePostingParams,
  AnalyzePostingParams,
  MarkAppliedParams,
  ListPostingsQueryParams,
  GetPostingResponse,
  ListPostingsResponse,
  AnalyzePostingResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { scorePosting, scorePostingBackground, extractJobListings } from "../lib/scoringService";
import { fetchSingleEmail } from "../lib/gmailClient";
import { isFuzzyDuplicate, sweepDuplicatesOf, runDedupSweep, dbNormalizeSql } from "../lib/dedup";
import { logger } from "../lib/logger";
import { fetchJobPageContent } from "../lib/pageScraper";

const router: IRouter = Router();

async function getPostingWithReport(postingId: number, userId: string) {
  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, postingId), eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)));

  if (!posting) return null;

  const [report] = await db
    .select()
    .from(matchReportsTable)
    .where(and(eq(matchReportsTable.jobPostingId, postingId), eq(matchReportsTable.userId, userId)));

  return { posting, report: report ?? null };
}

router.get("/postings", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const queryParsed = ListPostingsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  const { search, minFitScore, source, applied } = queryParsed.data;

  const [userProfile] = await db
    .select({ companyFilterSettings: userProfilesTable.companyFilterSettings })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const companyFilter = userProfile?.companyFilterSettings ?? { mode: "off" as const, companies: [] };

  const conditions: ReturnType<typeof eq>[] = [
    eq(jobPostingsTable.userId, userId),
    isNull(jobPostingsTable.deletedAt),
  ];

  if (source) {
    conditions.push(eq(jobPostingsTable.source, source));
  }

  if (applied === true) {
    conditions.push(isNotNull(jobPostingsTable.appliedAt));
  } else if (applied === false) {
    conditions.push(isNull(jobPostingsTable.appliedAt));
  }

  const postings = await db
    .select()
    .from(jobPostingsTable)
    .where(and(...conditions))
    .orderBy(jobPostingsTable.createdAt);

  const filtered = postings.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.company.toLowerCase().includes(q)) return false;
    }
    if (companyFilter.mode !== "off" && companyFilter.companies.length > 0) {
      const company = p.company.toLowerCase();
      const matches = companyFilter.companies.some((c: string) => {
        const entry = c.toLowerCase();
        return company.includes(entry) || entry.includes(company);
      });
      if (companyFilter.mode === "include" && !matches) return false;
      if (companyFilter.mode === "exclude" && matches) return false;
    }
    return true;
  });

  const results = await Promise.all(
    filtered.map(async (posting) => {
      const [report] = await db
        .select()
        .from(matchReportsTable)
        .where(and(eq(matchReportsTable.jobPostingId, posting.id), eq(matchReportsTable.userId, userId)));
      return { posting, report: report ?? null };
    }),
  );

  const scoreFiltered = minFitScore != null
    ? results.filter((r) => r.report?.fitScore != null && r.report.fitScore >= (minFitScore as number))
    : results;

  const sorted = scoreFiltered.sort((a, b) => {
    const sa = a.report?.fitScore ?? -1;
    const sb = b.report?.fitScore ?? -1;
    return sb - sa;
  });

  res.json(ListPostingsResponse.parse(sorted));
});

router.post("/postings", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const parsed = CreatePostingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [posting] = await db
    .insert(jobPostingsTable)
    .values({
      ...parsed.data,
      userId,
      extractedSkills: parsed.data.extractedSkills ?? [],
      source: parsed.data.source ?? "manual",
    })
    .returning();

  res.status(201).json(posting);

  scorePostingBackground(posting.id, userId);
});

router.get("/postings/deleted", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const postings = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, userId), isNotNull(jobPostingsTable.deletedAt)))
    .orderBy(jobPostingsTable.deletedAt);

  const results = await Promise.all(
    postings.map(async (posting) => {
      const [report] = await db
        .select()
        .from(matchReportsTable)
        .where(and(eq(matchReportsTable.jobPostingId, posting.id), eq(matchReportsTable.userId, userId)));
      return { posting, report: report ?? null };
    }),
  );

  res.json(ListPostingsResponse.parse(results));
});

// Returns pairs of active postings whose normalised titles are similar enough
// to be possible duplicates but below the auto-dedup threshold (0.45–0.69).
router.get("/postings/near-duplicates", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const aTitleNorm = dbNormalizeSql("a.title");
  const bTitleNorm = dbNormalizeSql("b.title");
  const aCompanyNorm = dbNormalizeSql("a.company");
  const bCompanyNorm = dbNormalizeSql("b.company");

  // Use sql.raw with inlined userId (Clerk IDs are always alphanumeric+underscore — no injection risk).
  // Avoids Drizzle template-literal issues when both sides of similarity() are raw SQL expressions.
  const safeId = userId.replace(/[^a-zA-Z0-9_]/g, "");
  const querySql = `
    SELECT a.id AS id1, b.id AS id2,
           a.title AS title1, b.title AS title2,
           a.company AS company1, b.company AS company2,
           similarity(${aTitleNorm}, ${bTitleNorm}) AS title_sim
    FROM job_postings a
    JOIN job_postings b ON a.id < b.id
    WHERE a.user_id = '${safeId}'
      AND b.user_id = '${safeId}'
      AND a.deleted_at IS NULL AND b.deleted_at IS NULL
      AND a.applied_at IS NULL AND b.applied_at IS NULL
      AND similarity(${aTitleNorm}, ${bTitleNorm}) BETWEEN 0.45 AND 0.69
      AND similarity(${aCompanyNorm}, ${bCompanyNorm}) > 0.35
    ORDER BY title_sim DESC
    LIMIT 40
  `;

  const rows = await db.execute(sql.raw(querySql));
  res.json(rows.rows);
});

router.patch("/postings/:id/restore", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({ deletedAt: null })
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId), isNotNull(jobPostingsTable.deletedAt)))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.json({ id: posting.id });
});

router.get("/postings/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = GetPostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const result = await getPostingWithReport(params.data.id, userId);
  if (!result) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.json(GetPostingResponse.parse(result));
});

router.delete("/postings/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), fullDescription: "" })
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.sendStatus(204);

  sweepDuplicatesOf(userId, posting.title, posting.company, posting.id).then((removed) => {
    if (removed > 0) logger.info({ userId, postingId: posting.id, removed }, "auto-dedup: removed duplicates after delete");
  }).catch((err) => {
    logger.warn({ userId, postingId: posting.id, err }, "auto-dedup: sweep failed after delete");
  });
});

router.patch("/postings/:id/applied", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = MarkAppliedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ appliedAt: jobPostingsTable.appliedAt })
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  const newAppliedAt = existing.appliedAt ? null : new Date();

  const [updated] = await db
    .update(jobPostingsTable)
    .set({ appliedAt: newAppliedAt })
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId)))
    .returning();

  res.json({ id: updated.id, appliedAt: updated.appliedAt });

  if (newAppliedAt !== null) {
    sweepDuplicatesOf(userId, updated.title, updated.company, updated.id).then((removed) => {
      if (removed > 0) logger.info({ userId, postingId: updated.id, removed }, "auto-dedup: removed duplicates after apply");
    }).catch((err) => {
      logger.warn({ userId, postingId: updated.id, err }, "auto-dedup: sweep failed after apply");
    });
  }
});

router.post("/postings/rescore-all", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const { rescoreAllPostings } = await import("../lib/scoringService");
  rescoreAllPostings(userId, { forceParse: true }).catch(() => {});
  res.json({ queued: true });
});

router.post("/postings/dedup-sweep", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const removed = await runDedupSweep(userId);
  if (removed > 0) {
    logger.info({ userId, removed }, "dedup-sweep: removed duplicate postings");
  }
  res.json({ removed });
});

router.post("/postings/backfill-links", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (!conn) {
    res.status(400).json({ error: "Gmail account not connected" });
    return;
  }

  // Known tracking-URL patterns that should be resolved to their final destination.
  const TRACKING_PATTERNS = [
    "%lensa.com%",
    "%sg3email%",
    "%ls/click%",
    "%jobgether%",
  ];

  // Phase 1: postings with no link at all — re-extract URL from the email body.
  const nullLinkPostings = await db
    .select({ id: jobPostingsTable.id, gmailMessageId: jobPostingsTable.gmailMessageId, title: jobPostingsTable.title, company: jobPostingsTable.company, link: jobPostingsTable.link })
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, userId), eq(jobPostingsTable.source, "gmail"), isNull(jobPostingsTable.link)));

  // Phase 2: postings whose stored link is a known tracking URL — resolve via HTTP.
  const trackingLinkPostings = await db
    .select({ id: jobPostingsTable.id, gmailMessageId: jobPostingsTable.gmailMessageId, title: jobPostingsTable.title, company: jobPostingsTable.company, link: jobPostingsTable.link })
    .from(jobPostingsTable)
    .where(and(
      eq(jobPostingsTable.userId, userId),
      eq(jobPostingsTable.source, "gmail"),
      isNotNull(jobPostingsTable.link),
      or(...TRACKING_PATTERNS.map((p) => ilike(jobPostingsTable.link!, p))),
    ));

  if (nullLinkPostings.length === 0 && trackingLinkPostings.length === 0) {
    res.json({ updated: 0, skipped: 0 });
    return;
  }

  let updated = 0;
  let skipped = 0;

  // Phase 1 — re-extract URL from email body for null-link postings
  if (nullLinkPostings.length > 0) {
    const byBaseId = new Map<string, typeof nullLinkPostings>();
    for (const p of nullLinkPostings) {
      if (!p.gmailMessageId) continue;
      const baseId = p.gmailMessageId.split(":")[0];
      if (!byBaseId.has(baseId)) byBaseId.set(baseId, []);
      byBaseId.get(baseId)!.push(p);
    }

    for (const [baseId, group] of byBaseId.entries()) {
      try {
        const email = await fetchSingleEmail(conn.accessToken, conn.refreshToken, baseId);
        if (!email || !email.body.trim()) {
          skipped += group.length;
          continue;
        }

        const listings = await extractJobListings(email.body, email.subject, email.sender);

        for (const posting of group) {
          const idx = Number(posting.gmailMessageId!.split(":")[1] ?? "0");
          const listing = listings[idx];
          const jobUrl = listing?.url;

          if (!jobUrl) {
            skipped++;
            logger.debug({ postingId: posting.id, idx }, "backfill-links: no URL found for listing");
            continue;
          }

          // Try to resolve tracking URL to its final destination.
          const pageResult = await fetchJobPageContent(jobUrl);
          const resolvedUrl = pageResult ? pageResult.finalUrl : jobUrl;

          await db
            .update(jobPostingsTable)
            .set({ link: resolvedUrl })
            .where(and(eq(jobPostingsTable.id, posting.id), eq(jobPostingsTable.userId, userId)));

          logger.info({ postingId: posting.id, jobUrl, resolvedUrl }, "backfill-links: updated link from email");
          updated++;
        }
      } catch (err) {
        logger.warn({ baseId, err }, "backfill-links: failed to process email");
        skipped += group.length;
      }
    }
  }

  // Phase 2 — resolve tracking URLs to their final destination via HTTP redirect-follow
  for (const posting of trackingLinkPostings) {
    try {
      const trackingUrl = posting.link!;
      const pageResult = await fetchJobPageContent(trackingUrl);
      if (!pageResult) {
        logger.info({ postingId: posting.id, trackingUrl }, "backfill-links: could not resolve tracking URL (network error), skipping");
        skipped++;
        continue;
      }

      const resolvedUrl = pageResult.finalUrl;
      if (resolvedUrl === trackingUrl) {
        // URL didn't change — likely blocked or returned the same tracking URL.
        // Clear the link so it's not shown as a broken tracking URL.
        logger.info({ postingId: posting.id, trackingUrl }, "backfill-links: tracking URL unresolvable, clearing link");
        await db
          .update(jobPostingsTable)
          .set({ link: null })
          .where(and(eq(jobPostingsTable.id, posting.id), eq(jobPostingsTable.userId, userId)));
        updated++;
      } else {
        logger.info({ postingId: posting.id, trackingUrl, resolvedUrl }, "backfill-links: resolved tracking URL");
        await db
          .update(jobPostingsTable)
          .set({ link: resolvedUrl })
          .where(and(eq(jobPostingsTable.id, posting.id), eq(jobPostingsTable.userId, userId)));
        updated++;
      }
    } catch (err) {
      logger.warn({ postingId: posting.id, err }, "backfill-links: failed to resolve tracking URL");
      skipped++;
    }
  }

  res.json({ updated, skipped });
});

// Soft-deletes a posting the user has confirmed is a duplicate, then sweeps
// for any remaining siblings in the background (same as delete but intent is
// recorded in server logs for future threshold tuning).
router.post("/postings/:id/flag-duplicate", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch regardless of deletion state so we can be idempotent
  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.userId, userId)));

  if (!posting) {
    logger.warn({ userId, postingId: id }, "flag-duplicate: posting not found for this user");
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Idempotent — if already deleted, just return success
  if (posting.deletedAt) {
    res.status(204).end();
    return;
  }

  await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), fullDescription: "" })
    .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.userId, userId)));

  logger.info(
    { userId, postingId: id, title: posting.title, company: posting.company },
    "postings: user flagged posting as duplicate",
  );

  sweepDuplicatesOf(userId, posting.title, posting.company, id).catch((err) => {
    logger.warn({ err, id }, "flag-duplicate: background sweep failed");
  });

  res.status(204).end();
});

router.post("/postings/:id/analyze", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = AnalyzePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)));

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  try {
    const { report } = await scorePosting(posting.id, userId, { forceParse: true });
    res.json(AnalyzePostingResponse.parse(report));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scoring failed";
    res.status(500).json({ error: message });
  }
});

export default router;
