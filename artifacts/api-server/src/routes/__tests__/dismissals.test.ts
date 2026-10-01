import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import type { NextFunction, Request, Response } from "express";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  isNotNull: vi.fn((field: unknown) => ({ field, notNull: true })),
}));

vi.mock("@workspace/db", () => ({
  db: { transaction: vi.fn() },
  jobPostingsTable: {
    id: "posting.id",
    userId: "posting.userId",
    deletedAt: "posting.deletedAt",
    closedAt: "posting.closedAt",
    deletedBy: "posting.deletedBy",
    dismissalUndoToken: "posting.dismissalUndoToken",
    dismissalPreviousFeedback: "posting.dismissalPreviousFeedback",
  },
  jobPostingFeedbackTable: {
    jobPostingId: "feedback.jobPostingId",
    userId: "feedback.userId",
    kind: "feedback.kind",
    createdAt: "feedback.createdAt",
  },
}));

vi.mock("../postings", () => ({
  getPostingWithReport: vi.fn(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: string }).userId = "owner-7";
    next();
  },
}));

import { db } from "@workspace/db";
import { getPostingWithReport } from "../postings";

const mockTransaction = db.transaction as ReturnType<typeof vi.fn>;
const mockGetPostingWithReport = getPostingWithReport as ReturnType<typeof vi.fn>;

