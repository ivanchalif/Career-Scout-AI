import { describe, expect, it } from "vitest";
import { evaluateResponses, isWorkdayListing, type ResponseExample } from "../responseLearning";

const candidate = {
  title: "Product Manager", company: "New Company",
  location: "Toronto, Ontario", link: "https://new.example/jobs/1",
};
const example = (kind: string, company = "Past Company", overrides: Partial<ResponseExample> = {}): ResponseExample => ({
  kind, title: "Product Manager", company, location: "Toronto, Ontario",
  link: `https://past.example/${company.replaceAll(" ", "-")}`, ...overrides,
});

describe("learning from job responses", () => {
  it.each(["applied", "more_like_this"])("favors similar roles after %s, without changing AI fit", (kind) => {
    const result = evaluateResponses(candidate, [example(kind)]);
    expect(result.adjustment).toBeGreaterThan(0);
    expect(result.suppress).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(evaluateResponses(candidate, []).adjustment).toBe(0);
  });

  it("treats one explicit dislike as a modest ranking preference, not an exclusion", () => {
    expect(evaluateResponses(candidate, [example("not_my_role")])).toMatchObject({ adjustment: -8, suppress: false });
  });

  it("filters a repeated specific mismatch but not unrelated roles", () => {
    const history = [example("not_my_role", "One"), example("not_my_role", "Two")];
    expect(evaluateResponses(candidate, history)).toMatchObject({ adjustment: -16, suppress: true });
    expect(evaluateResponses({ ...candidate, title: "Software Engineer" }, history)).toMatchObject({ adjustment: 0, suppress: false });
    expect(evaluateResponses({ ...candidate, title: "Product Designer" }, history).suppress).toBe(false);
  });

  it("does not count mirrors of a single dismissed listing as independent evidence", () => {
    const history = [example("not_my_role"), example("not_my_role", "Past Company", { link: "https://mirror.example/jobs/99" })];
    expect(evaluateResponses(candidate, history)).toMatchObject({ adjustment: -8, suppress: false });
  });

  it("does not suppress a pattern with conflicting positive responses", () => {
    const history = [example("not_my_role", "One"), example("not_my_role", "Two"), example("applied", "Three")];
    expect(evaluateResponses(candidate, history).suppress).toBe(false);
  });

  it.each(["dismissed", "duplicate"])("uses %s only to suppress repeat listings, never similar roles", (kind) => {
    const history = [example(kind)];
    expect(evaluateResponses(candidate, history)).toMatchObject({ adjustment: 0, suppress: false });
    expect(evaluateResponses({ ...candidate, link: history[0].link }, history)).toMatchObject({ adjustment: 0, suppress: true });
  });

  it("uses duplicate-marked applications as identity evidence, not repeated positive training examples", () => {
    expect(evaluateResponses(candidate, [example("duplicate"), example("duplicate", "Other")]).adjustment).toBe(0);
  });

  it("requires known, matching locations and related roles for location feedback", () => {
    const history = [example("wrong_location", "One"), example("wrong_location", "Two")];
    expect(evaluateResponses(candidate, history).suppress).toBe(true);
    expect(evaluateResponses({ ...candidate, location: null }, history)).toMatchObject({ adjustment: 0, suppress: false });
    expect(evaluateResponses({ ...candidate, location: "Remote" }, history).suppress).toBe(false);
    expect(evaluateResponses({ ...candidate, location: "Vancouver, BC" }, history).suppress).toBe(false);
    expect(evaluateResponses({ ...candidate, title: "Software Engineer" }, history).suppress).toBe(false);
  });

  it("never turns country-only feedback into a broad geographic exclusion", () => {
    const history = [example("wrong_location", "One", { location: "United States" }), example("wrong_location", "Two", { location: "United States" })];
    expect(evaluateResponses({ ...candidate, location: "United States" }, history)).toMatchObject({ adjustment: 0, suppress: false });
  });

  it("applies Workday feedback only to a verified Workday host, not an entire company or role", () => {
    const history = [example("workday", "One"), example("workday", "Two")];
    const workday = evaluateResponses({ ...candidate, link: "https://company.wd5.myworkdayjobs.com/en-US/jobs/job/1" }, history);
    expect(workday.suppress).toBe(false);
    expect(workday.adjustment).toBeLessThan(0);
    expect(evaluateResponses(candidate, history)).toMatchObject({ adjustment: 0, suppress: false });
    expect(evaluateResponses({ ...candidate, company: "Workday", title: "Workday Product Manager" }, history).suppress).toBe(false);
    expect(isWorkdayListing("https://myworkdayjobs.com.evil.example/job")).toBe(false);
    expect(isWorkdayListing("https://example.com/myworkdayjobs.com")).toBe(false);
  });

  it("applies Already closed only to the specific listing, not another opening at that company", () => {
    const history = [example("already_closed", candidate.company, { link: candidate.link })];
    expect(evaluateResponses(candidate, history).suppress).toBe(true);
    expect(evaluateResponses({ ...candidate, link: "https://new.example/jobs/2" }, history)).toMatchObject({ adjustment: 0, suppress: false });
    expect(evaluateResponses({ ...candidate, link: null }, history).suppress).toBe(false);
  });

  it("preserves job IDs while ignoring URL tracking when recognizing closed listings", () => {
    const history = [example("already_closed", "One", { link: "https://jobs.example/view?jobId=42&utm_source=email" })];
    expect(evaluateResponses({ ...candidate, link: "https://jobs.example/view?jobId=42&utm_source=search" }, history).suppress).toBe(true);
    expect(evaluateResponses({ ...candidate, link: "https://jobs.example/view?jobId=43" }, history).suppress).toBe(false);
  });

  it("undoing a reason removes a repeated-pattern filter on the next import", () => {
    const history = [example("not_my_role", "One"), example("not_my_role", "Two")];
    expect(evaluateResponses(candidate, history).suppress).toBe(true);
    expect(evaluateResponses(candidate, [history[0], example("dismissed", "Two")]).suppress).toBe(false);
  });

  it("bounds aggregate influence and reduces old feedback instead of permanently excluding a role", () => {
    const now = new Date("2026-10-20T00:00:00Z").getTime();
    const old = [example("not_my_role", "One", { at: "2023-01-01" }), example("not_my_role", "Two", { at: "2023-01-01" })];
    expect(evaluateResponses(candidate, old, now).suppress).toBe(false);
    expect(evaluateResponses(candidate, old, now).adjustment).toBe(-4);
    const many = Array.from({ length: 100 }, (_, index) => example("not_my_role", `Company ${index}`));
    expect(evaluateResponses(candidate, many).adjustment).toBe(-20);
    expect(evaluateResponses(candidate, many.map((row) => ({ ...row, kind: "applied" }))).adjustment).toBe(12);
  });
});
