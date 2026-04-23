import { eq, and } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  matchReportsTable,
  userProfilesTable,
} from "@workspace/db";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

const parsedJobSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  requiredSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  minYearsExperience: z.number().nullable().default(null),
  salaryMin: z.number().nullable().default(null),
  salaryMax: z.number().nullable().default(null),
  remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
});

type ParsedJob = z.infer<typeof parsedJobSchema>;

const fitScoreResultSchema = z.object({
  fitScore: z.number().min(0).max(100),
  reasoning: z.string().default(""),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  compensationGap: z.number().nullable().default(null),
});

type FitScoreResult = z.infer<typeof fitScoreResultSchema>;

async function parseJobDescription(
  rawDescription: string,
  title: string,
  company: string,
): Promise<ParsedJob> {
  const prompt = `You are a structured job posting parser. Extract structured data from the following job posting.

Job Title (from subject/header): ${title}
Company: ${company}

Raw Job Description:
---
${rawDescription.slice(0, 6000)}
---

Return a JSON object with EXACTLY these fields (no markdown, just raw JSON):
{
  "title": "canonical job title from the description",
  "company": "company name",
  "requiredSkills": ["skill1", "skill2"],
  "niceToHaveSkills": ["skill3"],
  "minYearsExperience": null or integer,
  "salaryMin": null or integer (annual USD, no commas),
  "salaryMax": null or integer (annual USD, no commas),
  "remoteType": "remote" | "hybrid" | "onsite" | "unknown"
}

Rules:
- requiredSkills: only hard requirements (must-have). Keep each skill concise (e.g. "React", "Python", "5+ years experience" → extract skill name only).
- niceToHaveSkills: preferred/bonus skills only.
- Combine related synonyms into one (e.g. "Node.js" and "NodeJS" → "Node.js").
- If salary is a range like "$120k-$150k", set salaryMin=120000, salaryMax=150000.
- If no salary mentioned, set both to null.
- Be thorough but precise — max 20 required skills, max 10 nice-to-have.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const cleaned = content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = parsedJobSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    logger.warn({ issues: result.error.issues }, "scoringService: LLM output failed schema validation, using safe defaults");
    return parsedJobSchema.parse({});
  } catch {
    logger.warn({ content }, "scoringService: failed to parse job JSON, using defaults");
    return parsedJobSchema.parse({});
  }
}

async function scoreFit(
  parsedJob: ParsedJob,
  userProfile: {
    skills: string[];
    experienceHistory: Array<{
      title: string;
      company: string;
      startYear: number;
      endYear: number | null;
      description: string;
    }>;
    education: string | null;
    targetSalary: number | null;
    remotePreference: string;
  },
): Promise<FitScoreResult> {
  const yearsOfExperience = userProfile.experienceHistory.reduce((total, exp) => {
    const end = exp.endYear ?? new Date().getFullYear();
    return total + Math.max(0, end - exp.startYear);
  }, 0);

  const jobSalaryMid =
    parsedJob.salaryMin != null && parsedJob.salaryMax != null
      ? Math.round((parsedJob.salaryMin + parsedJob.salaryMax) / 2)
      : parsedJob.salaryMin ?? parsedJob.salaryMax ?? null;

  const prompt = `You are a conservative career fit scorer. Score how well a candidate matches a job posting.

CANDIDATE PROFILE:
Skills: ${userProfile.skills.join(", ") || "None listed"}
Years of Experience: ~${yearsOfExperience} years
Experience History: ${userProfile.experienceHistory
    .map((e) => `${e.title} at ${e.company} (${e.startYear}–${e.endYear ?? "present"}): ${e.description.slice(0, 200)}`)
    .join("\n") || "None listed"}
Education: ${userProfile.education ?? "Not specified"}
Target Salary: ${userProfile.targetSalary ? `$${userProfile.targetSalary.toLocaleString()}/year` : "Not specified"}
Remote Preference: ${userProfile.remotePreference}

JOB REQUIREMENTS:
Title: ${parsedJob.title}
Company: ${parsedJob.company}
Required Skills: ${parsedJob.requiredSkills.join(", ") || "None specified"}
Nice-to-Have Skills: ${parsedJob.niceToHaveSkills.join(", ") || "None specified"}
Min Experience: ${parsedJob.minYearsExperience != null ? `${parsedJob.minYearsExperience} years` : "Not specified"}
Salary Range: ${parsedJob.salaryMin ? `$${parsedJob.salaryMin.toLocaleString()}` : "?"}${parsedJob.salaryMax ? `–$${parsedJob.salaryMax.toLocaleString()}` : ""}
Work Type: ${parsedJob.remoteType}

Return a JSON object with EXACTLY these fields (no markdown, just raw JSON):
{
  "fitScore": integer 0-100,
  "reasoning": "2-3 sentence explanation of the score",
  "matchedSkills": ["skills from required list that the candidate clearly has"],
  "missingSkills": ["skills from required list the candidate is missing or unclear on"],
  "compensationGap": null or integer
}

Scoring rules (be CONSERVATIVE — round DOWN for uncertainty):
- Start at 100, deduct for each missing required skill proportionally
- Deduct heavily if candidate lacks most required skills (score < 40 if < 30% skill match)
- Deduct for experience gap if minYearsExperience > candidate's years
- Add up to +10 if nice-to-have skills match
- Remote preference mismatch: deduct 5-10 points
- If a skill is partial match or unclear, treat as MISSING (conservative scoring)
- matchedSkills: ONLY include skills the candidate CLEARLY has from their profile
- missingSkills: all required skills NOT clearly in the candidate's profile
- compensationGap: (jobSalaryMid - targetSalary). Positive = job pays more than target, negative = pays less. Set to null if either is unknown.
- Job salary mid: ${jobSalaryMid ?? "unknown"}
- Candidate target salary: ${userProfile.targetSalary ?? "unknown"}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const cleaned = content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = fitScoreResultSchema.safeParse(parsed);
    if (result.success) {
      return {
        ...result.data,
        fitScore: Math.max(0, Math.min(100, Math.round(result.data.fitScore))),
      };
    }
    logger.warn({ issues: result.error.issues }, "scoringService: fit score failed schema validation, using fallback");
  } catch {
    logger.warn({ content }, "scoringService: failed to parse fit score JSON, using fallback");
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "").trim();
  const profileSkillsNorm = userProfile.skills.map((s: string) => normalize(s));
  const matched = parsedJob.requiredSkills.filter((s: string) =>
    profileSkillsNorm.includes(normalize(s))
  );
  const missing = parsedJob.requiredSkills.filter((s: string) => !matched.includes(s));
  const fitScore =
    parsedJob.requiredSkills.length > 0
      ? Math.round((matched.length / parsedJob.requiredSkills.length) * 100)
      : 50;
  return {
    fitScore,
    reasoning: "Fit score based on skill overlap analysis.",
    matchedSkills: matched,
    missingSkills: missing,
    compensationGap: null,
  };
}

