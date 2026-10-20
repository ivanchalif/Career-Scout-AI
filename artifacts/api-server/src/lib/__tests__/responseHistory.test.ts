import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  jobPostingsTable: { id: "id", userId: "posting.userId", title: "title", company: "company", location: "location", link: "link", extractedSkills: "skills", appliedAt: "applied", deletedAt: "deleted", deletedBy: "deletedBy", closedAt: "closed", createdAt: "created" },
  jobPostingFeedbackTable: { jobPostingId: "feedback.postingId", userId: "feedback.userId", kind: "kind", createdAt: "feedback.created" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  eq: (field: unknown, value: unknown) => ({ field, value }),
  isNotNull: (field: unknown) => ({ notNull: field }),
  desc: (field: unknown) => field,
  sql: (_strings: unknown, ...values: unknown[]) => values,
}));
import { db } from "@workspace/db";
import { loadResponseHistory } from "../responseHistory";

const recent = new Date("2026-10-20T00:00:00Z");
const row = { title: "Product Manager", company: "Example", location: null, link: null, skills: [],
  appliedAt: null as Date | null, deletedAt: null as Date | null, closedAt: null as Date | null,
  deletedBy: null as string | null, feedbackKind: null as string | null, feedbackAt: null as Date | null, actionAt: recent };
let rows: typeof row[];
const where = vi.fn();
const leftJoin = vi.fn();
const limit = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  const chain = { from: () => chain, leftJoin: (...args: unknown[]) => { leftJoin(...args); return chain; },
    where: (...args: unknown[]) => { where(...args); return chain; }, orderBy: () => chain,
    limit: (count: number) => { limit(count); return Promise.resolve(rows); } };
  vi.mocked(db.select).mockReturnValue(chain as unknown as ReturnType<typeof db.select>);
});

describe("current response history", () => {
  it("scopes both postings and joined feedback to the authenticated user", async () => {
    await loadResponseHistory("owner");
    expect(JSON.stringify(where.mock.calls)).toContain('"field":"posting.userId","value":"owner"');
    expect(JSON.stringify(leftJoin.mock.calls)).toContain('"field":"feedback.userId","value":"owner"');
    expect(limit).toHaveBeenCalledWith(500);
  });

  it("uses applied state and removes that signal after unapplying", async () => {
    rows = [{ ...row, appliedAt: recent }];
    expect(await loadResponseHistory("owner")).toMatchObject([{ kind: "applied", excludeExact: true }]);
    rows = [{ ...row }];
    expect(await loadResponseHistory("owner")).toEqual([]);
  });

  it("keeps generic dismissals neutral and distinguishes user duplicates from automatic sweeps", async () => {
    rows = [
      { ...row, deletedAt: recent, deletedBy: "user" },
      { ...row, deletedAt: recent, deletedBy: "duplicate", appliedAt: recent },
      { ...row, deletedAt: recent, deletedBy: "sweep", feedbackKind: "more_like_this", feedbackAt: recent },
    ];
    expect((await loadResponseHistory("owner")).map((item) => item.kind)).toEqual(["dismissed", "duplicate"]);
  });

  it("reads current feedback rather than retaining an undone dismissal reason", async () => {
    rows = [{ ...row, deletedAt: recent, feedbackKind: "not_my_role", feedbackAt: recent }];
    expect(await loadResponseHistory("owner")).toMatchObject([{ kind: "not_my_role" }]);
    rows = [{ ...row, feedbackKind: "more_like_this", feedbackAt: recent }];
    expect(await loadResponseHistory("owner")).toMatchObject([{ kind: "more_like_this", excludeExact: false }]);
    rows = [{ ...row }];
    expect(await loadResponseHistory("owner")).toEqual([]);
  });

  it("lets a newer application supersede older negative feedback without counting both", async () => {
    rows = [{ ...row, appliedAt: recent, feedbackKind: "not_my_role", feedbackAt: new Date("2026-01-01") }];
    expect(await loadResponseHistory("owner")).toMatchObject([{ kind: "applied", at: recent }]);
  });
});
