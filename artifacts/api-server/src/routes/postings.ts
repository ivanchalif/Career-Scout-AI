import { Router, type IRouter } from "express";
import { sql, eq, and, ilike, or, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  matchReportsTable,
  jobPostingFeedbackTable,
  userProfilesTable,
  gmailConnectionsTable,
  onlineDiscoverySourcesTable,
} from "@workspace/db";
import {
  CreatePostingBody,
  GetPostingParams,
  DeletePostingParams,
  AnalyzePostingParams,
  ListPostingsQueryParams,
  GetPostingResponse,
  ListPostingsResponse,
  GetPostingPageResponse,
  AnalyzePostingResponse,
  SetPostingFeedbackParams,
  SetPostingFeedbackBody,
  SetPostingFeedbackResponse,
  UndoPostingFeedbackParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { scorePosting, scorePostingBackground, extractJobListings } from "../lib/scoringService";
import { fetchSingleEmail } from "../lib/gmailClient";
import { isFuzzyDuplicate, runDedupSweep, loadDuplicateExceptions, previewConfirmedDuplicates } from "../lib/dedup";
import { compareJobs } from "../lib/duplicatePolicy";
import { findDuplicateReviews } from "../lib/duplicateReview";
import { jobDuplicateExceptionsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { fetchJobPageContent } from "../lib/pageScraper";
import { isConfirmedClosedAvailability, missingJobFields } from "../lib/jobLinkHealth";
import { buildDiscoveryCriteria, rankCandidate } from "../lib/onlineDiscovery";
import multer from "multer";
import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { getPostingPage, listPostingPage } from "../lib/postingList";

const router: IRouter = Router();
const ONLINE_POSTING_SOURCE_PATTERN = /^(?:arbeitnow|brave|google|hiringcafe|custom)(?::\d+)?$/;

type DiscoveryScoreProfile = {
  experienceHistory?: unknown;
  skills?: string[] | null;
  locationPreferences?: string[] | null;
  remotePreferences?: string[] | null;
  titleExcludeKeywords?: string[] | null;
  companyFilterSettings?: unknown;
  emailFilterSettings?: {
    subjectKeywords: string[];
    fromAddresses: string[];
    bodyKeywords: string[];
    blockedBodyKeywords: string[];
  } | null;
};

type ScoreStatus = "pending" | "current" | "needs_reanalysis";

function getScoreStatus(
  report: typeof matchReportsTable.$inferSelect | undefined,
  profileUpdatedAt: Date | null | undefined,
): ScoreStatus {
  if (report?.fitScore == null) return "pending";
  return profileUpdatedAt && profileUpdatedAt.getTime() > report.updatedAt.getTime()
    ? "needs_reanalysis"
    : "current";
}

function getOnlineMatchScore(
  posting: typeof jobPostingsTable.$inferSelect,
  profile: DiscoveryScoreProfile | null | undefined,
): number | null {
  if (!profile || !ONLINE_POSTING_SOURCE_PATTERN.test(posting.source)) return null;

  return rankCandidate({
    provider: posting.source,
    sourceJobId: null,
    title: posting.title,
    company: posting.company,
    description: posting.fullDescription,
    url: posting.link ?? "",
    location: posting.location,
    remote: posting.remoteType === "remote",
    tags: posting.extractedSkills,
    postedAt: posting.sourcePostedAt,
  }, buildDiscoveryCriteria(profile), profile);
}

export async function getPostingWithReport(postingId: number, userId: string) {
  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, postingId), eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)));

  if (!posting) return null;

  const [report] = await db
    .select()
    .from(matchReportsTable)
    .where(and(eq(matchReportsTable.jobPostingId, postingId), eq(matchReportsTable.userId, userId)));

  const [feedbackRow] = await db
    .select({ kind: jobPostingFeedbackTable.kind, createdAt: jobPostingFeedbackTable.createdAt })
    .from(jobPostingFeedbackTable)
    .where(and(eq(jobPostingFeedbackTable.jobPostingId, postingId), eq(jobPostingFeedbackTable.userId, userId)));

  const [profile] = await db
    .select({
      updatedAt: userProfilesTable.scoringUpdatedAt,
      experienceHistory: userProfilesTable.experienceHistory,
      skills: userProfilesTable.skills,
      locationPreferences: userProfilesTable.locationPreferences,
      remotePreferences: userProfilesTable.remotePreferences,
      titleExcludeKeywords: userProfilesTable.titleExcludeKeywords,
      companyFilterSettings: userProfilesTable.companyFilterSettings,
      emailFilterSettings: userProfilesTable.emailFilterSettings,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const sources = await db
    .select({ provider: onlineDiscoverySourcesTable.provider, id: onlineDiscoverySourcesTable.id, name: onlineDiscoverySourcesTable.name })
    .from(onlineDiscoverySourcesTable)
    .where(eq(onlineDiscoverySourcesTable.userId, userId));

  const sourceName = sources.find((source) =>
    posting.source === source.provider || posting.source === `${source.provider}:${source.id}`
  )?.name ?? null;

  return {
    posting,
    report: report ?? null,
    scoreStatus: getScoreStatus(report, profile?.updatedAt),
    feedback: feedbackRow ?? null,
    sourceName,
    onlineMatchScore: getOnlineMatchScore(posting, profile),
  };
}

router.get(["/postings", "/postings/page"], requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const queryParsed = ListPostingsQueryParams.safeParse({
    ...req.query,
    applied: req.query.applied === "true" ? true : req.query.applied === "false" ? false : req.query.applied,
    hidden: req.query.hidden === "true" ? true : req.query.hidden === "false" ? false : req.query.hidden,
    archived: req.query.archived === "true" ? true : req.query.archived === "false" ? false : req.query.archived,
    compact: req.query.compact === "true" ? true : req.query.compact === "false" ? false : req.query.compact,
  });
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  if (req.path === "/postings/page") {
    res.json(GetPostingPageResponse.parse(await getPostingPage(userId, {
      ...queryParsed.data, limit: queryParsed.data.limit ?? 25,
    })));
  } else {
    res.json(ListPostingsResponse.parse(await listPostingPage(userId, queryParsed.data)));
  }
});

