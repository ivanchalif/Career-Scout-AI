import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import type { DashboardSummary, GmailStatus, OnlineDiscoveryStatus, PostingFeedback, PostingWithReport } from "@workspace/api-client-react";

type Action = "dismiss" | "dismissal-reason" | "undo-dismissal";
type Mutation = { action: Action; body: Record<string, unknown> };

export const test = base.extend<{ dismissal: DismissalFixture }>({
  dismissal: async ({ page }, use) => {
    const fixture = new DismissalFixture();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.addInitScript(account => {
      window.__dismissalTestAccount = account;
    }, fixture.account);
    // No external services or real accounts. An unhandled request cannot reach
    // the real API (and fails the test at teardown rather than returning {}).
    const unhandled: string[] = [];
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:5189") return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const response = await fixture.respond(url.pathname, request.method(), request.postDataJSON(),
        request.headers().authorization);
      if (!response) {
        unhandled.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 501, json: { error: "Unhandled test API request" } });
      }
      await route.fulfill(response);
    });
    try {
      await use(fixture);
    } finally {
      // Release any held network request even when an assertion fails.
      fixture.release();
      expect(pageErrors, "The real app must render without uncaught errors").toEqual([]);
      expect(unhandled, "All API calls must be explicitly fixture-owned").toEqual([]);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  },
});

export { expect };

class DismissalFixture {
  readonly account = { id: `dismissal-test-${randomUUID()}`, email: `dismissal-${randomUUID()}@example.test` };
  readonly id = 61001;
  readonly originalFeedback: PostingFeedback = { kind: "more_like_this", createdAt: "2024-11-10T11:12:13.000Z" };
  readonly item: PostingWithReport = {
    posting: {
      id: this.id, userId: this.account.id, title: "Isolated dismissal regression job",
      company: "Test-owned company", fullDescription: "A test-owned TypeScript role.",
      extractedSkills: ["TypeScript"], source: "manual", createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null, deletedBy: null, dismissalUndoToken: null, closedAt: null,
      appliedAt: null, availabilityStatus: null, preferenceAdjustment: 0, preferenceReasons: [],
    },
    report: {
      id: 61002, jobPostingId: this.id, userId: this.account.id, fitScore: 80,
      matchedSkills: ["TypeScript"], missingSkills: [], reasoning: "Test fit.",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    scoreStatus: "current", feedback: null, sourceName: null, onlineMatchScore: null,
  };
  readonly mutations: Mutation[] = [];
  private previousFeedback: PostingFeedback | null = null;
  private failure: { action: Action; status: number } | null = null;
  private held: { action: Action; promise: Promise<void> } | null = null;
  release = () => {};
  rotateReasonToken = false;

  failNext(action: Action, status = 500) {
    this.failure = { action, status };
  }

  holdNext(action: Action) {
    const promise = new Promise<void>(resolve => { this.release = resolve; });
    this.held = { action, promise };
  }

  async respond(path: string, method: string, body: Record<string, unknown> | null, authorization?: string) {
    const json = (value: unknown, status = 200) => ({
      status, json: structuredClone(value),
    });
    if (authorization !== `Bearer ${this.account.id}`) {
      return json({ error: "Test-owned account required" }, 401);
    }
    if (method === "GET") {
      switch (path) {
        case "/api/postings": return json(this.item.posting.deletedAt ? [] : [this.item]);
        case "/api/postings/deleted": return json(this.item.posting.deletedAt ? [this.item] : []);
        case `/api/postings/${this.id}`: return json(this.item);
        case "/api/dashboard/summary": return json({
          totalPostings: this.item.posting.deletedAt ? 0 : 1, avgFitScore: 80,
          topMatches: this.item.posting.deletedAt ? [] : [this.item], strongMatches: 1,
          hasProfile: true, gmailConnected: false,
        } satisfies DashboardSummary);
        case "/api/gmail/status": return json({
          connected: false, syncing: false, progress: null, postingCount: 0,
        } satisfies GmailStatus);
        case "/api/company-filter-settings": return json({ mode: "off", companies: [] });
        case "/api/title-exclude-settings": return json({ keywords: [] });
        case "/api/online-discovery/status": return json({
          source: "test-only", scheduleHours: null, minimumMatchScore: 60,
          freshnessWindow: "past_week", lastFound: 0, lastImported: 0, lastDuplicates: 0,
          criteria: { roleTitles: [], skills: [], locations: [], remotePreferences: [] },
        } satisfies OnlineDiscoveryStatus);
        case "/api/online-discovery/sources": return json({ sources: [], availableSources: [] });
        default: return null;
      }
    }
    if (method === "POST" && path === "/api/postings/dedup-sweep") {
      return json({ removed: 0, remaining: this.item.posting.deletedAt ? 0 : 1 });
    }
    const action = path.replace(`/api/postings/${this.id}/`, "") as Action;
    if (!["dismiss", "dismissal-reason", "undo-dismissal"].includes(action)) return null;
    if (method !== (action === "dismissal-reason" ? "PUT" : "POST")) return null;
    this.mutations.push({ action, body: structuredClone(body ?? {}) });
    if (this.held?.action === action) {
      const { promise } = this.held;
      this.held = null;
      await promise;
    }
    if (this.failure?.action === action) {
      const { status } = this.failure;
      this.failure = null;
      return json({ error: "Injected test failure" }, status);
    }
    if (action === "dismiss") {
      this.previousFeedback = structuredClone(this.item.feedback ?? null);
      this.item.posting.deletedAt = new Date().toISOString();
      this.item.posting.deletedBy = "user";
      this.item.posting.dismissalUndoToken = randomUUID();
    } else if (!this.item.posting.deletedAt || body?.undoToken !== this.item.posting.dismissalUndoToken) {
      return json({ error: "Dismissal token is stale" }, 409);
    }
    if (action === "undo-dismissal") {
      this.item.posting.deletedAt = null;
      this.item.posting.deletedBy = null;
      this.item.posting.dismissalUndoToken = null;
      this.item.feedback = structuredClone(this.previousFeedback);
      return json(this.item);
    }
    if (body?.reason) {
      this.item.feedback = { kind: body.reason as PostingFeedback["kind"], createdAt: new Date().toISOString() };
    }
    if (action === "dismissal-reason" && this.rotateReasonToken) {
      this.item.posting.dismissalUndoToken = randomUUID();
    }
    return json({ id: this.id, undoToken: this.item.posting.dismissalUndoToken, feedback: this.item.feedback });
  }
}
