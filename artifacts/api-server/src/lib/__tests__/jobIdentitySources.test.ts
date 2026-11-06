import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, jobPostingsTable, jobPostingSourcesTable, type JobIdentityEvidence } from "@workspace/db";
import { saveJobIdentitySource } from "../jobIdentitySources";

const state = vi.hoisted(() => ({ values: {} as any, conflict: {} as any, fields: {} as any, conditions: undefined as unknown }));
vi.mock("@workspace/db", () => ({
  jobPostingsTable: { userId: "posting.user", id: "posting.id", jobIdentity: "posting.identity" },
  jobPostingSourcesTable: { userId: "source.user", canonicalUrl: "source.url", jobPostingId: "source.posting", jobIdentity: "source.identity" },
  db: {
    insert: vi.fn(() => ({ values: (value: unknown) => {
      state.values = value;
      return { onConflictDoUpdate: async (value: unknown) => { state.conflict = value; } };
    } })),
    update: vi.fn(() => ({ set: (value: unknown) => {
      state.fields = value;
      return { where: async (conditions: unknown) => { state.conditions = conditions; } };
    } })),
  },
}));
const identity: JobIdentityEvidence = {
  version: 1, status: "verified", reason: "verified_original_posting", observedAt: new Date().toISOString(),
  inputUrl: "https://lensa.com/jobs/copy-a", finalUrl: "https://boards.greenhouse.io/acme/jobs/91001",
  redirectChain: ["https://lensa.com/jobs/copy-a", "https://boards.greenhouse.io/acme/jobs/91001"],
  originalUrl: "https://boards.greenhouse.io/acme/jobs/91001", signals: ["safe_http_destination"],
};
beforeEach(() => { vi.clearAllMocks(); state.values = {}; state.conflict = {}; state.fields = {}; state.conditions = undefined; });
describe("identity source persistence", () => {
  it("saves original provider provenance and promotes only identity metadata, not history", async () => {
    await saveJobIdentitySource({ userId: "owner", postingId: 4, provider: "gmail", url: identity.inputUrl, jobIdentity: identity });
    expect(db.insert).toHaveBeenCalledWith(jobPostingSourcesTable);
    expect(state.values).toMatchObject({ userId: "owner", jobPostingId: 4, url: identity.inputUrl, canonicalUrl: identity.inputUrl, jobIdentity: identity });
    expect(db.update).toHaveBeenCalledWith(jobPostingsTable);
    expect(state.fields).toEqual({ jobIdentity: identity });
    expect(state.conflict.set).not.toHaveProperty("jobPostingId");
    expect(state.conflict.setWhere).toBeDefined();
    expect(state.conflict.set.jobIdentity).toBeDefined();
    expect(state.conditions).toBeDefined();
  });
  it("stores an uncertain observation without erasing an earlier verified identity or modifying a job", async () => {
    const uncertain = { ...identity, status: "uncertain" as const, reason: "http_403", originalUrl: undefined };
    await saveJobIdentitySource({ userId: "owner", postingId: 4, provider: "gmail", url: identity.inputUrl, jobIdentity: uncertain });
    expect(state.values.jobIdentity).toEqual(uncertain);
    expect(state.conflict.set).not.toHaveProperty("jobIdentity");
    expect(state.conflict.set).not.toHaveProperty("jobPostingId");
    expect(db.update).not.toHaveBeenCalled();
  });
});
