import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, filteredEmailsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/filtered-emails", requireAuth, async (req, res) => {
  const userId = req.userId;

  const rows = await db
    .select()
    .from(filteredEmailsTable)
    .where(eq(filteredEmailsTable.userId, userId))
    .orderBy(desc(filteredEmailsTable.filteredAt))
    .limit(500);

  res.json(rows);
});

export default router;
