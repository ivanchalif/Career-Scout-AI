import { eq, and, isNotNull } from "drizzle-orm";
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

const extractedJobsSchema = z
  .array(
    z.object({
      title: z.string().default(""),
      company: z.string().default(""),
      description: z.string().default(""),
    }),
  )
  .default([]);

export interface ExtractedJobListing {
  title: string;
  company: string;
  description: string;
}

/**
 * Use the LLM to split an email body into individual job listings.
 * Falls back to treating the full email as a single listing if AI is unavailable.
 */
export async function extractJobListings(
  emailBody: string,
  subject: string,
  sender: string,
): Promise<ExtractedJobListing[]> {
  const prompt = `You are an email parser that extracts individual job listings from emails.

An email may contain:
- A single job posting → return an array with 1 item
- A recruiter outreach for a single role → return 1 item
- A jobs digest / roundup with multiple distinct roles → return each as its own item
- No actual job listings (company news, newsletter articles, etc.) → return []

Email Subject: ${subject}
Email Sender: ${sender}
Email Body:
---
${emailBody.slice(0, 6000)}
---

Return a JSON array of job listings (max 10). Each entry must have:
{
  "title": "job title (infer from context if not explicit)",
  "company": "company name",
  "description": "the relevant portion of the email body for THIS specific job (200-2000 chars)"
}

Rules:
- Only include real job opportunities, not articles about hiring trends or company news
- If the email is a single posting, return exactly 1 item using the full body as description
- Each description must be self-contained — include the role title, requirements, and any relevant details
- Return raw JSON array only, no markdown`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content ?? "[]";
    const cleaned = content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = extractedJobsSchema.safeParse(parsed);

    if (result.success) {
      const listings = result.data.filter((j) => j.description.trim().length > 0).slice(0, 10);
      if (listings.length > 0) return listings;
    } else {
      logger.warn({ issues: result.error.issues }, "scoringService: extractJobListings schema validation failed");
    }
  } catch (err) {
    logger.warn({ err }, "scoringService: extractJobListings failed, falling back to single listing");
  }

  return [{ title: subject.slice(0, 200), company: sender, description: emailBody }];
}

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
  const isShortDescription = rawDescription.trim().length < 600;

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
- requiredSkills: extract explicitly listed requirements. ${isShortDescription ? `IMPORTANT: this description is brief — if skills are not explicitly listed, infer the 4–7 most critical skills for someone in this role based on the job title and seniority (e.g. "Head of Product" → ["Product Strategy", "Roadmapping", "Stakeholder Management", "Cross-functional Leadership"]; "Director of Product Management" → ["Product Management", "Product Strategy", "Roadmapping", "Stakeholder Management", "Leadership"]). Never leave requiredSkills empty.` : `If not explicitly listed, infer 3–5 critical skills from the job title and context.`}
- niceToHaveSkills: preferred/bonus skills only.
- Keep each skill concise (e.g. "React", "Python", "5+ years experience" → extract skill name only).
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
    .onConflictDoUpdate({
      target: [matchReportsTable.jobPostingId, matchReportsTable.userId],
      set: {
        fitScore: fitResult.fitScore,
        reasoning: fitResult.reasoning,
        matchedSkills: fitResult.matchedSkills,
        missingSkills: fitResult.missingSkills,
        compensationGap,
      },
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

/**
 * Enqueue all postings for a user for background re-scoring.
 * Called when the user's profile is updated so scores reflect the latest profile.
 * @param forceParse If true, forces re-parsing of job descriptions (ignores cached skills).
 *                   Defaults to false — re-uses existing parsed fields when available.
 */
export async function rescoreAllPostings(userId: string, { forceParse = false }: { forceParse?: boolean } = {}): Promise<void> {
  const allPostings = await db
    .select({ id: jobPostingsTable.id })
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));

  if (allPostings.length > 0) {
    logger.info({ userId, count: allPostings.length, forceParse }, "scoringService: queuing all postings for re-score");
    for (const { id } of allPostings) {
      backgroundQueue = backgroundQueue.then(async () => {
        await scorePosting(id, userId, { forceParse }).catch((err) => {
          logger.error({ postingId: id, userId, err }, "scoringService: background scoring failed");
        });
      });
    }
  }
}

/**
 * Enqueue all unscored postings for a user for background scoring.
 * Runs at sync time to retry any postings that failed scoring previously.
 */
export async function sweepUnscoredPostings(userId: string): Promise<void> {
  const [scored, allPostings] = await Promise.all([
    db
      .select({ id: matchReportsTable.jobPostingId })
      .from(matchReportsTable)
      .where(and(eq(matchReportsTable.userId, userId), isNotNull(matchReportsTable.fitScore))),
    db
      .select({ id: jobPostingsTable.id })
      .from(jobPostingsTable)
      .where(eq(jobPostingsTable.userId, userId)),
  ]);

  const scoredIds = new Set(scored.map((r) => r.id));
  const unscored = allPostings.filter((p) => !scoredIds.has(p.id));

  if (unscored.length > 0) {
    logger.info({ userId, count: unscored.length }, "scoringService: queuing unscored postings");
    for (const { id } of unscored) {
      scorePostingBackground(id, userId);
    }
  }
}
