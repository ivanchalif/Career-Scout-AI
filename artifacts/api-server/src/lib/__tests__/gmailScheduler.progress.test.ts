import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  gmailConnectionsTable: { userId: "connection.userId" },
  jobPostingsTable: {},
  userProfilesTable: { userId: "profile.userId" },
  gmailSeenKeysTable: { userId: "seen.userId", gmailKey: "seen.gmailKey" },
  filteredEmailsTable: {}, emailSyncLogTable: {}, syncEventsTable: {},
}));
vi.mock("../gmailClient", () => ({
  fetchJobEmails: vi.fn(), estimateEmailCount: vi.fn(), markEmailAsRead: vi.fn(),
  DEFAULT_EMAIL_FILTER_CRITERIA: {},
}));
vi.mock("../scoringService", () => ({
  extractJobListings: vi.fn(), scorePostingBackground: vi.fn(), sweepUnscoredPostings: vi.fn(),
}));
vi.mock("../dedup", () => ({ isFuzzyDuplicate: vi.fn(), runDedupSweep: vi.fn() }));
vi.mock("../pageScraper", () => ({ fetchJobPageContent: vi.fn() }));
vi.mock("../jobIdentitySources", () => ({ saveJobIdentitySource: vi.fn() }));
vi.mock("../responseHistory", () => ({ loadResponseHistory: vi.fn() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { db, gmailConnectionsTable, jobPostingsTable, gmailSeenKeysTable, syncEventsTable } from "@workspace/db";
import { fetchJobEmails, estimateEmailCount, markEmailAsRead, type JobEmail } from "../gmailClient";
import { extractJobListings, scorePostingBackground, sweepUnscoredPostings } from "../scoringService";
import { isFuzzyDuplicate, runDedupSweep } from "../dedup";
import { fetchJobPageContent } from "../pageScraper";
import { syncUser } from "../gmailScheduler";
import { getGmailSyncProgress, isGmailSyncRunning } from "../gmailSyncState";
import { GmailAuthorizationExpiredError } from "../gmailAuthError";
import { loadResponseHistory } from "../responseHistory";
import { saveJobIdentitySource } from "../jobIdentitySources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const conn = {
  userId: "pipeline-user", accessToken: "mock-access", refreshToken: "mock-refresh",
  email: null, lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date(),
} satisfies typeof gmailConnectionsTable.$inferSelect;
const email = (messageId: string, overrides: Partial<JobEmail> = {}): JobEmail => ({
  messageId, subject: "New jobs", body: "Job description", sender: "Jobs <jobs@example.test>", ...overrides,
});
const listing = (title: string) => ({ title, company: "Example", description: "Job description", url: "https://example.test/job" });

describe("Gmail pipeline progress", () => {
  let saved: { table: unknown; values: Record<string, unknown> }[];
  let finalize: ReturnType<typeof deferred<void>> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadResponseHistory).mockResolvedValue([]);
    saved = [];
    finalize = undefined;
    vi.mocked(db.select).mockImplementation(() => ({
      from: (table: unknown) => ({
        where: async () => table === gmailSeenKeysTable ? [{ gmailKey: "seen:complete" }] : [],
      }),
    }) as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.insert).mockImplementation((table) => ({
      values: (values: Record<string, unknown>) => {
        saved.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: async () => values.title === "Conflict" ? [] : [{ id: saved.length }],
          then: Promise.resolve().then.bind(Promise.resolve()),
        };
        return chain;
      },
    }) as unknown as ReturnType<typeof db.insert>);
    vi.mocked(db.update).mockImplementation(() => ({
      set: () => ({ where: () => finalize?.promise ?? Promise.resolve() }),
    }) as unknown as ReturnType<typeof db.update>);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof db.delete>);
    vi.mocked(fetchJobEmails).mockResolvedValue([]);
    vi.mocked(estimateEmailCount).mockResolvedValue(200);
    vi.mocked(markEmailAsRead).mockResolvedValue(undefined);
    vi.mocked(fetchJobPageContent).mockResolvedValue(null);
    vi.mocked(isFuzzyDuplicate).mockResolvedValue({ isDuplicate: false });
    vi.mocked(sweepUnscoredPostings).mockResolvedValue(undefined);
    vi.mocked(runDedupSweep).mockResolvedValue(0);
  });

  it("audits repeated learned role mismatches instead of silently importing them", async () => {
    vi.mocked(loadResponseHistory).mockResolvedValue([
      { kind: "not_my_role", title: "Product Manager", company: "One", location: null, link: null },
      { kind: "not_my_role", title: "Product Manager", company: "Two", location: null, link: null },
    ]);
    vi.mocked(fetchJobEmails).mockResolvedValue([email("learned-filter")]);
    vi.mocked(extractJobListings).mockResolvedValue({ listings: [listing("Product Manager")], hadError: false });
    vi.mocked(fetchJobPageContent).mockResolvedValue(null);
    const result = await syncUser(conn);
    expect(result.synced).toBe(0);
    expect(saved.filter((entry) => entry.table === jobPostingsTable)).toHaveLength(0);
    expect(saved.some((entry) => entry.values.reason === "learned_preference"
      && entry.values.listingTitle === "Product Manager")).toBe(true);
    expect(markEmailAsRead).toHaveBeenCalled();
  });

  it.each([false, true])("passes verified identity through import and retains source when duplicate=%s", async (duplicate) => {
    const url = "https://lensa.com/jobs/partner-copy";
    const jobIdentity = {
      version: 1 as const, status: "verified" as const, reason: "verified_original_posting",
      observedAt: new Date().toISOString(), inputUrl: url, finalUrl: url,
      redirectChain: [url], originalUrl: "https://boards.greenhouse.io/acme/jobs/91001",
      signals: ["jsonld_jobposting_url"],
    };
    vi.mocked(fetchJobEmails).mockResolvedValue([email("identity-import")]);
    vi.mocked(extractJobListings).mockResolvedValue({ listings: [{ ...listing("Product Manager"), url }], hadError: false });
    vi.mocked(fetchJobPageContent).mockResolvedValue({
      finalUrl: url, content: "Useful page description", contentUsable: true, metadata: null, jobIdentity,
      availability: { status: "unverified", reason: "no_active_listing_evidence", checkedAt: new Date(), confidence: 0, evidence: [] },
    });
    vi.mocked(isFuzzyDuplicate).mockResolvedValue(duplicate ? { isDuplicate: true, matchedId: 51 } : { isDuplicate: false });
    await syncUser(conn);
    expect(isFuzzyDuplicate).toHaveBeenCalledWith(conn.userId, "Product Manager", "Example", { link: url, jobIdentity });
    expect(saveJobIdentitySource).toHaveBeenCalledWith(expect.objectContaining({
      userId: conn.userId, provider: "gmail", url, jobIdentity,
      ...(duplicate ? { postingId: 51 } : {}),
    }));
    const postings = saved.filter((entry) => entry.table === jobPostingsTable);
    if (duplicate) expect(postings).toHaveLength(0);
    else expect(postings[0].values).toMatchObject({ jobIdentity });
  });

  it("does not use an ambiguous redirect destination as automatic listing proof", async () => {
    const url = "https://lensa.com/jobs/ambiguous-copy";
    vi.mocked(fetchJobEmails).mockResolvedValue([email("ambiguous-identity")]);
    vi.mocked(extractJobListings).mockResolvedValue({ listings: [{ ...listing("Product Manager"), url }], hadError: false });
    vi.mocked(fetchJobPageContent).mockResolvedValue({
      finalUrl: "https://boards.greenhouse.io/acme/jobs/91001", content: "Readable job description", contentUsable: true, metadata: null,
      availability: { status: "unverified", reason: "no_active_listing_evidence", checkedAt: new Date(), confidence: 0, evidence: [] },
      jobIdentity: {
        version: 1, status: "uncertain", reason: "conflicting_original_postings", observedAt: new Date().toISOString(),
        inputUrl: url, finalUrl: "https://boards.greenhouse.io/acme/jobs/91001",
        redirectChain: [url, "https://boards.greenhouse.io/acme/jobs/91001"], signals: [],
      },
    });
    await syncUser(conn);
    expect(isFuzzyDuplicate).toHaveBeenCalledWith(conn.userId, "Product Manager", "Example",
      expect.objectContaining({ link: url, jobIdentity: expect.objectContaining({ status: "uncertain" }) }));
    expect(saved.find((entry) => entry.table === jobPostingsTable)?.values.link).toBe(url);
  });

  it("persists positive learning separately from the AI fit score on imported Gmail jobs", async () => {
    vi.mocked(loadResponseHistory).mockResolvedValue([
      { kind: "applied", title: "Product Manager", company: "Past company", location: null, link: null },
    ]);
    vi.mocked(fetchJobEmails).mockResolvedValue([email("learned-positive")]);
    vi.mocked(extractJobListings).mockResolvedValue({ listings: [listing("Product Manager")], hadError: false });
    vi.mocked(fetchJobPageContent).mockResolvedValue(null);
    const result = await syncUser(conn);
    expect(result.synced).toBe(1);
    const imported = saved.find((entry) => entry.table === jobPostingsTable);
    expect(imported?.values).toMatchObject({
      preferenceAdjustment: 8, preferenceReasons: ["Similar to jobs you applied for"],
    });
    expect(imported?.values).not.toHaveProperty("fitScore");
  });

  it("reports live imports within a digest, counts all attempted emails, and shares manual/scheduled work", async () => {
    const fetched = deferred<JobEmail[]>();
    const secondPage = deferred<null>();
    const failedExtraction = deferred<Awaited<ReturnType<typeof extractJobListings>>>();
    finalize = deferred<void>();
    vi.mocked(fetchJobEmails).mockReturnValue(fetched.promise);
    vi.mocked(fetchJobPageContent).mockResolvedValueOnce(null).mockReturnValueOnce(secondPage.promise);
    vi.mocked(extractJobListings)
      .mockResolvedValueOnce({ listings: [listing("First"), listing("Second")], hadError: false })
      .mockReturnValueOnce(failedExtraction.promise)
      .mockResolvedValueOnce({ listings: [], hadError: false })
      .mockResolvedValueOnce({ listings: [listing("Duplicate"), listing("Conflict")], hadError: false });
    vi.mocked(isFuzzyDuplicate)
      .mockResolvedValueOnce({ isDuplicate: false })
      .mockResolvedValueOnce({ isDuplicate: false })
      .mockResolvedValueOnce({ isDuplicate: true })
      .mockResolvedValueOnce({ isDuplicate: false });
    // Background scoring remains unfinished; sync must not await it.
    vi.mocked(sweepUnscoredPostings).mockReturnValue(new Promise(() => {}));
    const scheduled = syncUser(conn);
    const manual = syncUser(conn, { estimateMatchingEmails: true });
    expect(getGmailSyncProgress(conn.userId)).toEqual({
      phase: "fetching", emailsProcessed: 0, emailsTotal: null, jobsImported: 0,
    });
    fetched.resolve([
      email("seen"), email("digest"), email("digest"), email("empty", { body: " " }),
      email("blocked", { sender: "notify@ebay.com" }),
      email("response", { subject: "Thank you for applying" }),
      email("error"), email("no-listings"), email("skipped"),
    ]);
    await vi.waitFor(() => expect(fetchJobPageContent).toHaveBeenCalledTimes(2));
    expect(getGmailSyncProgress(conn.userId)).toEqual({
      phase: "processing", emailsProcessed: 0, emailsTotal: 7, jobsImported: 1,
    });
    secondPage.resolve(null);
    await vi.waitFor(() => expect(extractJobListings).toHaveBeenCalledTimes(2));
    expect(getGmailSyncProgress(conn.userId)?.emailsProcessed).toBe(4);
    expect(getGmailSyncProgress(conn.userId)?.jobsImported).toBe(2);
    failedExtraction.resolve({ listings: [], hadError: true });
    await vi.waitFor(() => expect(getGmailSyncProgress(conn.userId)?.phase).toBe("finalizing"));
    expect(getGmailSyncProgress(conn.userId)).toEqual({
      phase: "finalizing", emailsProcessed: 7, emailsTotal: 7, jobsImported: 2,
    });
    expect(vi.mocked(markEmailAsRead).mock.calls.map((args) => args[2])).toEqual(["digest", "no-listings", "skipped"]);
    expect(estimateEmailCount).not.toHaveBeenCalled();
    expect(fetchJobEmails).toHaveBeenCalledTimes(1);
    expect(scorePostingBackground).toHaveBeenCalledTimes(2);
    finalize.resolve();
    expect(await scheduled).toMatchObject({ synced: 2 });
    expect(await manual).toMatchObject({ synced: 2 });
    expect(saved.find((row) => row.table === syncEventsTable)?.values.jobsImported).toBe(2);
    expect(saved.filter((row) => row.table === jobPostingsTable)).toHaveLength(3);
    expect(getGmailSyncProgress(conn.userId)).toBeNull();
  });

  it("keeps the batch total unknown during the manual estimate and cleans up an empty sync", async () => {
    const estimate = deferred<number>();
    vi.mocked(estimateEmailCount).mockReturnValue(estimate.promise);
    finalize = deferred<void>();
    const pending = syncUser(conn, { estimateMatchingEmails: true });
    await vi.waitFor(() => expect(estimateEmailCount).toHaveBeenCalledTimes(1));
    expect(getGmailSyncProgress(conn.userId)?.emailsTotal).toBeNull();
    estimate.resolve(200);
    await vi.waitFor(() => expect(getGmailSyncProgress(conn.userId)?.phase).toBe("finalizing"));
    expect(getGmailSyncProgress(conn.userId)).toEqual({
      phase: "finalizing", emailsProcessed: 0, emailsTotal: 0, jobsImported: 0,
    });
    finalize.resolve();
    expect(await pending).toMatchObject({ synced: 0 });
    expect(getGmailSyncProgress(conn.userId)).toBeNull();
  });

  it.each(["fetch", "extraction", "finalization"])("clears progress after a %s failure and permits retry", async (stage) => {
    if (stage === "fetch") vi.mocked(fetchJobEmails).mockRejectedValueOnce(new Error("failure"));
    if (stage === "extraction") {
      vi.mocked(fetchJobEmails).mockResolvedValueOnce([email("error")]);
      vi.mocked(extractJobListings).mockRejectedValueOnce(new Error("failure"));
    }
    if (stage === "finalization") {
      vi.mocked(db.update).mockImplementationOnce(() => ({
        set: () => ({ where: async () => { throw new Error("failure"); } }),
      }) as unknown as ReturnType<typeof db.update>);
    }
    await expect(syncUser(conn)).rejects.toThrow("failure");
    expect(getGmailSyncProgress(conn.userId)).toBeNull();
    expect(isGmailSyncRunning(conn.userId)).toBe(false);
    expect(markEmailAsRead).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(await syncUser(conn)).toMatchObject({ synced: 0 });
  });

  it.each(["manual-fetch", "scheduled-fetch", "estimate", "mark-read"])(
    "rejects expired access during %s, removes the connection, and permits a reconnect retry",
    async (stage) => {
      const expired = { response: { data: { error: "invalid_grant" } } };
      if (stage === "estimate") vi.mocked(estimateEmailCount).mockRejectedValueOnce(expired);
      else if (stage === "mark-read") {
        vi.mocked(fetchJobEmails).mockResolvedValueOnce([email("read-expiry")]);
        vi.mocked(extractJobListings).mockResolvedValueOnce({ listings: [], hadError: false });
        vi.mocked(markEmailAsRead).mockRejectedValueOnce(expired);
      }
      else vi.mocked(fetchJobEmails).mockRejectedValueOnce(expired);

      await expect(syncUser(conn, { estimateMatchingEmails: stage !== "scheduled-fetch" }))
        .rejects.toBeInstanceOf(GmailAuthorizationExpiredError);
      expect(db.delete).toHaveBeenCalledExactlyOnceWith(gmailConnectionsTable);
      expect(db.update).not.toHaveBeenCalled();
      expect(saved.some((row) => row.table === syncEventsTable)).toBe(false);
      if (stage !== "mark-read") {
        expect(db.insert).not.toHaveBeenCalled();
        expect(markEmailAsRead).not.toHaveBeenCalled();
      }
      expect(getGmailSyncProgress(conn.userId)).toBeNull();
      expect(isGmailSyncRunning(conn.userId)).toBe(false);
      expect(await syncUser(conn)).toMatchObject({ synced: 0 });
    },
  );

  it("shares fetching expiry with a manual caller waiting on scheduled work", async () => {
    const fetched = deferred<JobEmail[]>();
    vi.mocked(fetchJobEmails).mockReturnValueOnce(fetched.promise);
    const scheduled = syncUser(conn);
    const manual = syncUser(conn, { estimateMatchingEmails: true });
    const results = Promise.allSettled([scheduled, manual]);
    await vi.waitFor(() => expect(fetchJobEmails).toHaveBeenCalledTimes(1));
    fetched.reject(new Error("invalid_grant"));
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(GmailAuthorizationExpiredError);
    }
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(estimateEmailCount).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(getGmailSyncProgress(conn.userId)).toBeNull();
    expect(isGmailSyncRunning(conn.userId)).toBe(false);
  });
});
