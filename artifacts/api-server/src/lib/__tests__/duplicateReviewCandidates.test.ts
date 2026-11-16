import { describe, expect, it } from "vitest";
import { findDuplicateReviews } from "../duplicateReview";
import type { HistoricalPosting } from "../duplicateVisibility";

const description = "Design build deploy scalable payment platforms and collaborate with customers ".repeat(12);
const posting = (id: number, overrides: Partial<HistoricalPosting> = {}): HistoricalPosting => ({
  id, title: "Senior Software Engineer Payments", company: "Acme",
  appliedAt: null, deletedAt: null, closedAt: null, fullDescription: description, ...overrides,
});
const summarize = (pairs: Awaited<ReturnType<typeof findDuplicateReviews>>) =>
  pairs.map(({ a, b, decision }) => ({ a: a.id, b: b.id, decision }));

async function optimized(jobs: HistoricalPosting[], exceptions = new Set<string>(), subjects?: Set<number>) {
  const reads: number[][] = [];
  const byId = new Map(jobs.map(job => [job.id, job]));
  const metadata = jobs.map(({ fullDescription: _, ...job }) => job);
  const pairs = await findDuplicateReviews(metadata, exceptions, 40, subjects, async ids => {
    reads.push(ids);
    return ids.map(id => ({ id, fullDescription: byId.get(id)!.fullDescription ?? "" }));
  });
  return { pairs: summarize(pairs), reads };
}

