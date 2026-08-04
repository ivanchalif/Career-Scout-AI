import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// DB mock — captures SQL executed by runDedupSweep / sweepDuplicatesOf
// ---------------------------------------------------------------------------

// Rows returned by db.execute — set per-test
let mockSelectRows: { id: number }[] = [];
// Fields captured by the UPDATE .set() call
let capturedUpdateFields: Record<string, unknown> = {};
// IDs captured from the UPDATE .where() / inArray condition
let capturedUpdateIds: number[] = [];
// Last SQL args passed to db.execute
let lastExecuteArg: unknown = null;

vi.mock("drizzle-orm", () => ({
  sql: new Proxy(
    (..._args: unknown[]) => ({ _type: "sql", _args }),
    {
      get: (_t, prop) => {
        if (prop === "raw") return (s: string) => ({ _type: "raw", s });
        return undefined;
      },
    },
  ),
  and: (...conds: unknown[]) => ({ _type: "and", conds }),
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
  inArray: (col: unknown, vals: unknown) => ({ _type: "inArray", col, vals }),
}));

vi.mock("@workspace/db", () => {
  const fakeTable = new Proxy({}, { get: () => fakeTable });

  return {
    db: {
      execute: vi.fn(async (arg: unknown) => {
        lastExecuteArg = arg;
        return { rows: mockSelectRows };
      }),
      update: vi.fn(() => ({
        set: (fields: Record<string, unknown>) => {
          capturedUpdateFields = fields;
          return {
            where: (cond: unknown) => {
              const c = cond as { _type: string; conds?: Array<{ _type: string; vals?: number[] }> };
              if (c._type === "and") {
                const ia = c.conds?.find((x) => x._type === "inArray");
                capturedUpdateIds = ia?.vals ?? [];
              }
              return Promise.resolve();
            },
          };
        },
      })),
    },
    jobPostingsTable: fakeTable,
  };
});

// Import after mocks are registered
import { runDedupSweep, sweepDuplicatesOf } from "../dedup";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Extracts the Date value(s) from args passed to the sql template tag. */
function findDateArg(sqlArg: unknown): Date | undefined {
  const a = sqlArg as { _args?: unknown[] };
  return a._args?.find((x): x is Date => x instanceof Date);
}

beforeEach(() => {
  mockSelectRows = [];
  capturedUpdateFields = {};
  capturedUpdateIds = [];
  lastExecuteArg = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// runDedupSweep
// ---------------------------------------------------------------------------

describe("runDedupSweep", () => {
  it("returns 0 and skips update when execute returns no rows", async () => {
    mockSelectRows = [];
    const removed = await runDedupSweep("user-1");
    expect(removed).toBe(0);
    expect(capturedUpdateIds).toEqual([]);
  });

  it("soft-deletes matched rows and tags them deletedBy: 'sweep'", async () => {
    mockSelectRows = [{ id: 10 }, { id: 20 }];
    const removed = await runDedupSweep("user-1");
    expect(removed).toBe(2);
    expect(capturedUpdateIds).toEqual([10, 20]);
    expect(capturedUpdateFields).toMatchObject({
      deletedBy: "sweep",
      fullDescription: "",
    });
    expect(capturedUpdateFields.deletedAt).toBeInstanceOf(Date);
  });

  it("passes a grace-cutoff date ~4 hours ago in the SQL query", async () => {
    mockSelectRows = [];
    const before = new Date(Date.now() - 4 * 60 * 60 * 1000 - 1000);
    await runDedupSweep("user-1");
    const after = new Date(Date.now() - 4 * 60 * 60 * 1000 + 1000);

    const graceCutoff = findDateArg(lastExecuteArg);
    expect(graceCutoff, "sql template should include a Date for the grace period").toBeDefined();
    expect(graceCutoff!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(graceCutoff!.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ---------------------------------------------------------------------------
// sweepDuplicatesOf
// ---------------------------------------------------------------------------

describe("sweepDuplicatesOf", () => {
  it("returns 0 and skips update when execute returns no rows", async () => {
    mockSelectRows = [];
    const removed = await sweepDuplicatesOf("user-1", "VP Engineering", "Acme Corp", 99);
    expect(removed).toBe(0);
    expect(capturedUpdateIds).toEqual([]);
  });

  it("soft-deletes matched rows and tags them deletedBy: 'sweep'", async () => {
    mockSelectRows = [{ id: 30 }];
    const removed = await sweepDuplicatesOf("user-1", "VP Engineering", "Acme Corp", 99);
    expect(removed).toBe(1);
    expect(capturedUpdateIds).toEqual([30]);
    expect(capturedUpdateFields).toMatchObject({
      deletedBy: "sweep",
      fullDescription: "",
    });
    expect(capturedUpdateFields.deletedAt).toBeInstanceOf(Date);
  });

  it("returns 0 without querying when title or company normalises to empty string", async () => {
    const { db } = await import("@workspace/db");
    // "!!!" and "---" both normalise to "" after stripping non-alphanum
    const removed = await sweepDuplicatesOf("user-1", "!!!", "---", 1);
    expect(removed).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("passes a grace-cutoff date ~4 hours ago in the SQL query", async () => {
    mockSelectRows = [];
    const before = new Date(Date.now() - 4 * 60 * 60 * 1000 - 1000);
    await sweepDuplicatesOf("user-1", "Director of Product", "Acme Corp", 1);
    const after = new Date(Date.now() - 4 * 60 * 60 * 1000 + 1000);

    const graceCutoff = findDateArg(lastExecuteArg);
    expect(graceCutoff, "sql template should include a Date for the grace period").toBeDefined();
    expect(graceCutoff!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(graceCutoff!.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
