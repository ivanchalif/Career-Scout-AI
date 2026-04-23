import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, userProfilesTable } from "@workspace/db";
import { UpsertProfileBody, GetProfileResponse, UpsertProfileResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { rescoreAllPostings } from "../lib/scoringService";
import { getResumeText } from "../lib/resumeReader";
import { openai } from "@workspace/integrations-openai-ai-server";
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

const parsedExperienceSchema = z.array(
  z.object({
    title: z.string(),
    company: z.string(),
    startYear: z.number().int(),
    endYear: z.number().int().nullable().optional(),
    description: z.string().default(""),
  })
).default([]);

router.post("/profile/parse-resume", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (!profile?.resumeUrl && !profile?.resumeText) {
    res.status(400).json({ error: "No resume found. Upload a PDF or paste your resume text first." });
    return;
  }

  let resumeText = "";
  if (profile.resumeText && profile.resumeText.length > 50) {
    resumeText = profile.resumeText;
  } else if (profile.resumeUrl) {
    resumeText = await getResumeText(profile.resumeUrl);
  }

  if (!resumeText || resumeText.length < 50) {
    res.status(422).json({ error: "Could not extract text from your resume. Make sure it is a text-based PDF (not a scanned image), or use the paste option." });
    return;
  }

  logger.info({ userId, chars: resumeText.length }, "profile/parse-resume: extracted resume text");

  const currentYear = new Date().getFullYear();

  const prompt = `You are a resume parser. Extract the complete work history from the resume text below.

Resume text:
---
${resumeText.slice(0, 8000)}
---

Return a JSON array of work experience entries. Each entry must have:
{
  "title": "job title",
  "company": "employer name",
  "startYear": integer year (e.g. 2018),
  "endYear": integer year or null if current/present,
  "description": "1-2 sentence summary of responsibilities and achievements"
}

Rules:
- Include ALL paid work experience (full-time, part-time, contract, consulting)
- Sort entries from most recent to oldest
- If only a year range is shown (e.g. "2019-2022"), use those as startYear/endYear
- If "present" or "current" is shown, set endYear to null
- Keep company names clean (no location suffixes)
- Write description in plain, concise prose — no bullet points
- Current year for reference: ${currentYear}
- Return raw JSON array only, no markdown`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content ?? "[]";
    const cleaned = content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const result = parsedExperienceSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn({ issues: result.error.issues }, "profile/parse-resume: schema validation failed");
      res.status(422).json({ error: "Could not parse work history from resume. Try again or add entries manually." });
      return;
    }

    const entries = result.data.filter(
      (e) => e.title.trim() && e.company.trim() && e.startYear >= 1970 && e.startYear <= currentYear + 1
    );

    if (entries.length === 0) {
      res.status(422).json({ error: "No work experience found in resume. Add entries manually." });
      return;
    }

    logger.info({ userId, count: entries.length }, "profile/parse-resume: parsed experience entries");
    res.json({ experienceHistory: entries });
  } catch (err) {
    logger.error({ userId, err }, "profile/parse-resume: LLM call failed");
    res.status(500).json({ error: "Failed to parse resume. Please try again." });
  }
});

export default router;
