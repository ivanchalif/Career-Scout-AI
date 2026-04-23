import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userProfilesTable } from "@workspace/db";
import { UpsertProfileBody, GetProfileResponse, UpsertProfileResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { rescoreAllPostings } from "../lib/scoringService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(GetProfileResponse.parse(profile));
});

router.put("/profile", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const parsed = UpsertProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData = {
    ...parsed.data,
    userId,
  };

  const [profile] = await db
    .insert(userProfilesTable)
    .values(updateData)
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: {
        ...parsed.data,
        updatedAt: new Date(),
      },
    })
    .returning();

  rescoreAllPostings(userId).catch((err) => {
    logger.warn({ userId, err }, "profile: failed to queue re-scoring after profile update");
  });

  res.json(UpsertProfileResponse.parse(profile));
});

export default router;
