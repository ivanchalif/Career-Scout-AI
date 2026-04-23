import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, matchReportsTable } from "@workspace/db";
import {
  GetMatchReportParams,
  GetMatchReportResponse,
  ListMatchReportsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/match-reports", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const reports = await db
    .select()
    .from(matchReportsTable)
    .where(eq(matchReportsTable.userId, userId))
    .orderBy(matchReportsTable.createdAt);

  res.json(ListMatchReportsResponse.parse(reports));
});

router.get("/match-reports/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const params = GetMatchReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [report] = await db
    .select()
    .from(matchReportsTable)
    .where(and(eq(matchReportsTable.id, params.data.id), eq(matchReportsTable.userId, userId)));

  if (!report) {
    res.status(404).json({ error: "Match report not found" });
    return;
  }

  res.json(GetMatchReportResponse.parse(report));
});

export default router;
