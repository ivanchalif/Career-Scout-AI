import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  progress: null as any,
  profile: {} as any,
  page: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ name, userId: {}, createdAt: {}, id: {}, link: {}, canonicalUrl: {} });
  const profiles = table("profiles"), sources = table("sources"), progress = table("progress");
  const postings = table("postings"), postingSources = table("postingSources");
  return {
    userProfilesTable: profiles, onlineDiscoverySourcesTable: sources,
    onlineDiscoveryProgressTable: progress, jobPostingsTable: postings, jobPostingSourcesTable: postingSources,
    db: {
      select: () => ({
        from: (t: any) => ({
          where: () => {
            if (t === sources) return { orderBy: async () => [{
              id: 1, provider: "brave-linkedin", kind: "builtin", name: "LinkedIn",
              url: "https://www.google.com/search?q=jobs", isSuppressed: false,
            }] };
            if (t === profiles) return Promise.resolve([{ ...state.profile, initialized: true }]);
            if (t === progress) return Promise.resolve(state.progress ? [{ state: structuredClone(state.progress) }] : []);
            if (t === postings) return Promise.resolve([{ id: 42, link: "https://example.com/jobs/saved" }]);
            return Promise.resolve([]);
          },
        }),
      }),
      insert: (t: any) => ({
        values: (value: any) => ({
          onConflictDoUpdate: async () => {
            if (t === progress) state.progress = structuredClone(value.state);
          },
        }),
      }),
      update: () => ({
        set: (values: any) => ({
          where: () => ({
            returning: async () => {
              Object.assign(state.profile, values);
              return [state.profile];
            },
          }),
        }),
      }),
      transaction: async (callback: any) => callback({
        insert: (t: any) => ({
          values: (value: any) => ({
            returning: async () => [{ ...value, id: 100 }],
            onConflictDoNothing: () => ({ returning: async () => [{ id: 101 }] }),
          }),
        }),
      }),
    },
  };
});
vi.mock("../sources/googleSearch", () => ({
  fetchGoogleSearchResults: (...args: any[]) => state.search(...args),
  isGoogleSearchUrl: () => true,
}));
vi.mock("../pageScraper", () => ({ fetchJobPageContent: (...args: any[]) => state.page(...args) }));
vi.mock("../responseHistory", () => ({ loadResponseHistory: async () => [] }));
vi.mock("../scoringService", () => ({ scorePostingBackground: vi.fn() }));
vi.mock("../dedup", async importOriginal => ({
  ...await importOriginal<typeof import("../dedup")>(),
  isFuzzyDuplicate: async () => ({ isDuplicate: false }),
}));

import { runOnlineDiscovery } from "../onlineDiscovery";

function candidate(id: string) {
  return {
    provider: "brave:1", sourceJobId: id, url: `https://example.com/jobs/${id}`,
    title: "Product Manager", company: "Example", description: "Roadmaps in Toronto, Canada",
    location: "Toronto, Canada", remote: false, tags: [], postedAt: null,
  };
}

describe("persisted discovery progress and accounting", () => {
  beforeEach(() => {
    state.progress = null;
    state.profile = {
      onlineDiscoverySourcesInitialized: true,
      experienceHistory: [{ title: "Product Manager" }], skills: [],
      locationPreferences: [], remotePreferences: [],
      titleExcludeKeywords: ["Manager"], onlineDiscoveryMinMatchScore: 12,
      onlineDiscoveryFreshnessWindow: "past_month",
    };
    state.search.mockReset().mockResolvedValue([candidate("saved"), candidate("new")]);
    state.page.mockReset().mockResolvedValue({
      finalUrl: candidate("new").url,
      content: "Product Manager at Example in Toronto, Canada",
      metadata: { title: "Product Manager", company: "Example", location: "Toronto, Canada", fieldEvidence: {} },
      availability: { status: "open", checkedAt: new Date(), reason: "test", confidence: 1, evidence: [] },
    });
  });

  it("counts saved jobs, repeats, and real exclusions separately, then skips recently rejected pages", async () => {
    const first = await runOnlineDiscovery("isolated-user");
    expect(first.report).toMatchObject({
      retrieved: 4, alreadySaved: 1, repeated: 2, excluded: 1,
      recentlyChecked: 0, imported: 0, pageChecks: 1, deferred: 0,
    });
    expect(state.page).toHaveBeenCalledTimes(1);
    expect(state.progress.cursors["1"].run).toBe(1);
    expect(state.progress.lastReport).toEqual(first.report);
    const second = await runOnlineDiscovery("isolated-user");
    expect(second.report).toMatchObject({
      retrieved: 4, alreadySaved: 1, repeated: 2, excluded: 0,
      recentlyChecked: 1, pageChecks: 0,
    });
    expect(state.page).toHaveBeenCalledTimes(1);
    expect(state.progress.cursors["1"].run).toBe(2);
    expect(state.search.mock.calls[2][2].offset).toBe(1);
    const r = second.report!;
    expect(r.retrieved).toBe(r.alreadySaved + r.repeated + r.excluded + r.recentlyChecked + r.imported + r.deferred);
  });

  it("reconsiders a rejection immediately after preferences change", async () => {
    await runOnlineDiscovery("isolated-user");
    state.profile.onlineDiscoveryMinMatchScore = 90;
    const second = await runOnlineDiscovery("isolated-user");
    expect(second.report?.recentlyChecked).toBe(0);
    expect(state.page).toHaveBeenCalledTimes(2);
  });

  it("does not cache a network failure as an exclusion", async () => {
    state.page.mockResolvedValue(null);
    await runOnlineDiscovery("isolated-user");
    expect(Object.keys(state.progress.rejected)).toHaveLength(0);
    await runOnlineDiscovery("isolated-user");
    expect(state.page).toHaveBeenCalledTimes(2);
  });

  it("imports a genuinely new match while preserving duplicate protection", async () => {
    state.profile.titleExcludeKeywords = [];
    const result = await runOnlineDiscovery("isolated-user");
    expect(result.report).toMatchObject({
      retrieved: 4, alreadySaved: 1, repeated: 2, imported: 1, excluded: 0,
    });
    expect(result.imported).toBe(1);
    expect(state.progress.lastReport.imported).toBe(1);
  });

  it("does not import a posting that redirects to a company job board", async () => {
    state.profile.titleExcludeKeywords = [];
    state.page.mockResolvedValue({
      finalUrl: "https://jobs.lever.co/example",
      content: "Example careers and open positions",
      metadata: null,
      availability: { status: "unverified", checkedAt: new Date(), reason: "no_job_metadata", confidence: 0, evidence: [] },
    });
    const result = await runOnlineDiscovery("isolated-user");
    expect(result.imported).toBe(0);
    expect(result.report?.excluded).toBe(1);
  });
});
