import { describe, expect, it } from "vitest";
import {
  buildFocusedSearchQueries,
  compareCandidateRecency,
  scoreCandidateForDiscovery,
  type DiscoveryCriteria,
} from "../onlineDiscovery";
import { parseGoogleSearchResults } from "../sources/googleSearch";

const criteria: DiscoveryCriteria = {
  roleTitles: ["Product Manager", "Product Designer"],
  skills: ["roadmapping"],
  locations: ["Toronto, Canada", "New York, United States"],
  remotePreferences: ["remote"],
};

describe("focused online discovery searches", () => {
  it("generates bounded role/location searches and rotates selections", () => {
    const first = buildFocusedSearchQueries("linkedin.com/jobs/view", criteria, 0);
    const rotated = buildFocusedSearchQueries("linkedin.com/jobs/view", criteria, 1);

    expect(first).toHaveLength(2);
    expect(first[0]).toContain('site:linkedin.com/jobs/view "Product Manager" "Toronto, Canada"');
    expect(first.join(" ")).not.toMatch(/United States.*OR.*Canada|remote OR/i);
    expect(rotated).not.toEqual(first);
    expect(buildFocusedSearchQueries("example.com/jobs", {
      ...criteria,
      roleTitles: [],
      skills: [],
    })).toEqual([]);
  });

  it("does not turn query terms into listing location or remote metadata", () => {
    const results = parseGoogleSearchResults(
      '<a href="https://jobs.example.com/jobs/123">Product Manager at Example Co</a>',
      "https://www.google.com/search?q=remote+Toronto",
      "brave:test",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ location: null, remote: false, postedAt: null });
  });

  it("prefers a known recent posting without excluding unknown dates", () => {
    const recent = { postedAt: new Date("2025-02-03T00:00:00Z") };
    const old = { postedAt: new Date("2024-01-01T00:00:00Z") };
    const unknown = { postedAt: null };
    expect(compareCandidateRecency(recent, old)).toBeLessThan(0);
    expect(compareCandidateRecency(old, unknown)).toBeLessThan(0);
    expect(compareCandidateRecency(unknown, unknown)).toBe(0);
  });

  it("re-scores final listing title and authentic date while lowering, not rejecting, unknown location", () => {
    const candidate = {
      provider: "brave:test",
      sourceJobId: "role-1",
      title: "Senior Product Manager",
      company: "Example Co",
      description: "Build product roadmaps.",
      url: "https://example.com/jobs/1",
      location: null,
      remote: false,
      tags: [],
      postedAt: new Date("2025-02-03T00:00:00Z"),
    };
    const profile = { titleExcludeKeywords: [], companyFilterSettings: { mode: "off", companies: [] } };
    const finalCriteria: DiscoveryCriteria = {
      roleTitles: ["Senior Product Manager"],
      skills: [],
      locations: ["Toronto, Canada"],
      remotePreferences: ["remote"],
    };
    const options = {
      remoteKnown: false,
      freshnessWindow: "past_week",
      now: new Date("2025-02-05T00:00:00Z").getTime(),
    };
    const recentScore = scoreCandidateForDiscovery(candidate, finalCriteria, profile, options);
    const unknownDateScore = scoreCandidateForDiscovery({ ...candidate, postedAt: null }, finalCriteria, profile, options);
    const verifiedLocationScore = scoreCandidateForDiscovery({
      ...candidate,
      location: "Toronto, Canada",
    }, finalCriteria, profile, options);

    expect(recentScore).toBeGreaterThan(unknownDateScore!);
    expect(verifiedLocationScore).toBeGreaterThan(recentScore!);
    expect(unknownDateScore).not.toBeNull();
    expect(scoreCandidateForDiscovery({ ...candidate, title: "Staff Accountant" }, finalCriteria, profile, options)).toBeNull();
    expect(scoreCandidateForDiscovery({ ...candidate, location: "Berlin, Germany" }, finalCriteria, profile, options)).toBeNull();
  });
});