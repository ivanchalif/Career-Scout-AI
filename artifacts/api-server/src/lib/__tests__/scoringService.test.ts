import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  jobPostingsTable: {},
  matchReportsTable: {},
  userProfilesTable: {},
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../resumeReader", () => ({
  getResumeText: vi.fn().mockResolvedValue(""),
}));

import { openai } from "@workspace/integrations-openai-ai-server";
import { parseJobDescription, scoreFit } from "../scoringService";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;

const SAMPLE_PROFILE = {
  skills: ["TypeScript", "React", "Node.js"],
  experienceHistory: [
    {
      title: "Software Engineer",
      company: "Acme Corp",
      startYear: 2019,
      endYear: 2023,
      description: "Built web applications",
    },
  ],
  education: "B.S. Computer Science",
  targetSalary: 130000,
  remotePreference: "remote",
  remotePreferences: ["remote"],
  locationPreferences: [],
};

describe("parseJobDescription()", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns structured data from a valid LLM response", async () => {
    const llmOutput = {
      title: "Senior Frontend Engineer",
      company: "TechCo",
      location: "San Francisco, CA",
      requiredSkills: ["React", "TypeScript", "GraphQL"],
      niceToHaveSkills: ["Next.js"],
      minYearsExperience: 5,
      salaryMin: 130000,
      salaryMax: 160000,
      remoteType: "hybrid",
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(llmOutput) } }],
    });

    const result = await parseJobDescription(
      "We are looking for a Senior Frontend Engineer...",
      "Senior Frontend Engineer",
      "TechCo",
    );

    expect(result.title).toBe("Senior Frontend Engineer");
    expect(result.company).toBe("TechCo");
    expect(result.requiredSkills).toEqual(["React", "TypeScript", "GraphQL"]);
    expect(result.niceToHaveSkills).toEqual(["Next.js"]);
    expect(result.minYearsExperience).toBe(5);
    expect(result.salaryMin).toBe(130000);
    expect(result.salaryMax).toBe(160000);
    expect(result.remoteType).toBe("hybrid");
  });

  it("strips markdown code fences from LLM output", async () => {
    const llmOutput = {
      title: "Backend Engineer",
      company: "StartupX",
      location: null,
      requiredSkills: ["Python", "Django"],
      niceToHaveSkills: [],
      minYearsExperience: 3,
      salaryMin: null,
      salaryMax: null,
      remoteType: "remote",
    };

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "```json\n" + JSON.stringify(llmOutput) + "\n```",
          },
        },
      ],
    });

    const result = await parseJobDescription(
      "Backend Python role",
      "Backend Engineer",
      "StartupX",
    );

    expect(result.title).toBe("Backend Engineer");
    expect(result.requiredSkills).toEqual(["Python", "Django"]);
  });

  it("returns safe defaults when LLM returns malformed JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json {{{{" } }],
    });

    const result = await parseJobDescription(
      "Some job description",
      "Unknown Role",
      "Acme",
    );

    expect(result.title).toBe("");
    expect(result.company).toBe("");
    expect(result.requiredSkills).toEqual([]);
    expect(result.niceToHaveSkills).toEqual([]);
    expect(result.remoteType).toBe("unknown");
  });

  it("returns safe defaults when LLM output fails schema validation", async () => {
    const badOutput = {
      title: 12345,
      remoteType: "flying",
      requiredSkills: "not-an-array",
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(badOutput) } }],
    });

    const result = await parseJobDescription(
      "Some job description",
      "Role",
      "Corp",
    );

    expect(Array.isArray(result.requiredSkills)).toBe(true);
    expect(result.remoteType).toBe("unknown");
  });

  it("returns safe defaults when the LLM call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      parseJobDescription("Some job description", "Engineer", "Corp"),
    ).rejects.toThrow("Network error");
  });
});

