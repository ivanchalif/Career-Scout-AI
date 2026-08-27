import { describe, expect, it } from "vitest";
import { htmlToPlainText, parseArbeitnowPayload } from "../sources/arbeitnow";
import { blockedKeywordForCandidate, isUsOrCanadaCandidate, matchesOnlineEmailCriteria, rankCandidate } from "../onlineDiscovery";

const candidate = (overrides: Partial<{
  location: string | null;
  remote: boolean;
  description: string;
}> = {}) => ({
  provider: "arbeitnow" as const,
  sourceJobId: "role-1",
  title: "Senior Product Manager",
  company: "Example Co",
  description: "Own product strategy and roadmaps.",
  url: "https://example.com/jobs/role-1",
  location: "New York, NY",
  remote: false,
  tags: ["Product Management"],
  postedAt: null,
  ...overrides,
});

describe("Arbeitnow source adapter", () => {
  it("normalizes valid feed records and ignores unusable entries", () => {
    const jobs = parseArbeitnowPayload({
      data: [
        {
          slug: "principal-product-manager-123",
          title: "Principal Product Manager",
          company_name: "Example Co",
          description: "<p>Build <strong>great</strong> products.</p>",
          url: "https://jobs.example.com/roles/123?utm_source=arbeitnow",
          location: "Remote - United States",
          remote: true,
          tags: ["Product", "SaaS"],
          created_at: 1_700_000_000,
        },
        { title: "Missing company", url: "https://example.com" },
      ],
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "arbeitnow",
      sourceJobId: "principal-product-manager-123",
      title: "Principal Product Manager",
      company: "Example Co",
      remote: true,
      tags: ["Product", "SaaS"],
    });
    expect(jobs[0]?.description).toContain("Build great products.");
  });

  it("converts job HTML into readable plain text", () => {
    expect(htmlToPlainText("<script>ignore()</script><p>Hello&nbsp;world</p><ul><li>One</li></ul>"))
      .toBe("Hello world\nOne");
  });

  it("limits online discovery to US and Canadian jobs", () => {
    expect(isUsOrCanadaCandidate(candidate())).toBe(true);
    expect(isUsOrCanadaCandidate(candidate({ location: "Toronto, Canada" }))).toBe(true);
    expect(isUsOrCanadaCandidate(candidate({ location: "Remote - United States", remote: true }))).toBe(true);
    expect(isUsOrCanadaCandidate(candidate({ location: "Berlin, Germany" }))).toBe(false);
    expect(isUsOrCanadaCandidate(candidate({ location: "Remote", remote: true, description: "Remote worldwide role." }))).toBe(false);
  });

  it("uses the same profile exclusions and blocked-description screening", () => {
    const usCandidate = candidate();
    expect(rankCandidate(usCandidate, {
      roleTitles: ["Senior Product Manager"],
      skills: ["Product Management"],
      locations: [],
      remotePreferences: [],
    }, { titleExcludeKeywords: ["contract"], companyFilterSettings: { mode: "off", companies: [] } })).toBeGreaterThan(0);
    expect(rankCandidate(candidate({ location: "London, UK" }), {
      roleTitles: ["Senior Product Manager"],
      skills: ["Product Management"],
      locations: [],
      remotePreferences: [],
    }, { titleExcludeKeywords: [], companyFilterSettings: { mode: "off", companies: [] } })).toBeNull();
    expect(blockedKeywordForCandidate(candidate({ description: "This is a contract-to-hire opportunity." }), ["contract-to-hire"]))
      .toBe("contract-to-hire");
  });

  it("treats San Francisco and SF Bay Area as equivalent locations", () => {
    expect(rankCandidate(candidate({ location: "San Francisco, United States" }), {
      roleTitles: ["Senior Product Manager"],
      skills: ["Product Management"],
      locations: ["SF Bay Area", "remote"],
      remotePreferences: ["hybrid", "onsite"],
    }, { titleExcludeKeywords: [], companyFilterSettings: { mode: "off", companies: [] } })).toBeGreaterThan(0);
  });

  it("ignores email-envelope include terms but preserves blocked-body exclusions online", () => {
    const usCandidate = candidate({ description: "Build product roadmaps and lead discovery." });
    expect(matchesOnlineEmailCriteria(usCandidate, {
      subjectKeywords: ["job"],
      fromAddresses: ["jobalert@example.com"],
      bodyKeywords: ["opportunity"],
      blockedBodyKeywords: [],
    })).toBe(true);
    expect(matchesOnlineEmailCriteria(usCandidate, {
      subjectKeywords: ["job"],
      fromAddresses: ["jobalert@example.com"],
      bodyKeywords: ["opportunity"],
      blockedBodyKeywords: ["roadmaps"],
    })).toBe(false);
  });
});