import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { fetchJobPageContent, type PageResult } from "../pageScraper";
import { checkJobLink, missingJobFields, scheduleJobLinkChecks } from "../jobLinkHealth";

vi.mock("drizzle-orm", () => ({
  eq: (field: unknown, value: unknown) => ({ field, value }),
  and: (...conditions: unknown[]) => conditions,
  isNull: (field: unknown) => ({ null: field }),
}));
vi.mock("@workspace/db", () => ({
  db: { update: vi.fn() },
  jobPostingsTable: { id: "id", userId: "userId", link: "link", closedAt: "closedAt", deletedAt: "deletedAt" },
}));
vi.mock("../pageScraper", () => ({ fetchJobPageContent: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

const checkedAt = new Date();
const posting = { id: 1, userId: "test-owner", link: "https://example.com/job/1", closedAt: null, deletedAt: null, availabilityCheckedAt: null };
const page = (reason = "http_404", status = "closed"): PageResult => ({
  content: "", finalUrl: posting.link, contentUsable: false, metadata: null,
  availability: { reason, status: status as PageResult["availability"]["status"], checkedAt, confidence: 1, evidence: [reason] },
});
const where = vi.fn();
const set = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  where.mockResolvedValue([]);
  set.mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as never);
  vi.mocked(fetchJobPageContent).mockResolvedValue(page());
});

describe("automatic missing-job closure", () => {
  it.each(["explicit_job_closed", "explicit_job_unavailable", "explicit_posting_expired", "explicit_position_filled", "explicit_applications_closed", "jsonld_valid_through_expired"])("persists %s as recoverably closed", async (reason) => {
    vi.mocked(fetchJobPageContent).mockResolvedValue(page(reason));
    await checkJobLink(posting);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      closedAt: checkedAt, availabilityStatus: "closed", availabilityReason: reason, availabilityEvidence: [reason],
    }));
    expect(set.mock.calls[0][0]).not.toHaveProperty("deletedAt");
  });
  it("closes a missing job, recording evidence without deletion or negative feedback", async () => {
    await checkJobLink(posting);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ closedAt: checkedAt, availabilityStatus: "closed", availabilityReason: "http_404" }));
    expect(set.mock.calls[0][0]).not.toHaveProperty("deletedAt");
    expect(where).toHaveBeenCalledWith([
      { field: "id", value: 1 }, { field: "userId", value: "test-owner" },
      { field: "link", value: posting.link }, { null: "closedAt" }, { null: "deletedAt" },
    ]);
  });
  it.each(["http_403", "http_429", "http_500", "timeout", "login wall"])("does not close for %s", async (reason) => {
    vi.mocked(fetchJobPageContent).mockResolvedValue(page(reason, "unverified"));
    await checkJobLink(posting);
    expect(set.mock.calls[0][0]).not.toHaveProperty("closedAt");
    expect(missingJobFields(page(reason, "unverified"))).toEqual({});
  });
  it("does not fetch absent links or deleted/closed jobs", async () => {
    await checkJobLink({ ...posting, link: null });
    await checkJobLink({ ...posting, closedAt: new Date() });
    await checkJobLink({ ...posting, deletedAt: new Date() });
    expect(fetchJobPageContent).not.toHaveBeenCalled();
  });
  it("deduplicates queued checks and skips recently checked links", async () => {
    scheduleJobLinkChecks([posting, posting, { ...posting, id: 2, availabilityCheckedAt: new Date() }]);
    await vi.waitFor(() => expect(where).toHaveBeenCalledTimes(1));
    expect(fetchJobPageContent).toHaveBeenCalledTimes(1);
  });
});