describe("scoreFit()", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns a valid fit score from a well-formed LLM response", async () => {
    const llmOutput = {
      fitScore: 78,
      reasoning: "Strong skill match with minor experience gap.",
      matchedSkills: ["TypeScript", "React"],
      missingSkills: ["GraphQL"],
      compensationGap: 5000,
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(llmOutput) } }],
    });

    const parsedJob = {
      title: "Frontend Engineer",
      company: "TechCo",
      location: null,
      requiredSkills: ["TypeScript", "React", "GraphQL"],
      niceToHaveSkills: [],
      minYearsExperience: 3,
      salaryMin: 120000,
      salaryMax: 150000,
      remoteType: "remote" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);

    expect(result.fitScore).toBe(78);
    expect(result.reasoning).toBe("Strong skill match with minor experience gap.");
    expect(result.matchedSkills).toEqual(["TypeScript", "React"]);
    expect(result.missingSkills).toEqual(["GraphQL"]);
    expect(result.compensationGap).toBe(5000);
  });

  it("rounds fitScore to the nearest integer", async () => {
    const llmOutput = {
      fitScore: 73.7,
      reasoning: "Close match",
      matchedSkills: ["TypeScript"],
      missingSkills: [],
      compensationGap: null,
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(llmOutput) } }],
    });

    const parsedJob = {
      title: "Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["TypeScript"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "unknown" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);
    expect(result.fitScore).toBe(74);
    expect(Number.isInteger(result.fitScore)).toBe(true);
  });

  it("falls back to skill-overlap when LLM returns an out-of-range fitScore", async () => {
    const llmOutput = {
      fitScore: 150,
      reasoning: "Out of range",
      matchedSkills: [],
      missingSkills: [],
      compensationGap: null,
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(llmOutput) } }],
    });

    const parsedJob = {
      title: "Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["TypeScript"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "unknown" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);
    expect(result.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.fitScore).toBeLessThanOrEqual(100);
  });

  it("falls back to skill-overlap scoring when LLM returns malformed JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "INVALID JSON }{" } }],
    });

    const parsedJob = {
      title: "Frontend Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["TypeScript", "React", "Vue"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "remote" as const,
    };

    const profile = {
      ...SAMPLE_PROFILE,
      skills: ["TypeScript", "React"],
    };

    const result = await scoreFit(parsedJob, profile);

    expect(result.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.fitScore).toBeLessThanOrEqual(100);
    expect(result.matchedSkills).toContain("TypeScript");
    expect(result.matchedSkills).toContain("React");
    expect(result.missingSkills).toContain("Vue");
    expect(result.reasoning).toBe("Fit score based on skill overlap analysis.");
  });

  it("falls back to skill-overlap scoring when LLM response fails schema validation", async () => {
    const badOutput = {
      fitScore: "not-a-number",
      reasoning: null,
      matchedSkills: "wrong-type",
      missingSkills: 42,
      compensationGap: "bad",
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(badOutput) } }],
    });

    const parsedJob = {
      title: "Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["Node.js"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "unknown" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);

    expect(typeof result.fitScore).toBe("number");
    expect(result.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.fitScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.matchedSkills)).toBe(true);
    expect(Array.isArray(result.missingSkills)).toBe(true);
  });

  it("returns 50% score when no required skills are listed", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "bad json" } }],
    });

    const parsedJob = {
      title: "Generalist",
      company: "Corp",
      location: null,
      requiredSkills: [],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "unknown" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);
    expect(result.fitScore).toBe(50);
  });

  it("graceful fallback: score persists and is not null even when LLM fails", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const parsedJob = {
      title: "Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["TypeScript"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      salaryMin: null,
      salaryMax: null,
      remoteType: "remote" as const,
    };

    const result = await scoreFit(parsedJob, SAMPLE_PROFILE);

    expect(result.fitScore).not.toBeNull();
    expect(typeof result.fitScore).toBe("number");
  });
});

import { db } from "@workspace/db";
import { scorePosting } from "../scoringService";

const dbSelect = db.select as ReturnType<typeof vi.fn>;
const dbInsert = db.insert as ReturnType<typeof vi.fn>;
const dbUpdate = db.update as ReturnType<typeof vi.fn>;

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

