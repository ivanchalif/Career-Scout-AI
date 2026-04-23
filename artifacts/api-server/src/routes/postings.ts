import { Router, type IRouter } from "express";
import { eq, and, ilike, or, gte, isNotNull } from "drizzle-orm";
import { db, jobPostingsTable, matchReportsTable, userProfilesTable } from "@workspace/db";
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

const router: IRouter = Router();

async function getPostingWithReport(postingId: number, userId: string) {
  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, postingId), eq(jobPostingsTable.userId, userId)));

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

  const { search, minFitScore, source } = queryParsed.data;

  const conditions: ReturnType<typeof eq>[] = [eq(jobPostingsTable.userId, userId)];

  if (source) {
    conditions.push(eq(jobPostingsTable.source, source));
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
    .delete(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId)))
    .returning();

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  res.sendStatus(204);
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
    .where(and(eq(jobPostingsTable.id, params.data.id), eq(jobPostingsTable.userId, userId)));

  if (!posting) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const profileSkills = profile?.skills ?? [];
  const postingSkills = posting.extractedSkills ?? [];
  const matchedSkills = postingSkills.filter((s) => profileSkills.includes(s));
  const missingSkills = postingSkills.filter((s) => !profileSkills.includes(s));
  const fitScore = postingSkills.length > 0
    ? Math.round((matchedSkills.length / postingSkills.length) * 100)
    : 50;

  const placeholderReport = {
    jobPostingId: posting.id,
    userId,
    fitScore,
    reasoning: "Basic skill-match analysis. Full AI scoring coming in Task 3.",
    compensationGap: null as number | null,
    matchedSkills,
    missingSkills,
  };

  await db
    .delete(matchReportsTable)
    .where(
      and(
        eq(matchReportsTable.jobPostingId, posting.id),
        eq(matchReportsTable.userId, userId)
      )
    );

  const [report] = await db
    .insert(matchReportsTable)
    .values(placeholderReport)
    .returning();

  res.json(AnalyzePostingResponse.parse(report));
});

export default router;
