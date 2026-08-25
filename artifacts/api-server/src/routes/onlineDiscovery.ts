import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userProfilesTable } from "@workspace/db";
import {
  GetOnlineDiscoveryStatusResponse,
  RunOnlineDiscoveryResponse,
  UpdateOnlineDiscoverySettingsBody,
  UpdateOnlineDiscoverySettingsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  DiscoveryProfileRequiredError,
  runOnlineDiscovery,
  toDiscoveryStatus,
} from "../lib/onlineDiscovery";

const router: IRouter = Router();

router.get("/online-discovery/status", requireAuth, async (req, res): Promise<void> => {
  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, req.userId));
  res.json(GetOnlineDiscoveryStatusResponse.parse(toDiscoveryStatus(profile)));
});

router.put("/online-discovery/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateOnlineDiscoverySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db.insert(userProfilesTable).values({
    userId: req.userId,
    onlineDiscoveryScheduleHours: parsed.data.scheduleHours,
    onlineDiscoveryMinMatchScore: parsed.data.minimumMatchScore,
  }).onConflictDoUpdate({
    target: userProfilesTable.userId,
    set: {
      onlineDiscoveryScheduleHours: parsed.data.scheduleHours,
      onlineDiscoveryMinMatchScore: parsed.data.minimumMatchScore,
      updatedAt: new Date(),
    },
  }).returning();
  res.json(UpdateOnlineDiscoverySettingsResponse.parse(toDiscoveryStatus(profile)));
});

router.post("/online-discovery/run", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(RunOnlineDiscoveryResponse.parse(await runOnlineDiscovery(req.userId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Online discovery failed.";
    res.status(error instanceof DiscoveryProfileRequiredError ? 400 : 502).json({ error: message });
  }
});

export default router;