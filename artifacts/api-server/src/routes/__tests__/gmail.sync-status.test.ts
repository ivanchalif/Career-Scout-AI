import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { GetGmailStatusResponse } from "@workspace/api-zod";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  gmailConnectionsTable: { userId: "gmail.userId" },
  jobPostingsTable: { userId: "posting.userId", gmailMessageId: "posting.gmailMessageId" },
  gmailSeenKeysTable: {},
  userProfilesTable: {},
  syncEventsTable: {},
  emailSyncLogTable: {},
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = "status-user";
    next();
  },
}));
vi.mock("../../lib/gmailClient", () => ({
  getAuthUrl: vi.fn(), exchangeCode: vi.fn(), getGmailEmail: vi.fn(),
  revokeTokens: vi.fn(), fetchJobEmails: vi.fn(), fetchSingleEmail: vi.fn(),
  estimateEmailCount: vi.fn(), markEmailAsRead: vi.fn(), signState: vi.fn(), verifyState: vi.fn(),
}));
vi.mock("../../lib/scoringService", () => ({
  scorePostingBackground: vi.fn(), sweepUnscoredPostings: vi.fn(), extractJobListings: vi.fn(),
}));
vi.mock("../../lib/dedup", () => ({ isFuzzyDuplicate: vi.fn() }));
vi.mock("../../lib/pageScraper", () => ({ fetchJobPageContent: vi.fn() }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/gmailScheduler", () => ({ syncUser: vi.fn() }));

import { db } from "@workspace/db";
import { syncUser } from "../../lib/gmailScheduler";
import { estimateEmailCount } from "../../lib/gmailClient";
import { isGmailSyncRunning, runGmailSync } from "../../lib/gmailSyncState";
import router from "../gmail";

const app = express();
app.use(express.json(), router);
const connection = { userId: "status-user", email: "test@example.test", lastSyncedAt: null };
const select = vi.mocked(db.select);

function selectRows(rows: unknown[]) {
  const chain = { from: vi.fn(() => chain), where: vi.fn(() => Promise.resolve(rows)) };
  return chain as unknown as ReturnType<typeof db.select>;
}

describe("Gmail sync status and manual sync", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns syncing false for a disconnected user", async () => {
    select.mockReturnValueOnce(selectRows([]));
    const response = await request(app).get("/gmail/status");
    expect(response.body).toEqual({ connected: false, syncing: false, postingCount: 0 });
    expect(GetGmailStatusResponse.safeParse(response.body).success).toBe(true);
  });

  it("reports an ongoing scheduled sync and clears the spinner state when it finishes", async () => {
    let finish!: () => void;
    const ongoing = runGmailSync("status-user", () => new Promise((resolve) => {
      finish = () => resolve({ synced: 4, lastSyncedAt: new Date() });
    }));
    await Promise.resolve();
    select.mockReturnValueOnce(selectRows([connection])).mockReturnValueOnce(selectRows([]));
    const busy = await request(app).get("/gmail/status");
    expect(busy.body.syncing).toBe(true);
    expect(GetGmailStatusResponse.safeParse(busy.body).success).toBe(true);
    finish();
    await ongoing;
    select.mockReturnValueOnce(selectRows([connection])).mockReturnValueOnce(selectRows([]));
    const idle = await request(app).get("/gmail/status");
    expect(idle.body.syncing).toBe(false);
    expect(GetGmailStatusResponse.safeParse(idle.body).success).toBe(true);
  });

  it("waits for an existing sync's actual import count instead of returning a synthetic zero", async () => {
    let finish!: () => void;
    const ongoing = runGmailSync("status-user", () => new Promise((resolve) => {
      finish = () => resolve({ synced: 26, lastSyncedAt: new Date("2026-10-08T17:00:00Z") });
    }));
    await Promise.resolve();
    vi.mocked(syncUser).mockImplementation((conn) => runGmailSync(conn.userId, async () => {
      throw new Error("A second sync must not start");
    }));
    select.mockReturnValueOnce(selectRows([connection]));
    const responsePromise = request(app).post("/gmail/sync").then((response) => response);
    await vi.waitFor(() => expect(syncUser).toHaveBeenCalledTimes(1));
    expect(isGmailSyncRunning("status-user")).toBe(true);
    expect(syncUser).toHaveBeenCalledWith(connection, { estimateMatchingEmails: true });
    expect(estimateEmailCount).not.toHaveBeenCalled();
    finish();
    await ongoing;
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ synced: 26, lastSyncedAt: "2026-10-08T17:00:00.000Z" });
    expect(isGmailSyncRunning("status-user")).toBe(false);
  });
});
