import { Router, type IRouter } from "express";
import { sql, eq, and, ilike, or, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  matchReportsTable,
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
  AnalyzePostingResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { scorePosting, scorePostingBackground, extractJobListings } from "../lib/scoringService";
import { fetchSingleEmail } from "../lib/gmailClient";
import { isFuzzyDuplicate, sweepDuplicatesOf, runDedupSweep, dbNormalizeSql } from "../lib/dedup";
import { logger } from "../lib/logger";
import { fetchJobPageContent } from "../lib/pageScraper";
import multer from "multer";
import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse/sync";
import { z } from "zod";

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

  const sources = await db
    .select({ provider: onlineDiscoverySourcesTable.provider, id: onlineDiscoverySourcesTable.id, name: onlineDiscoverySourcesTable.name })
    .from(onlineDiscoverySourcesTable)
    .where(eq(onlineDiscoverySourcesTable.userId, userId));

  const sourceName = sources.find((source) =>
    posting.source === source.provider || posting.source === `${source.provider}:${source.id}`
  )?.name ?? null;

  return { posting, report: report ?? null, sourceName };
}

router.get("/postings", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const queryParsed = ListPostingsQueryParams.safeParse({
    ...req.query,
    applied: req.query.applied === "true" ? true : req.query.applied === "false" ? false : req.query.applied,
    hidden: req.query.hidden === "true" ? true : req.query.hidden === "false" ? false : req.query.hidden,
  });
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  const { search, minFitScore, source, applied, hidden } = queryParsed.data;

  const [userProfile] = await db
    .select({
      companyFilterSettings: userProfilesTable.companyFilterSettings,
      titleExcludeKeywords: userProfilesTable.titleExcludeKeywords,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const companyFilter = userProfile?.companyFilterSettings ?? { mode: "off" as const, companies: [] };
  const titleExcludeKeywords: string[] = userProfile?.titleExcludeKeywords ?? [];

  const conditions: ReturnType<typeof eq>[] = [
    eq(jobPostingsTable.userId, userId),
    isNull(jobPostingsTable.deletedAt),
    isNull(jobPostingsTable.closedAt),
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

  const onlineSources = await db
    .select({ provider: onlineDiscoverySourcesTable.provider, id: onlineDiscoverySourcesTable.id, name: onlineDiscoverySourcesTable.name })
    .from(onlineDiscoverySourcesTable)
    .where(eq(onlineDiscoverySourcesTable.userId, userId));
  const sourceNames = new Map(
    onlineSources.flatMap((source) => [
      [source.provider, source.name] as const,
      [`${source.provider}:${source.id}`, source.name] as const,
    ]),
  );

  type FilterReason = {
    byCompany: boolean;
    companyReason: string | null;
    byTitle: boolean;
    titleReasons: string[];
  };

  const getFilterReason = (p: typeof postings[number]): FilterReason | null => {
    let byCompany = false;
    let companyReason: string | null = null;

    if (companyFilter.mode !== "off" && (companyFilter as { mode: string; companies: string[] }).companies.length > 0) {
      const company = p.company.toLowerCase();
      const companies = (companyFilter as { mode: string; companies: string[] }).companies;
      const matched = companies.find((c: string) => {
        const entry = c.toLowerCase();
        return company.includes(entry) || entry.includes(company);
      });
      if (companyFilter.mode === "include" && !matched) {
        byCompany = true;
        companyReason = "Not in allowlist";
      } else if (companyFilter.mode === "exclude" && matched) {
        byCompany = true;
        companyReason = `Excluded: "${matched}"`;
      }
    }

    const title = p.title.toLowerCase();
    const titleReasons: string[] = titleExcludeKeywords.length > 0
      ? titleExcludeKeywords.filter((kw: string) => title.includes(kw.toLowerCase()))
      : [];
    const byTitle = titleReasons.length > 0;

    if (!byCompany && !byTitle) return null;
    return { byCompany, companyReason, byTitle, titleReasons };
  };

  const filtered = postings.filter((p) => {
    if (hidden) {
      if (!getFilterReason(p)) return false;
    } else {
      if (search) {
        const q = search.toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !p.company.toLowerCase().includes(q)) return false;
      }
      if (getFilterReason(p)) return false;
    }
    return true;
  });

  const results = await Promise.all(
    filtered.map(async (posting) => {
      const [report] = await db
        .select()
        .from(matchReportsTable)
        .where(and(eq(matchReportsTable.jobPostingId, posting.id), eq(matchReportsTable.userId, userId)));
      const filterReason = hidden ? (getFilterReason(posting) ?? undefined) : undefined;
      return {
        posting,
        report: report ?? null,
        sourceName: sourceNames.get(posting.source) ?? null,
        ...(filterReason !== undefined ? { filterReason } : {}),
      };
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
    .where(and(
      eq(jobPostingsTable.userId, userId),
      or(isNotNull(jobPostingsTable.deletedAt), isNotNull(jobPostingsTable.closedAt)),
    ))
    .orderBy(jobPostingsTable.deletedAt);

  const onlineSources = await db
    .select({ provider: onlineDiscoverySourcesTable.provider, id: onlineDiscoverySourcesTable.id, name: onlineDiscoverySourcesTable.name })
    .from(onlineDiscoverySourcesTable)
    .where(eq(onlineDiscoverySourcesTable.userId, userId));
  const sourceNames = new Map(
    onlineSources.flatMap((source) => [
      [source.provider, source.name] as const,
      [`${source.provider}:${source.id}`, source.name] as const,
    ]),
  );

  const results = await Promise.all(
    postings.map(async (posting) => {
      const [report] = await db
        .select()
        .from(matchReportsTable)
        .where(and(eq(matchReportsTable.jobPostingId, posting.id), eq(matchReportsTable.userId, userId)));
      return { posting, report: report ?? null, sourceName: sourceNames.get(posting.source) ?? null };
    }),
  );

  res.json(ListPostingsResponse.parse(results));
});

// Returns pairs of postings whose titles are similar enough to be possible
// duplicates but below the auto-dedup threshold.
//
// Two separate queries are run and merged:
//   1. Active-vs-applied  (title 0.40–0.69, company > 0.40) — highest priority;
//      flags active jobs the user has already applied to something similar for.
//   2. Active-vs-active   (title 0.45–0.69, company > 0.35) — existing behaviour.
//
// Simple normalization (lowercase + strip non-alphanumeric + collapse spaces) is
// used intentionally — the full dbNormalizeSql() expansion embeds 10+ nested
// regexp_replace calls on each side of the join, making the query time out at
// scale. Simple normalization is adequate for the advisory banner.
router.get("/postings/near-duplicates", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const safeId = userId.replace(/[^a-zA-Z0-9_]/g, "");

  const norm = (col: string) =>
    `btrim(regexp_replace(regexp_replace(lower(${col}), '[^a-z0-9 ]', ' ', 'g'), ' +', ' ', 'g'))`;

  // CTEs pre-filter to small row-sets before the cross-join so that
  // similarity() is only evaluated on O(active × applied) pairs, not
  // the full O(total²) table cross-product.
  const CTE_ACTIVE = `
    SELECT id, title, company, location, link AS url, applied_at, deleted_at,
           salary_min, salary_max, created_at,
           ${norm("title")} AS ntitle, ${norm("company")} AS ncompany
    FROM job_postings
    WHERE user_id = '${safeId}'
      AND deleted_at IS NULL AND applied_at IS NULL AND closed_at IS NULL
  `;
  const CTE_APPLIED = `
    SELECT id, title, company, location, link AS url, applied_at, deleted_at,
           salary_min, salary_max, created_at,
           ${norm("title")} AS ntitle, ${norm("company")} AS ncompany
    FROM job_postings
    WHERE user_id = '${safeId}'
      AND applied_at IS NOT NULL AND deleted_at IS NULL AND closed_at IS NULL
  `;

  const SELECT_COLS = (a: string, b: string) => `
    ${a}.id AS id1, ${b}.id AS id2,
    ${a}.title AS title1, ${b}.title AS title2,
    ${a}.company AS company1, ${b}.company AS company2,
    ${a}.location AS location1, ${b}.location AS location2,
    ${a}.url AS url1, ${b}.url AS url2,
    ${a}.applied_at AS applied_at1, ${b}.applied_at AS applied_at2,
    ${a}.deleted_at AS deleted_at1, ${b}.deleted_at AS deleted_at2,
    ${a}.salary_min AS salary_min1, ${b}.salary_min AS salary_min2,
    ${a}.salary_max AS salary_max1, ${b}.salary_max AS salary_max2,
    ${a}.created_at AS created_at1, ${b}.created_at AS created_at2,
    similarity(${a}.ntitle, ${b}.ntitle) AS title_sim
  `;

  // Query 1: active jobs similar to something the user already applied to.
  // id1 = active, id2 = applied (applied_at2 is always set).
  const appliedPairsQ = `
    WITH active AS (${CTE_ACTIVE}), applied AS (${CTE_APPLIED})
    SELECT ${SELECT_COLS("a", "p")}
    FROM active a, applied p
    WHERE similarity(a.ntitle, p.ntitle) BETWEEN 0.40 AND 0.69
      AND similarity(a.ncompany, p.ncompany) > 0.40
    ORDER BY title_sim DESC
    LIMIT 20
  `;

  // Query 2: pairs of active jobs that look similar to each other.
  const activePairsQ = `
    WITH active AS (${CTE_ACTIVE})
    SELECT ${SELECT_COLS("a", "b")}
    FROM active a, active b
    WHERE a.id < b.id
      AND similarity(a.ntitle, b.ntitle) BETWEEN 0.45 AND 0.69
      AND similarity(a.ncompany, b.ncompany) > 0.35
    ORDER BY title_sim DESC
    LIMIT 20
  `;

  const [appliedPairs, activePairs] = await Promise.all([
    db.execute(sql.raw(appliedPairsQ)),
    db.execute(sql.raw(activePairsQ)),
  ]);

  // Merge: applied-vs-active pairs first (higher priority). Deduplicate by
  // posting ID so each card only gets one banner.
  const seen = new Set<number>();
  const results: unknown[] = [];
  for (const row of [...appliedPairs.rows, ...activePairs.rows]) {
    const r = row as { id1: number; id2: number };
    if (!seen.has(r.id1) && !seen.has(r.id2)) {
      seen.add(r.id1);
      seen.add(r.id2);
      results.push(row);
    }
  }

  res.json(results);
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
    .where(and(eq(jobPostingsTable.userId, userId), isNull(jobPostingsTable.deletedAt)));

  const existingLinks = new Set(existingPostings.map((p) => p.link?.trim().toLowerCase()).filter(Boolean));
  const existingTitleCompany = new Set(
    existingPostings.map((p) => `${p.title.trim().toLowerCase()}||${p.company.trim().toLowerCase()}`),
  );

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

    const linkKey = link?.toLowerCase();
    const titleCompanyKey = `${title.toLowerCase()}||${company.toLowerCase()}`;

    if ((linkKey && existingLinks.has(linkKey)) || existingTitleCompany.has(titleCompanyKey)) {
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

    existingLinks.add(linkKey ?? "");
    existingTitleCompany.add(titleCompanyKey);

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
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId), isNotNull(jobPostingsTable.deletedAt)))
    .returning();

  if (!posting) {
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
    .set({ closedAt: null })
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

router.delete("/postings/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = DeletePostingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [posting] = await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), deletedBy: "user", fullDescription: "" })
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

// Soft-deletes a posting the user has confirmed is a duplicate, then sweeps
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
      .set({ link: resolvedUrl })
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

  // Idempotent — if already deleted, just return success
  if (posting.deletedAt) {
    res.status(204).end();
    return;
  }

  await db
    .update(jobPostingsTable)
    .set({ deletedAt: new Date(), deletedBy: "user", fullDescription: "" })
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