describe("description candidate retrieval", () => {
  it("preserves complete ordered warnings and evidence across mixed histories and scopes", async () => {
    const originalUrl = "https://jobs.lever.co/acme/original";
    const verified = {
      version: 1 as const, status: "verified" as const, originalUrl, signals: ["Original posting"],
      reason: "", observedAt: "", inputUrl: "", finalUrl: "", redirectChain: [],
    };
    const jobs = [
      posting(1), posting(2), posting(3), // odd group
      posting(4, { appliedAt: new Date(), location: "New York" }), // discrepancy must still load evidence
      posting(5, { deletedAt: new Date(), dismissalReason: "duplicate" }),
      posting(6, { deletedAt: new Date(), deletedBy: "duplicate" }),
      posting(7, { closedAt: new Date() }),
      posting(8, { company: "ACME, Inc.", title: "Sr Software Engineer Payments" }),
      posting(9, { company: "Cross employer A", jobIdentity: verified }),
      posting(10, { company: "Cross employer B", link: originalUrl, appliedAt: new Date() }),
      posting(11, { company: "Description only", title: "Software Engineer" }),
      posting(12, { company: "Description only", title: "Software Engineering Engineer" }),
      posting(13, { company: "Conflict", link: "https://jobs.lever.co/conflict/one" }),
      posting(14, { company: "Conflict", link: "https://jobs.lever.co/conflict/two", title: "Sr Software Engineer Payments" }),
      posting(15, { company: "Description discrepancy", appliedAt: new Date() }),
      posting(16, { company: "Description discrepancy", fullDescription: "Hiring accounting tax audit financial analyst ".repeat(30) }),
      posting(17, { company: "ＡＣＭＥ LLC", title: "Sr Software Engineer Payments" }),
      posting(18, { company: "Uncertain identity", jobIdentity: { ...verified, status: "uncertain" } }),
    ];
    for (const exceptions of [new Set<string>(), new Set(["1:4", "2:4", "9:10", "1:3"])]) {
      for (const scope of [undefined, new Set([1, 3, 8, 9, 11, 13, 16, 17, 18]), new Set([999])]) {
        const baseline = summarize(await findDuplicateReviews(jobs, exceptions, 40, scope));
        expect((await optimized(jobs, exceptions, scope)).pairs).toEqual(baseline);
      }
    }
    expect((await optimized(jobs, new Set(), new Set([16]))).pairs[0].decision.evidence)
      .toContain("Substantially different role descriptions");
  });

  it("keeps description-supported generic title matches that metadata alone cannot prove", async () => {
    const jobs = [
      posting(1, { title: "Senior Software Engineer" }),
      posting(2, { title: "Senior Software Engineer II" }),
    ];
    const baseline = summarize(await findDuplicateReviews(jobs, new Set()));
    expect(baseline).toHaveLength(1);
    expect(baseline[0].decision.evidence).toContain("Closely matching job descriptions");
    expect((await optimized(jobs)).pairs).toEqual(baseline);
  });

  it("continues past an entirely distinct description batch without losing a late match", async () => {
    const jobs = [
      posting(1, { title: "Senior Software Engineer" }),
      ...Array.from({ length: 120 }, (_, i) => posting(i + 2, {
        title: "Senior Software Engineer II",
        fullDescription: i === 119 ? description : "Accounting audit financial tax ".repeat(30),
      })),
    ];
    const subjects = new Set([1]);
    const result = await optimized(jobs, new Set(), subjects);
    expect(result.pairs).toEqual(summarize(await findDuplicateReviews(jobs, new Set(), 40, subjects)));
    expect(result.pairs[0].b).toBe(121);
    expect(result.reads).toHaveLength(4);
    expect(result.reads.every(ids => ids.length <= 50)).toBe(true);
    expect(new Set(result.reads.flat()).size).toBe(result.reads.flat().length);
  });

  it("fails explicitly if evidence loading fails or a candidate disappears", async () => {
    const jobs = [posting(1), posting(2)];
    await expect(findDuplicateReviews(jobs, new Set(), 40, undefined, async () => {
      throw new Error("Database unavailable");
    })).rejects.toThrow("Database unavailable");
    await expect(findDuplicateReviews(jobs, new Set(), 40, undefined, async () => []))
      .rejects.toThrow("candidates changed");
  });

  it("matches the existing helper across varied metadata, description and exception combinations", async () => {
    // Deterministic permutations exercise every early policy exit without flaky
    // random coverage or any dependency on a shared account's saved jobs.
    const companies = ["Acme", "ACME Inc.", "ＡＣＭＥ LLC", "Other", "", "Unknown"];
    const titles = ["Senior Software Engineer", "Sr Software Engineer II", "Senior Software Engineer Payments", "Junior Accountant"];
    const links = [null, "https://jobs.lever.co/acme/one", "https://jobs.lever.co/acme/two",
      "https://www.linkedin.com/jobs/view/123?trk=email", "https://linkedin.com/jobs/view/123"];
    for (let seed = 0; seed < 8; seed++) {
      const jobs = Array.from({ length: 80 }, (_, i) => posting(i + 1, {
        company: companies[(i + seed) % companies.length],
        title: titles[(Math.floor(i / 3) + seed) % titles.length],
        link: links[(Math.floor(i / 2) + seed) % links.length],
        fullDescription: i % 3 === 0 ? "" : i % 3 === 1 ? description : "Accounting tax financial auditing ".repeat(30),
        location: i % 4 === 0 ? "New York" : i % 4 === 1 ? "Remote" : null,
        appliedAt: i % 7 === 0 ? new Date() : null,
        deletedAt: i % 11 === 0 ? new Date() : null,
        deletedBy: i % 22 === 0 ? "duplicate" : null,
        dismissalReason: i % 33 === 0 ? "duplicate" : null,
        closedAt: i % 13 === 0 ? new Date() : null,
      }));
      const exceptions = new Set(["1:2", "3:4", "7:8", "1:15"]);
      for (const scope of [undefined, new Set([2, 4, 8, 16, 32, 64])]) {
        expect((await optimized(jobs, exceptions, scope)).pairs)
          .toEqual(summarize(await findDuplicateReviews(jobs, exceptions, 40, scope)));
      }
    }
  });

  it("yields during a large same-employer metadata rejection scan without fetching descriptions", async () => {
    const jobs = [
      posting(1, { title: "Senior Software Engineer" }),
      ...Array.from({ length: 6000 }, (_, i) => posting(i + 2, { title: "Junior Accountant" })),
    ];
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      const result = await optimized(jobs, new Set(), new Set([1]));
      expect(result.pairs).toEqual([]);
      expect(result.reads).toEqual([]);
      expect(ticks).toBeGreaterThan(1);
    } finally {
      clearInterval(timer);
    }
  });

  it.each(["unrelated roles", "same titles"])("benchmarks a large same-employer history with %s", async mode => {
    const jobs = Array.from({ length: 12_000 }, (_, i) => posting(i + 1, {
      title: mode === "same titles" || i < 2 ? "Senior Software Engineer Payments" : `Junior Accountant ${i}`,
      fullDescription: description.repeat(6),
    }));
    const subjects = new Set([1]);
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const baselineStart = performance.now();
    const baseline = summarize(await findDuplicateReviews(jobs, new Set(), 40, subjects));
    const baselineMs = performance.now() - baselineStart;
    const start = performance.now();
    const result = await optimized(jobs, new Set(), subjects);
    const candidateMs = performance.now() - start;
    expect(result.pairs).toEqual(baseline);
    expect(yielded).toBe(true);
    const fetchedCount = result.reads.flat().length;
    expect(fetchedCount).toBeLessThanOrEqual(mode === "same titles" ? 50 : 2);
    expect(candidateMs).toBeLessThan(5000);
    console.info(JSON.stringify({
      benchmark: `12000 same-employer jobs: ${mode}`, baselineMs, candidateMs,
      baselineDescriptionBytes: jobs.length * Buffer.byteLength(jobs[0].fullDescription!),
      candidateDescriptionBytes: fetchedCount * Buffer.byteLength(jobs[0].fullDescription!),
      fetchedCount, queries: result.reads.length,
    }));
  }, 15_000);
});