function queryResult<T>(value: T) {
  return {
    then(resolve: (result: T) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function makeTransaction(
  selectedRows: unknown[][],
  options: {
    insertReturnedRows?: unknown[][];
    updateValues?: Record<string, unknown>[];
    insertValues?: Record<string, unknown>[];
    deleteCount?: { value: number };
    lockCalls?: string[];
  } = {},
) {
  const insertReturnedRows = [...(options.insertReturnedRows ?? [])];
  const updateValues = options.updateValues ?? [];
  const insertValues = options.insertValues ?? [];

  const tx = {
    select: vi.fn(() => {
      const rows = selectedRows.shift() ?? [];
      const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        for: vi.fn((mode: string) => {
          options.lockCalls?.push(mode);
          return Promise.resolve(rows);
        }),
      };
      chain.then = (resolve: (result: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return chain;
    }),
    update: vi.fn(() => {
      const chain = {
        set: vi.fn((values: Record<string, unknown>) => {
          updateValues.push(values);
          return chain;
        }),
        where: vi.fn(() => queryResult(undefined)),
        returning: vi.fn(() => Promise.resolve([])),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain = {
        values: vi.fn((values: Record<string, unknown>) => {
          insertValues.push(values);
          return chain;
        }),
        onConflictDoUpdate: vi.fn(() => chain),
        returning: vi.fn(() => Promise.resolve(insertReturnedRows.shift() ?? [])),
        then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve, reject),
      };
      return chain;
    }),
    delete: vi.fn(() => ({
      where: vi.fn(() => queryResult(options.deleteCount?.value ?? 0)),
    })),
  };

  mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));
  return tx;
}

async function makeApp() {
  const { default: dismissalRouter } = await import("../dismissals");
  const app = express();
  app.use(express.json());
  app.use(dismissalRouter);
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

const activePosting = {
  id: 7,
  userId: "owner-7",
  deletedAt: null,
  closedAt: null,
  dismissalUndoToken: null,
  dismissalPreviousFeedback: null,
};

describe("reversible posting dismissals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("soft-deletes without clearing the description or changing feedback when no reason is given", async () => {
    const priorCreatedAt = new Date("2025-01-02T03:04:05.000Z");
    const updateValues: Record<string, unknown>[] = [];
    const tx = makeTransaction(
      [[activePosting], [{ kind: "more_like_this", createdAt: priorCreatedAt }]],
      { updateValues },
    );

    const app = await makeApp();
    const response = await request(app).post("/postings/7/dismiss").send({ reason: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 7,
      feedback: { kind: "more_like_this", createdAt: priorCreatedAt.toISOString() },
    });
    expect(response.body.undoToken).toEqual(expect.any(String));
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(updateValues[0]).toMatchObject({
      deletedBy: "user",
      dismissalPreviousFeedback: {
        kind: "more_like_this",
        createdAt: priorCreatedAt.toISOString(),
      },
    });
    expect(updateValues[0]).not.toHaveProperty("fullDescription");
  });

  it("snapshots feedback before setting an optional reason", async () => {
    const priorCreatedAt = new Date("2024-11-10T11:12:13.000Z");
    const newCreatedAt = new Date("2026-01-05T06:07:08.000Z");
    const tx = makeTransaction(
      [[activePosting], [{ kind: "more_like_this", createdAt: priorCreatedAt }]],
      {
        insertReturnedRows: [[{ kind: "wrong_location", createdAt: newCreatedAt }]],
      },
    );

    const app = await makeApp();
    const response = await request(app)
      .post("/postings/7/dismiss")
      .send({ reason: "wrong_location" });

    expect(response.status).toBe(200);
    expect(response.body.feedback).toEqual({
      kind: "wrong_location",
      createdAt: newCreatedAt.toISOString(),
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("sets a dismissal reason only for the current token and preserves the original snapshot", async () => {
    const snapshot = { kind: "more_like_this", createdAt: "2024-11-10T11:12:13.000Z" };
    const lockCalls: string[] = [];
    const insertValues: Record<string, unknown>[] = [];
    const tx = makeTransaction([[
      {
        ...activePosting,
        deletedAt: new Date(),
        dismissalUndoToken: "active-token",
        dismissalPreviousFeedback: snapshot,
      },
    ]], {
      lockCalls,
      insertValues,
      insertReturnedRows: [[{
        kind: "wrong_location",
        createdAt: new Date("2026-01-05T06:07:08.000Z"),
      }]],
    });

    const app = await makeApp();
    const response = await request(app)
      .put("/postings/7/dismissal-reason")
      .send({ undoToken: "active-token", reason: "wrong_location" });

    expect(response.status).toBe(200);
    expect(response.body.undoToken).toBe("active-token");
    expect(lockCalls).toEqual(["update"]);
    expect(insertValues[0]).toMatchObject({ kind: "wrong_location", jobPostingId: 7 });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("rejects a stale reason token without changing the current feedback", async () => {
    const lockCalls: string[] = [];
    const tx = makeTransaction([[
      {
        ...activePosting,
        deletedAt: new Date(),
        dismissalUndoToken: "current-token",
        dismissalPreviousFeedback: null,
      },
    ]], { lockCalls });

    const app = await makeApp();
    const response = await request(app)
      .put("/postings/7/dismissal-reason")
      .send({ undoToken: "stale-token", reason: "already_closed" });

    expect(response.status).toBe(409);
    expect(lockCalls).toEqual(["update"]);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects a stale undo token without modifying posting or feedback", async () => {
    const lockCalls: string[] = [];
    const tx = makeTransaction([[
      {
        ...activePosting,
        deletedAt: new Date(),
        dismissalUndoToken: "current-token",
      },
    ]], { lockCalls });

    const app = await makeApp();
    const response = await request(app)
      .post("/postings/7/undo-dismissal")
      .send({ undoToken: "stale-token" });

    expect(response.status).toBe(409);
    expect(lockCalls).toEqual(["update"]);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("restores the original feedback and clears the token after a valid undo", async () => {
    const originalCreatedAt = "2024-11-10T11:12:13.000Z";
    const lockCalls: string[] = [];
    const insertValues: Record<string, unknown>[] = [];
    const updateValues: Record<string, unknown>[] = [];
    const tx = makeTransaction([[
      {
        ...activePosting,
        deletedAt: new Date(),
        dismissalUndoToken: "valid-token",
        dismissalPreviousFeedback: { kind: "more_like_this", createdAt: originalCreatedAt },
      },
    ]], { lockCalls, insertValues, updateValues });
    mockGetPostingWithReport.mockResolvedValue({
      posting: {
        id: 7,
        userId: "owner-7",
        title: "Engineer",
        company: "Example",
        fullDescription: "Description retained",
        extractedSkills: [],
        source: "manual",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        deletedAt: null,
        deletedBy: null,
        dismissalUndoToken: null,
      },
      report: null,
      feedback: { kind: "more_like_this", createdAt: new Date(originalCreatedAt) },
      sourceName: null,
      onlineMatchScore: null,
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/postings/7/undo-dismissal")
      .send({ undoToken: "valid-token" });

    expect(response.status).toBe(200);
    expect(response.body.feedback).toEqual({
      kind: "more_like_this",
      createdAt: originalCreatedAt,
    });
    expect(lockCalls).toEqual(["update"]);
    expect(insertValues[0]).toMatchObject({
      kind: "more_like_this",
      jobPostingId: 7,
      createdAt: new Date(originalCreatedAt),
    });
    expect(updateValues[0]).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      dismissalUndoToken: null,
      dismissalPreviousFeedback: null,
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(mockGetPostingWithReport).toHaveBeenCalledWith(7, "owner-7");
  });

  it("removes feedback on undo when no feedback existed before dismissal", async () => {
    const lockCalls: string[] = [];
    const updateValues: Record<string, unknown>[] = [];
    const tx = makeTransaction([[
      {
        ...activePosting,
        deletedAt: new Date(),
        dismissalUndoToken: "valid-token",
        dismissalPreviousFeedback: null,
      },
    ]], { lockCalls, updateValues });
    mockGetPostingWithReport.mockResolvedValue({
      posting: {
        id: 7,
        userId: "owner-7",
        title: "Engineer",
        company: "Example",
        fullDescription: "Description retained",
        extractedSkills: [],
        source: "manual",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        deletedAt: null,
        deletedBy: null,
        dismissalUndoToken: null,
      },
      report: null,
      feedback: null,
      sourceName: null,
      onlineMatchScore: null,
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/postings/7/undo-dismissal")
      .send({ undoToken: "valid-token" });

    expect(response.status).toBe(200);
    expect(response.body.feedback).toBeNull();
    expect(lockCalls).toEqual(["update"]);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(updateValues[0]).toMatchObject({
      deletedAt: null,
      dismissalUndoToken: null,
      dismissalPreviousFeedback: null,
    });
  });
});