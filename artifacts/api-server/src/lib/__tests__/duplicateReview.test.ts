import { describe, expect, it } from "vitest";
import { findDuplicateReviews } from "../duplicateReview";
import { compareJobs, pairKey } from "../duplicatePolicy";

const posting = (id: number, overrides = {}) => ({
  id, company: `Employer ${id}`, title: "Senior Product Manager AI",
  appliedAt: null as Date | null, deletedAt: null as Date | null, closedAt: null,
  link: null as string | null, ...overrides,
});

describe("indexed duplicate review", () => {
  it("offers exact active copies for review but skips exact applied/dismissed matches", async () => {
    const a = posting(1, { company: "Acme" });
    const b = posting(2, { company: "Acme" });
    const pairs = await findDuplicateReviews([a, b], new Set());
    expect(pairs).toHaveLength(1);
    expect(pairs[0].decision.kind).toBe("review");
    expect(pairs[0].decision.evidence).toContain("Both jobs are active — user review required");
    expect(await findDuplicateReviews([a, { ...b, appliedAt: new Date() }], new Set())).toEqual([]);
    expect(await findDuplicateReviews([a, { ...b, deletedAt: new Date() }], new Set())).toEqual([]);
    expect(await findDuplicateReviews([a, b], new Set(["1:2"]))).toEqual([]);
  });
  it("matches exhaustive review decisions and historical ordering", async () => {
    const jobs = [
      posting(1, { company: "Acme Inc." }), posting(2, { company: "Acme", appliedAt: new Date() }),
      posting(3, { company: "Acme", deletedAt: new Date() }),
      posting(4, { link: "https://jobs.lever.co/other/123" }),
      posting(5, { link: "https://jobs.lever.co/other/123", appliedAt: new Date() }),
      posting(6, { company: "Different" }),
    ];
    const exceptions = new Set([pairKey(1, 2)]);
    const results = await findDuplicateReviews(jobs, exceptions);
    expect(results.map(({ a, b, decision }) => [a.id, b.id, decision])).toEqual([
      [1, 3, compareJobs(jobs[0], jobs[2])],
      [4, 5, compareJobs(jobs[3], jobs[4])],
    ]);
  });

  it("keeps verified cross-employer identities eligible", async () => {
    const originalUrl = "https://jobs.lever.co/acme/original";
    const a = posting(1, { jobIdentity: { version: 1, status: "verified", originalUrl, signals: [] } });
    const b = posting(2, { link: originalUrl, deletedAt: new Date() });
    expect((await findDuplicateReviews([a, b], new Set()))[0]?.decision.kind).toBe("duplicate");
  });

  it("processes a large unrelated history without quadratic comparisons and yields to other requests", async () => {
    const jobs = Array.from({ length: 4000 }, (_, id) => posting(id + 1, id % 2 ? { appliedAt: new Date() } : {}));
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const start = performance.now();
    expect(await findDuplicateReviews(jobs, new Set())).toEqual([]);
    expect(yielded).toBe(true);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