export interface ScoringResult {
  report: typeof matchReportsTable.$inferSelect;
}

/**
 * Score a job posting against the user's profile.
 * @param forceParse If true, always re-parse the job description even if already parsed.
 *                   Defaults to false — re-uses existing parsed fields when available.
 */
export async function scorePosting(
  postingId: number,
  userId: string,
  { forceParse = false }: { forceParse?: boolean } = {},
): Promise<ScoringResult> {
  const [posting] = await db
    .select()
    .from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.id, postingId), eq(jobPostingsTable.userId, userId)));

  if (!posting) {
    throw new Error(`Posting ${postingId} not found for user ${userId}`);
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const userProfile = profile
    ? {
        skills: profile.skills ?? [],
        experienceHistory: (profile.experienceHistory ?? []) as Array<{
          title: string;
          company: string;
          startYear: number;
          endYear: number | null;
          description: string;
        }>,
        education: profile.education ?? null,
        targetSalary: profile.targetSalary ?? null,
        remotePreference: profile.remotePreference ?? "hybrid",
      }
    : {
        skills: [],
        experienceHistory: [],
        education: null,
        targetSalary: null,
        remotePreference: "hybrid",
      };

  let parsedJob: ParsedJob;

  const alreadyParsed = posting.requiredSkills.length > 0 && !forceParse;

  if (alreadyParsed) {
    logger.info({ postingId, userId }, "scoringService: reusing existing parsed fields");
    parsedJob = {
      title: posting.title,
      company: posting.company,
      requiredSkills: posting.requiredSkills,
      niceToHaveSkills: posting.niceToHaveSkills,
      minYearsExperience: posting.minYearsExperience ?? null,
      salaryMin: posting.salaryMin ?? null,
      salaryMax: posting.salaryMax ?? null,
      remoteType: (posting.remoteType as ParsedJob["remoteType"]) ?? "unknown",
    };
  } else {
    logger.info({ postingId, userId }, "scoringService: parsing job description");
    parsedJob = await parseJobDescription(
      posting.fullDescription,
      posting.title,
      posting.company,
    );

    const updatedSkills = [
      ...new Set([
        ...parsedJob.requiredSkills,
        ...parsedJob.niceToHaveSkills,
      ]),
    ];

    const canonicalTitle = parsedJob.title.trim() || posting.title;
    const canonicalCompany = parsedJob.company.trim() || posting.company;

    await db
      .update(jobPostingsTable)
      .set({
        title: canonicalTitle,
        company: canonicalCompany,
        extractedSkills: updatedSkills,
        requiredSkills: parsedJob.requiredSkills,
        niceToHaveSkills: parsedJob.niceToHaveSkills,
        minYearsExperience: parsedJob.minYearsExperience ?? posting.minYearsExperience,
        remoteType: parsedJob.remoteType !== "unknown" ? parsedJob.remoteType : posting.remoteType,
        salaryMin: parsedJob.salaryMin ?? posting.salaryMin,
        salaryMax: parsedJob.salaryMax ?? posting.salaryMax,
      })
      .where(eq(jobPostingsTable.id, postingId));
  }

  logger.info({ postingId, userId }, "scoringService: running fit scoring");
  const fitResult = await scoreFit(parsedJob, userProfile);

  const jobSalaryMid =
    parsedJob.salaryMin != null && parsedJob.salaryMax != null
      ? Math.round((parsedJob.salaryMin + parsedJob.salaryMax) / 2)
      : parsedJob.salaryMin ?? parsedJob.salaryMax ?? null;

  const compensationGap =
    jobSalaryMid != null && userProfile.targetSalary != null
      ? jobSalaryMid - userProfile.targetSalary
      : null;

  await db
    .delete(matchReportsTable)
    .where(
      and(
        eq(matchReportsTable.jobPostingId, postingId),
        eq(matchReportsTable.userId, userId),
      ),
    );

  const [report] = await db
    .insert(matchReportsTable)
    .values({
      jobPostingId: postingId,
      userId,
      fitScore: fitResult.fitScore,
      reasoning: fitResult.reasoning,
      matchedSkills: fitResult.matchedSkills,
      missingSkills: fitResult.missingSkills,
      compensationGap,
    })
    .returning();

  logger.info(
    { postingId, userId, fitScore: fitResult.fitScore },
    "scoringService: scoring complete",
  );

  return { report };
}

let backgroundQueue = Promise.resolve();

/**
 * Enqueue a posting for background scoring.
 * All calls are serialized to prevent burst failures during large Gmail imports.
 */
export function scorePostingBackground(
  postingId: number,
  userId: string,
): void {
  backgroundQueue = backgroundQueue.then(async () => {
    await scorePosting(postingId, userId).catch((err) => {
      logger.error(
        { postingId, userId, err },
        "scoringService: background scoring failed",
      );
    });
  });
}