router.post("/postings", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const parsed = CreatePostingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const duplicate = await isFuzzyDuplicate(userId, parsed.data.title, parsed.data.company, { link: parsed.data.link });
  if (duplicate.isDuplicate) {
    res.status(409).json({ error: "This job already exists in your history (active, applied, or dismissed). Open the existing listing instead of adding another copy.", existingPostingId: duplicate.matchedId });
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
  res.json(ListPostingsResponse.parse(await listPostingPage(req.userId, { archived: true })));
});

// Evidence-based review only. Text resemblance alone cannot hide a job.
router.get("/postings/near-duplicates", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const postings = await db.select({
    id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company,
    link: jobPostingsTable.link, location: jobPostingsTable.location,
    fullDescription: jobPostingsTable.fullDescription, jobIdentity: jobPostingsTable.jobIdentity,
    appliedAt: jobPostingsTable.appliedAt, deletedAt: jobPostingsTable.deletedAt, closedAt: jobPostingsTable.closedAt,
    salaryMin: jobPostingsTable.salaryMin, salaryMax: jobPostingsTable.salaryMax,
    createdAt: jobPostingsTable.createdAt,
  }).from(jobPostingsTable).where(and(
    eq(jobPostingsTable.userId, userId),
  ));
  const exceptions = await loadDuplicateExceptions(userId);
  const results: unknown[] = [];
  for (const { a, b, decision } of await findDuplicateReviews(postings, exceptions)) {
      const row: Record<string, unknown> = { id1: a.id, id2: b.id, evidence: decision.evidence, confidence: decision.kind };
      for (const [posting, suffix] of [[a, "1"], [b, "2"]] as const) {
        Object.assign(row, {
          [`title${suffix}`]: posting.title, [`company${suffix}`]: posting.company,
          [`location${suffix}`]: posting.location, [`url${suffix}`]: posting.link,
          [`applied_at${suffix}`]: posting.appliedAt, [`deleted_at${suffix}`]: posting.deletedAt,
          [`salary_min${suffix}`]: posting.salaryMin, [`salary_max${suffix}`]: posting.salaryMax,
          [`created_at${suffix}`]: posting.createdAt,
        });
      }
      results.push(row);
  }
  res.json(results);
});

router.post("/postings/not-duplicates", requireAuth, async (req, res): Promise<void> => {
  const body = req.body as { postingId?: unknown; otherPostingId?: unknown };
  if (!Number.isSafeInteger(body?.postingId) || !Number.isSafeInteger(body?.otherPostingId)
    || Number(body.postingId) <= 0 || Number(body.otherPostingId) <= 0 || body.postingId === body.otherPostingId) {
    res.status(400).json({ error: "Two different positive posting IDs are required" }); return;
  }
  const ids = [Number(body.postingId), Number(body.otherPostingId)].sort((a, b) => a - b);
  const owned = await db.select({ id: jobPostingsTable.id }).from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, req.userId), inArray(jobPostingsTable.id, ids)));
  if (owned.length !== 2) { res.status(404).json({ error: "Posting not found" }); return; }
  await db.insert(jobDuplicateExceptionsTable).values({
    userId: req.userId, postingIdLow: ids[0], postingIdHigh: ids[1],
  }).onConflictDoNothing();
  res.sendStatus(204);
});

