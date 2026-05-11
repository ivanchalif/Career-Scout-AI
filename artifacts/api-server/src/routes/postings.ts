import { Router, type IRouter } from "express";
import { eq, and, ilike, or, gte, isNotNull, isNull, inArray } from "drizzle-orm";
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
import { isFuzzyDuplicate, sweepDuplicatesOf } from "../lib/dedup";
import { logger } from "../lib/logger";

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
      logger.info(
        { userId, postingId: posting.id, title: posting.title, company: posting.company, wasDeleted, wasApplied },
        "dedup-sweep: soft-deleting active posting that matches a deleted/applied job",
      );
    }
  }

  if (toDelete.length > 0) {
    await db
      .update(jobPostingsTable)
      .set({ deletedAt: new Date(), fullDescription: "" })
      .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, toDelete)));
  }

  res.json({ removed: toDelete.length });
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

  const postings = await db
    .select({ id: jobPostingsTable.id, gmailMessageId: jobPostingsTable.gmailMessageId, title: jobPostingsTable.title, company: jobPostingsTable.company })
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, userId), eq(jobPostingsTable.source, "gmail"), isNull(jobPostingsTable.link)));

  if (postings.length === 0) {
    res.json({ updated: 0, skipped: 0 });
    return;
  }

  // Group by base Gmail message ID to avoid re-fetching the same email multiple times
  const byBaseId = new Map<string, typeof postings>();
  for (const p of postings) {
    if (!p.gmailMessageId) continue;
    const baseId = p.gmailMessageId.split(":")[0];
    if (!byBaseId.has(baseId)) byBaseId.set(baseId, []);
    byBaseId.get(baseId)!.push(p);
  }

  let updated = 0;
  let skipped = 0;

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

        await db
          .update(jobPostingsTable)
          .set({ link: jobUrl })
          .where(and(eq(jobPostingsTable.id, posting.id), eq(jobPostingsTable.userId, userId)));

        logger.info({ postingId: posting.id, jobUrl }, "backfill-links: updated link");
        updated++;
      }
    } catch (err) {
      logger.warn({ baseId, err }, "backfill-links: failed to process email");
      skipped += group.length;
    }
  }

  res.json({ updated, skipped });
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
