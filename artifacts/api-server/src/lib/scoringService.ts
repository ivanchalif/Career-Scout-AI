import { eq, and } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  matchReportsTable,
  userProfilesTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

interface ParsedJob {
  title: string;
  company: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  minYearsExperience: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
}

interface FitScoreResult {
  fitScore: number;
  reasoning: string;
  matchedSkills: string[];
  missingSkills: string[];
  compensationGap: number | null;
}

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
    return JSON.parse(cleaned) as ParsedJob;
  } catch {
    logger.warn({ content }, "scoringService: failed to parse job JSON, using defaults");
    return {
      title,
      company,
      requiredSkills: [],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "unknown",
    };
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
    const result = JSON.parse(cleaned) as FitScoreResult;
    return {
      fitScore: Math.max(0, Math.min(100, Math.round(result.fitScore))),
      reasoning: result.reasoning ?? "",
      matchedSkills: Array.isArray(result.matchedSkills) ? result.matchedSkills : [],
      missingSkills: Array.isArray(result.missingSkills) ? result.missingSkills : [],
      compensationGap:
        result.compensationGap != null ? Math.round(result.compensationGap) : null,
    };
  } catch {
    logger.warn({ content }, "scoringService: failed to parse fit score JSON, using fallback");
    const profileSkills = userProfile.skills.map((s) => s.toLowerCase());
    const matched = parsedJob.requiredSkills.filter((s) =>
      profileSkills.some((ps) => ps.includes(s.toLowerCase()) || s.toLowerCase().includes(ps))
    );
    const missing = parsedJob.requiredSkills.filter((s) => !matched.includes(s));
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
}

export interface ScoringResult {
  report: typeof matchReportsTable.$inferSelect;
}

export async function scorePosting(
  postingId: number,
  userId: string,
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

  logger.info({ postingId, userId }, "scoringService: parsing job description");
  const parsedJob = await parseJobDescription(
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

  await db
    .update(jobPostingsTable)
    .set({
      extractedSkills: updatedSkills,
      requiredSkills: parsedJob.requiredSkills,
      niceToHaveSkills: parsedJob.niceToHaveSkills,
      minYearsExperience: parsedJob.minYearsExperience ?? posting.minYearsExperience,
      remoteType: parsedJob.remoteType !== "unknown" ? parsedJob.remoteType : posting.remoteType,
      salaryMin: parsedJob.salaryMin ?? posting.salaryMin,
      salaryMax: parsedJob.salaryMax ?? posting.salaryMax,
    })
    .where(eq(jobPostingsTable.id, postingId));

  logger.info({ postingId, userId }, "scoringService: running fit scoring");
  const fitResult = await scoreFit(parsedJob, userProfile);

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
      compensationGap: fitResult.compensationGap,
    })
    .returning();

  logger.info(
    { postingId, userId, fitScore: fitResult.fitScore },
    "scoringService: scoring complete",
  );

  return { report };
}

export async function scorePostingBackground(
  postingId: number,
  userId: string,
): Promise<void> {
  scorePosting(postingId, userId).catch((err) => {
    logger.error(
      { postingId, userId, err },
      "scoringService: background scoring failed",
    );
  });
}