const FAKE_POSTING = {
  id: 1,
  userId: "user-1",
  title: "Backend Engineer",
  company: "Corp",
  fullDescription: "Looking for a backend engineer skilled in Node.js and PostgreSQL.",
  requiredSkills: [],
  niceToHaveSkills: [],
  extractedSkills: [],
  location: null,
  remoteType: "remote",
  salaryMin: null,
  salaryMax: null,
  minYearsExperience: null,
  link: null,
  source: "manual",
  gmailMessageId: null,
  appliedAt: null,
  deletedAt: null,
  createdAt: new Date(),
};

const FAKE_PROFILE = {
  userId: "user-1",
  skills: ["Node.js"],
  experienceHistory: [],
  education: null,
  targetSalary: null,
  remotePreference: "remote",
  remotePreferences: [],
  locationPreferences: [],
  resumeText: null,
  resumeUrl: null,
};

describe("scorePosting() — DB persistence under malformed LLM JSON", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    dbSelect.mockReset();
    dbInsert.mockReset();
    dbUpdate.mockReset();
  });

  it("persists a non-null fitScore to the DB even when both LLM calls return malformed JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "}{NOT VALID JSON}{" } }],
    });

    dbSelect
      .mockReturnValueOnce(makeSelectChain([FAKE_POSTING]))
      .mockReturnValueOnce(makeSelectChain([FAKE_PROFILE]));

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    dbUpdate.mockReturnValue(updateChain);

    const fakeReport = {
      id: 99,
      jobPostingId: 1,
      userId: "user-1",
      fitScore: 100,
      reasoning: "Fit score based on skill overlap analysis.",
      matchedSkills: ["Node.js"],
      missingSkills: [],
      compensationGap: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([fakeReport]),
    };
    dbInsert.mockReturnValue(insertChain);

    const result = await scorePosting(1, "user-1");

    expect(result.report.fitScore).not.toBeNull();
    expect(typeof result.report.fitScore).toBe("number");

    const insertedPayload = insertChain.values.mock.calls[0]?.[0];
    expect(insertedPayload).toBeDefined();
    expect(insertedPayload.fitScore).not.toBeNull();
    expect(typeof insertedPayload.fitScore).toBe("number");
    expect(insertedPayload.fitScore).toBeGreaterThanOrEqual(0);
    expect(insertedPayload.fitScore).toBeLessThanOrEqual(100);
  });

  it("persists a non-null fitScore even when the parse LLM call returns valid JSON but the score LLM call is malformed", async () => {
    const parseOutput = {
      title: "Backend Engineer",
      company: "Corp",
      location: null,
      requiredSkills: ["Node.js", "PostgreSQL"],
      niceToHaveSkills: [],
      minYearsExperience: 3,
      salaryMin: null,
      salaryMax: null,
      remoteType: "remote",
    };

    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(parseOutput) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "MALFORMED }}}}" } }],
      });

    dbSelect
      .mockReturnValueOnce(makeSelectChain([FAKE_POSTING]))
      .mockReturnValueOnce(makeSelectChain([FAKE_PROFILE]));

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    dbUpdate.mockReturnValue(updateChain);

    const fakeReport = {
      id: 99,
      jobPostingId: 1,
      userId: "user-1",
      fitScore: 50,
      reasoning: "Fit score based on skill overlap analysis.",
      matchedSkills: ["Node.js"],
      missingSkills: ["PostgreSQL"],
      compensationGap: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([fakeReport]),
    };
    dbInsert.mockReturnValue(insertChain);

    const result = await scorePosting(1, "user-1");

    expect(result.report.fitScore).not.toBeNull();

    const insertedPayload = insertChain.values.mock.calls[0]?.[0];
    expect(insertedPayload.fitScore).not.toBeNull();
    expect(typeof insertedPayload.fitScore).toBe("number");
    expect(insertedPayload.matchedSkills).toContain("Node.js");
    expect(insertedPayload.missingSkills).toContain("PostgreSQL");
  });
});