const CSV_COLUMNS = ["title", "company", "link", "location", "remoteType", "salaryMin", "salaryMax", "fitScore", "source", "applied", "dateAdded"] as const;

router.get("/postings/export.csv", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const postings = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)))
    .orderBy(jobPostingsTable.createdAt);

  const postingIds = postings.map((p) => p.id);
  const reports = postingIds.length > 0
    ? await db
        .select()
        .from(matchReportsTable)
        .where(and(eq(matchReportsTable.userId, userId), inArray(matchReportsTable.jobPostingId, postingIds)))
    : [];

  const reportsByPostingId = new Map(reports.map((r) => [r.jobPostingId, r]));

  const rows = postings.map((p) => {
    const report = reportsByPostingId.get(p.id);
    return {
      title: p.title,
      company: p.company,
      link: p.link ?? "",
      location: p.location ?? "",
      remoteType: p.remoteType ?? "",
      salaryMin: p.salaryMin ?? "",
      salaryMax: p.salaryMax ?? "",
      fitScore: report?.fitScore ?? "",
      source: p.source,
      applied: p.appliedAt ? "yes" : "no",
      dateAdded: p.createdAt.toISOString(),
    };
  });

  const csv = stringify(rows, { header: true, columns: CSV_COLUMNS as unknown as string[] });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="career-scout-jobs-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/postings/import", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const userId = req.userId;

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  let records: Record<string, string>[];
  try {
    records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch {
    res.status(400).json({ error: "Failed to parse CSV file" });
    return;
  }

  const existingPostings = await db
    .select({ title: jobPostingsTable.title, company: jobPostingsTable.company, link: jobPostingsTable.link })
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));


  let imported = 0;
  let skipped = 0;
  let invalid = 0;

  for (const record of records) {
    const title = (record["title"] ?? "").trim();
    const company = (record["company"] ?? "").trim();

    if (!title || !company) {
      invalid++;
      continue;
    }

    const link = (record["link"] ?? "").trim() || null;
    const location = (record["location"] ?? "").trim() || null;
    const remoteType = (record["remoteType"] ?? "").trim() || null;
    const salaryMinRaw = parseInt(record["salaryMin"] ?? "", 10);
    const salaryMaxRaw = parseInt(record["salaryMax"] ?? "", 10);
    const salaryMin = isNaN(salaryMinRaw) ? null : salaryMinRaw;
    const salaryMax = isNaN(salaryMaxRaw) ? null : salaryMaxRaw;

    if (existingPostings.some((posting) => compareJobs({ title, company, link }, posting).kind === "duplicate")) {
      skipped++;
      continue;
    }

    const [inserted] = await db
      .insert(jobPostingsTable)
      .values({
        userId,
        title,
        company,
        link,
        location,
        remoteType,
        salaryMin,
        salaryMax,
        source: "csv-import",
        fullDescription: "",
        extractedSkills: [],
        requiredSkills: [],
        niceToHaveSkills: [],
      })
      .returning();

    existingPostings.push({ title, company, link });

    imported++;
    scorePostingBackground(inserted.id, userId);
  }

  logger.info({ userId, imported, skipped, invalid }, "postings: csv import completed");
  res.json({ imported, skipped, invalid });
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
    .where(and(
      eq(jobPostingsTable.id, params.data.id),
      eq(jobPostingsTable.userId, userId),
      isNotNull(jobPostingsTable.deletedAt),
      isNull(jobPostingsTable.dismissalUndoToken),
    ))
    .returning();

  if (!posting) {
    const [current] = await db
      .select({ dismissalUndoToken: jobPostingsTable.dismissalUndoToken })
      .from(jobPostingsTable)
      .where(and(
        eq(jobPostingsTable.id, params.data.id),
        eq(jobPostingsTable.userId, userId),
      ));
    if (current?.dismissalUndoToken) {
      res.status(409).json({ error: "Use undo-dismissal to restore this posting" });
      return;
    }
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.json({ id: posting.id });
});

