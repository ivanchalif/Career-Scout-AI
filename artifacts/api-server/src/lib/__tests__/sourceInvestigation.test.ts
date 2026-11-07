import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  sources: [] as any[], postings: [] as any[], profiles: [] as any[], progress: [] as any[],
  provenance: [] as any[], feedback: [] as any[],
}));
vi.mock("drizzle-orm", async original => ({
  ...await original<any>(),
  eq: (field: any, value: any) => ({ field: field.name, value }),
  and: (...conditions: any[]) => conditions,
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<any>();
  return { ...actual, db: { select: () => ({ from: (table: any) => ({ where: async (conditions: any) => {
    const rows = table === actual.onlineDiscoverySourcesTable ? state.sources
      : table === actual.userProfilesTable ? state.profiles
      : table === actual.jobPostingsTable ? state.postings
      : table === actual.onlineDiscoveryProgressTable ? state.progress
      : table === actual.jobPostingSourcesTable ? state.provenance : state.feedback;
    return rows.filter(row => (Array.isArray(conditions) ? conditions : [conditions])
      .every((condition: any) => row[condition.field === "user_id" ? "userId" : condition.field] === condition.value));
  } }) }) } };
});
vi.mock("../onlineDiscovery", () => ({
  buildDiscoveryCriteria: vi.fn(() => ({ roleTitles: ["Product Manager"], skills: [] })),
  fetchConfiguredSource: vi.fn(async () => [] as any[]),
}));
import { fetchConfiguredSource } from "../onlineDiscovery";
import { investigateSource, SourceInvestigationBusyError } from "../sourceInvestigation";

beforeEach(() => {
  vi.clearAllMocks();
  state.sources = [{
    id: 1, userId: "owner", name: "Example", provider: "custom", kind: "custom",
    url: "https://example.com/jobs", isSuppressed: false, updatedAt: new Date(),
  }];
  state.postings = []; state.profiles = []; state.provenance = []; state.feedback = [];
  state.progress = [{ userId: "owner", state: { cursors: { "1": { signature: "old", run: 2 } }, rejected: {} } }];
  vi.mocked(fetchConfiguredSource).mockResolvedValue([]);
});
describe("read-only source investigation", () => {
  it("checks user ownership before making external requests", async () => {
    expect(await investigateSource("foreign", 1)).toBeNull();
    expect(fetchConfiguredSource).not.toHaveBeenCalled();
  });
  it("probes cloned progress and never imports or mutates discovery state", async () => {
    vi.mocked(fetchConfiguredSource).mockImplementation(async (_source, _criteria, progress) => {
      progress.cursors["1"].run = 100;
      return [{
        provider: "custom:1", sourceJobId: "x", title: "Product Manager", company: "Example",
        description: "Role", url: "https://example.com/jobs/x", location: "San Francisco",
        remote: false, tags: [], postedAt: null,
      }];
    });
    const result = await investigateSource("owner", 1);
    expect(result?.probe).toMatchObject({ status: "ok", retrieved: 1, unseen: 1, eligibleBySavedFilters: 1, knownPostingDates: 0 });
    expect(state.progress[0].state.cursors["1"].run).toBe(2);
    expect(state.postings).toEqual([]);
  });
  it("returns technical failure evidence and releases the investigation lock for retry", async () => {
    vi.mocked(fetchConfiguredSource).mockRejectedValueOnce(new Error("HTTP 403"));
    expect((await investigateSource("owner", 1))?.probe).toMatchObject({ status: "failed", error: "HTTP 403" });
    expect((await investigateSource("owner", 1))?.probe.status).toBe("ok");
  });
  it("prevents overlapping probes for the same user", async () => {
    let release!: () => void;
    const wait = new Promise<any[]>(resolve => { release = () => resolve([]); });
    vi.mocked(fetchConfiguredSource).mockReturnValueOnce(wait);
    const first = investigateSource("owner", 1);
    await expect(investigateSource("owner", 1)).rejects.toBeInstanceOf(SourceInvestigationBusyError);
    release();
    await first;
  });
});
