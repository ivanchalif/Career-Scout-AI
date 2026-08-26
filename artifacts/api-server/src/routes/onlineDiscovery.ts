import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, onlineDiscoverySourcesTable, userProfilesTable } from "@workspace/db";
import {
  CreateOnlineDiscoverySourceBody,
  DeleteOnlineDiscoverySourceParams,
  GetOnlineDiscoverySourcesResponse,
  GetOnlineDiscoveryStatusResponse,
  RunOnlineDiscoveryResponse,
  UpdateOnlineDiscoverySourceBody,
  UpdateOnlineDiscoverySourceParams,
  UpdateOnlineDiscoverySourceResponse,
  UpdateOnlineDiscoverySettingsBody,
  UpdateOnlineDiscoverySettingsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  DiscoveryProfileRequiredError,
  getOnlineDiscoverySources,
  ONLINE_SOURCE_CATALOG,
  prepareCustomSourceInput,
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

router.get("/online-discovery/sources", requireAuth, async (req, res): Promise<void> => {
  res.json(GetOnlineDiscoverySourcesResponse.parse(await getOnlineDiscoverySources(req.userId)));
});

router.post("/online-discovery/sources", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateOnlineDiscoverySourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let source: { provider: string; name: string; url: string; kind: "builtin" | "custom" };
  if (parsed.data.provider) {
    const builtin = ONLINE_SOURCE_CATALOG.find((candidate) => candidate.provider === parsed.data.provider);
    if (!builtin) {
      res.status(400).json({ error: "That built-in source is not available." });
      return;
    }
    source = { ...builtin, kind: "builtin" };
  } else if (parsed.data.url) {
    try {
      source = prepareCustomSourceInput(parsed.data.name ?? "", parsed.data.url);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid source URL." });
      return;
    }
  } else {
    res.status(400).json({ error: "Choose an available source or provide a custom HTTPS feed URL." });
    return;
  }

  try {
    const [created] = await db.insert(onlineDiscoverySourcesTable).values({
      userId: req.userId,
      ...source,
    }).returning();
    if (!created) throw new Error("Could not create source.");
    await db.update(userProfilesTable)
      .set({ onlineDiscoverySourcesInitialized: true, updatedAt: new Date() })
      .where(eq(userProfilesTable.userId, req.userId));
    res.status(201).json(UpdateOnlineDiscoverySourceResponse.parse(created));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "This source is already configured." });
      return;
    }
    throw error;
  }
});

router.patch("/online-discovery/sources/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateOnlineDiscoverySourceParams.safeParse(req.params);
  const body = UpdateOnlineDiscoverySourceBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [updated] = await db.update(onlineDiscoverySourcesTable)
    .set({ isSuppressed: body.data.suppressed, updatedAt: new Date() })
    .where(and(eq(onlineDiscoverySourcesTable.id, params.data.id), eq(onlineDiscoverySourcesTable.userId, req.userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Source not found." });
    return;
  }
  res.json(UpdateOnlineDiscoverySourceResponse.parse(updated));
});

router.delete("/online-discovery/sources/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteOnlineDiscoverySourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(onlineDiscoverySourcesTable)
    .where(and(eq(onlineDiscoverySourcesTable.id, params.data.id), eq(onlineDiscoverySourcesTable.userId, req.userId)))
    .returning({ id: onlineDiscoverySourcesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Source not found." });
    return;
  }
  res.sendStatus(204);
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