// Marks a posting as closed (position no longer accepting applications).
// Unlike delete, closed postings do NOT block re-import — the same role can
// reappear if it opens again.
router.post("/postings/:id/close", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({ closedAt: new Date() })
    .where(and(
      eq(jobPostingsTable.id, params.data.id),
      eq(jobPostingsTable.userId, userId),
      isNull(jobPostingsTable.deletedAt),
      isNull(jobPostingsTable.closedAt),
    ))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.sendStatus(204);
});

// Reopens a closed posting, returning it to the active dashboard.
router.patch("/postings/:id/reopen", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({
      closedAt: null,
      availabilityStatus: null,
      availabilityCheckedAt: null,
      availabilityReason: null,
      availabilityConfidence: null,
      availabilityEvidence: null,
    })
    .where(and(
      eq(jobPostingsTable.id, params.data.id),
      eq(jobPostingsTable.userId, userId),
      isNotNull(jobPostingsTable.closedAt),
    ))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.json({ id: posting.id });
});

router.patch("/postings/:id/link", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = z.object({ link: z.string().url().nullable() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid link URL" });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({ link: body.data.link })
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId)))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.json({ id: posting.id, link: posting.link });
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

router.put("/postings/:id/feedback", requireAuth, async (req, res): Promise<void> => {
  const params = SetPostingFeedbackParams.safeParse(req.params);
  const body = SetPostingFeedbackBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [ownedPosting] = await tx
      .select({ id: jobPostingsTable.id, deletedAt: jobPostingsTable.deletedAt })
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, req.userId)))
      .for("update");
    if (!ownedPosting) return { status: 404 as const };
    if (ownedPosting.deletedAt) return { status: 409 as const };

    const [feedback] = await tx
      .insert(jobPostingFeedbackTable)
      .values({
        userId: req.userId,
        jobPostingId: ownedPosting.id,
        kind: body.data.kind,
      })
      .onConflictDoUpdate({
        target: [jobPostingFeedbackTable.userId, jobPostingFeedbackTable.jobPostingId],
        set: { kind: body.data.kind, createdAt: new Date() },
      })
      .returning({ kind: jobPostingFeedbackTable.kind, createdAt: jobPostingFeedbackTable.createdAt });
    return { status: 200 as const, feedback };
  });

  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.status === 404 ? "Posting not found" : "Cannot edit feedback for a dismissed posting",
    });
    return;
  }
  res.json(SetPostingFeedbackResponse.parse(result.feedback));
});

router.delete("/postings/:id/feedback", requireAuth, async (req, res): Promise<void> => {
  const params = UndoPostingFeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [ownedPosting] = await tx
      .select({ id: jobPostingsTable.id, deletedAt: jobPostingsTable.deletedAt })
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, req.userId)))
      .for("update");
    if (!ownedPosting) return 404 as const;
    if (ownedPosting.deletedAt) return 409 as const;

    await tx.delete(jobPostingFeedbackTable).where(and(
      eq(jobPostingFeedbackTable.userId, req.userId),
      eq(jobPostingFeedbackTable.jobPostingId, ownedPosting.id),
    ));
    return 204 as const;
  });
  if (result !== 204) {
    res.status(result).json({
      error: result === 404 ? "Posting not found" : "Cannot edit feedback for a dismissed posting",
    });
    return;
  }
  res.sendStatus(204);
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
    .set({
      deletedAt: new Date(),
      deletedBy: "user",
      dismissalUndoToken: null,
      dismissalPreviousFeedback: null,
    })
    .where(and(
      eq(jobPostingsTable.id, params.data.id),
      eq(jobPostingsTable.userId, userId),
      isNull(jobPostingsTable.deletedAt),
      isNull(jobPostingsTable.dismissalUndoToken),
    ))
    .returning();

  if (!posting) {
    const [current] = await db
      .select({ dismissalUndoToken: jobPostingsTable.dismissalUndoToken })
      .from(jobPostingsTable)
      .where(and(
        eq(jobPostingsTable.id, params.data.id),
        eq(jobPostingsTable.userId, userId),
      ));
    if (current?.dismissalUndoToken) {
      res.status(409).json({ error: "Posting is in a reversible dismissal" });
      return;
    }
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.sendStatus(204);

});

router.patch("/postings/:id/applied", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
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

});

router.post("/postings/rescore-all", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const { rescoreAllPostings } = await import("../lib/scoringService");
  await rescoreAllPostings(userId, { forceParse: true });
  res.json({ queued: true });
});

router.get("/postings/dedup-preview", requireAuth, async (req, res): Promise<void> => {
  const eligibleIds = await previewConfirmedDuplicates(req.userId);
  const ids = eligibleIds.slice(0, 200);
  const jobs = ids.length ? await db.select({ id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company })
    .from(jobPostingsTable).where(and(eq(jobPostingsTable.userId, req.userId), inArray(jobPostingsTable.id, ids))) : [];
  res.json({ ids, total: eligibleIds.length, jobs });
});

