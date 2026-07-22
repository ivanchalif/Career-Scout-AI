import { Router } from "express";
import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db, emailSyncLogTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/api/email-sync-log", requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { startDate, endDate, sender, outcome } = req.query as Record<string, string | undefined>;

  const conditions = [eq(emailSyncLogTable.userId, userId)];

  if (startDate) {
    const d = new Date(startDate);
    if (!isNaN(d.getTime())) conditions.push(gte(emailSyncLogTable.processedAt, d));
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!isNaN(d.getTime())) conditions.push(lte(emailSyncLogTable.processedAt, d));
  }
  if (sender) {
    conditions.push(
      or(
        ilike(emailSyncLogTable.senderEmail, `%${sender}%`),
        ilike(emailSyncLogTable.senderName, `%${sender}%`),
      ),
    );
  }
  if (outcome) {
    conditions.push(eq(emailSyncLogTable.outcome, outcome));
  }

  const rows = await db
    .select()
    .from(emailSyncLogTable)
    .where(and(...conditions))
    .orderBy(desc(emailSyncLogTable.processedAt))
    .limit(500);

  res.json(rows);
});

export default router;