router.post("/postings/dedup-sweep", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const selected = req.body?.selectedIds;
  if (!Array.isArray(selected) || selected.length > 200 || !selected.every((id) => Number.isSafeInteger(id) && id > 0)) {
    res.status(400).json({ error: "Preview and select jobs before cleanup" }); return;
  }
  const removed = await runDedupSweep(userId, selected);
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
    "%callings.ai%",
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

        const { listings } = await extractJobListings(email.body, email.subject, email.sender);

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
            .set({ link: resolvedUrl, ...missingJobFields(pageResult) })
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
      if (isConfirmedClosedAvailability(pageResult.availability)) {
        await db.update(jobPostingsTable)
          .set({ link: resolvedUrl, ...missingJobFields(pageResult) })
          .where(and(eq(jobPostingsTable.id, posting.id), eq(jobPostingsTable.userId, userId)));
        updated++;
        continue;
      }
      if (resolvedUrl === trackingUrl) {
        // URL didn't change — resolution was blocked. Keep the original tracking URL
        // so the card remains clickable; the user can still open it manually.
        logger.info({ postingId: posting.id, trackingUrl }, "backfill-links: tracking URL unresolvable, keeping original");
        skipped++;
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

// Soft-deletes only the posting the user has confirmed is a duplicate.
// for any remaining siblings in the background (same as delete but intent is
// recorded in server logs for future threshold tuning).
router.post("/postings/:id/retry-link", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)));

  if (!posting) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (posting.source !== "gmail" || !posting.gmailMessageId) {
    res.status(400).json({ error: "No Gmail message associated with this posting" });
    return;
  }

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (!conn) {
    res.status(400).json({ error: "Gmail account not connected" });
    return;
  }

  try {
    const baseId = posting.gmailMessageId.split(":")[0];
    const email = await fetchSingleEmail(conn.accessToken, conn.refreshToken, baseId);

    if (!email || !email.body.trim()) {
      res.status(422).json({ error: "Could not fetch email" });
      return;
    }

    const { listings } = await extractJobListings(email.body, email.subject, email.sender);
    const idx = Number(posting.gmailMessageId.split(":")[1] ?? "0");
    const listing = listings[idx];
    const jobUrl = listing?.url;

    if (!jobUrl) {
      res.status(422).json({ error: "No URL found in email" });
      return;
    }

    const pageResult = await fetchJobPageContent(jobUrl);
    const resolvedUrl = pageResult ? pageResult.finalUrl : jobUrl;

    await db
      .update(jobPostingsTable)
      .set({ link: resolvedUrl, ...missingJobFields(pageResult) })
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.userId, userId)));

    logger.info({ postingId: id, jobUrl, resolvedUrl }, "retry-link: updated link from email");
    res.json({ link: resolvedUrl });
  } catch (err) {
    logger.warn({ postingId: id, err }, "retry-link: failed");
    res.status(500).json({ error: "Failed to extract link" });
  }
});

router.post("/postings/:id/flag-duplicate", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
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

  if (posting.dismissalUndoToken) {
    res.status(409).json({ error: "Use undo-dismissal to restore this posting" });
    return;
  }

  // Idempotent — if already deleted without a reversible dismissal, just return success
  if (posting.deletedAt) {
    res.status(204).end();
    return;
  }

  const [updated] = await db
    .update(jobPostingsTable)
    .set({
      deletedAt: new Date(),
      deletedBy: "duplicate",
      dismissalUndoToken: null,
      dismissalPreviousFeedback: null,
    })
    .where(and(
      eq(jobPostingsTable.id, id),
      eq(jobPostingsTable.userId, userId),
      isNull(jobPostingsTable.deletedAt),
      isNull(jobPostingsTable.dismissalUndoToken),
    ))
    .returning();

  if (!updated) {
    const [current] = await db
      .select()
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.userId, userId)));
    if (!current) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (current.dismissalUndoToken) {
      res.status(409).json({ error: "Use undo-dismissal to restore this posting" });
      return;
    }
    if (current.deletedAt) {
      res.sendStatus(204);
      return;
    }
    res.status(409).json({ error: "Posting state changed; retry the duplicate action" });
    return;
  }

  logger.info(
    { userId, postingId: id, title: updated.title, company: updated.company },
    "postings: user flagged posting as duplicate",
  );


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
