import { describe, expect, it, vi } from "vitest";
import { createSearchRequestQueue, retryAfterMilliseconds, SourceRequestError, withSourceRecovery } from "../sources/sourceRecovery";
import { parseHiringCafePage } from "../sources/hiringCafe";
import { fetchCustomFeed } from "../sources/customFeed";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

function timer() {
  let time = 0;
  return { now: () => time, sleep: vi.fn(async (ms: number) => { time += ms; }), advance: (ms: number) => { time += ms; } };
}
const ok = () => new Response("{}", { status: 200 });

describe("bounded automatic recovery of source requests", () => {
  it("understands Retry-After seconds and dates without treating invalid values as waits", () => {
    expect(retryAfterMilliseconds("2")).toBe(2000);
    expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:10 GMT", 1000)).toBe(9000);
    expect(retryAfterMilliseconds(null)).toBeNull();
    expect(retryAfterMilliseconds("-1")).toBeNull();
    expect(retryAfterMilliseconds("invalid")).toBeNull();
  });
  it("retries one temporary source failure and records recovery only after success", async () => {
    const t = timer(), note = vi.fn();
    const operation = vi.fn().mockRejectedValueOnce(new SourceRequestError("Source request failed", 503)).mockResolvedValue(["job"]);
    await expect(withSourceRecovery(operation, note, t)).resolves.toEqual(["job"]);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(note).toHaveBeenCalledOnce();
    expect(t.sleep).toHaveBeenCalledWith(750);
  });
  it("retries a network timeout but never masks the second failure", async () => {
    const note = vi.fn(), failure = new DOMException("Timed out", "TimeoutError");
    const operation = vi.fn().mockRejectedValue(failure);
    await expect(withSourceRecovery(operation, note, timer())).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(note).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])("does not retry permanent HTTP %s errors", async status => {
    const operation = vi.fn().mockRejectedValue(new SourceRequestError("Source request failed", status));
    await expect(withSourceRecovery(operation, vi.fn(), timer())).rejects.toThrow(`(${status})`);
    expect(operation).toHaveBeenCalledOnce();
  });
  it("does not retry parsing/validation errors or ignore a long Retry-After", async () => {
    for (const error of [new Error("Source must point to a public HTTPS host"), new Error("Unsupported HTML"), new SourceRequestError("Source request failed", 429, "120")]) {
      const operation = vi.fn().mockRejectedValue(error);
      await expect(withSourceRecovery(operation, vi.fn(), timer())).rejects.toBe(error);
      expect(operation).toHaveBeenCalledOnce();
    }
  });
  it("paces simultaneous source searches serially on their shared connection", async () => {
    const t = timer(), queue = createSearchRequestQueue({ ...t, intervalMs: 1100 });
    const starts: number[] = [];
    let active = 0, peak = 0;
    const operation = async () => {
      starts.push(t.now()); active++; peak = Math.max(peak, active);
      await Promise.resolve(); active--; return ok();
    };
    await Promise.all([queue(operation), queue(operation), queue(operation)]);
    expect(starts).toEqual([0, 1100, 2200]);
    expect(peak).toBe(1);
  });
  it("honors a short Retry-After and counts actual extra requests", async () => {
    const t = timer(), queue = createSearchRequestQueue({ ...t, intervalMs: 10 });
    const operation = vi.fn().mockImplementationOnce(async () => new Response("", { status: 429, headers: { "retry-after": "2" } })).mockImplementation(ok);
    const onRetry = vi.fn(), onRecovery = vi.fn();
    await queue(operation, { onRetry, onRecovery });
    expect(t.now()).toBe(2000);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRecovery).toHaveBeenCalledOnce();
  });
  it("stops after three search attempts and lets the queue continue after failure", async () => {
    const t = timer(), queue = createSearchRequestQueue({ ...t, intervalMs: 10 });
    const failing = vi.fn(async () => new Response("", { status: 503 }));
    await expect(queue(failing)).rejects.toThrow("(503)");
    expect(failing).toHaveBeenCalledTimes(3);
    await expect(queue(async () => ok())).resolves.toMatchObject({ status: 200 });
  });
  it("cools down instead of hammering the provider when Retry-After is long", async () => {
    const t = timer(), queue = createSearchRequestQueue({ ...t, intervalMs: 10 });
    const operation = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "120" } }));
    await expect(queue(operation)).rejects.toThrow(/time limit|cooling down/);
    await expect(queue(operation)).rejects.toThrow(/time limit|cooling down/);
    expect(operation).toHaveBeenCalledOnce();
    t.advance(121_000);
    await expect(queue(async () => ok())).resolves.toMatchObject({ status: 200 });
  });
  it("bounds queue waiting and pending requests", async () => {
    const t = timer(), queue = createSearchRequestQueue({ ...t, intervalMs: 10, maxQueueWaitMs: 5 });
    await queue(async () => ok());
    const blocked = vi.fn(async () => ok());
    await expect(queue(blocked)).rejects.toThrow("time limit");
    expect(blocked).not.toHaveBeenCalled();
    let release!: (value: Response) => void;
    const one = createSearchRequestQueue({ ...timer(), maxPending: 1 });
    const pending = one(() => new Promise<Response>(resolve => { release = resolve; }));
    await expect(one(async () => ok())).rejects.toThrow("busy");
    release(ok());
    await pending;
  });
  it("does not retry access-denied search responses", async () => {
    const operation = vi.fn(async () => new Response("", { status: 403 }));
    await expect(createSearchRequestQueue(timer())(operation)).rejects.toThrow("(403)");
    expect(operation).toHaveBeenCalledOnce();
  });
  it("does not mistake HiringCafe fetch timestamps for posting dates", () => {
    const raw = (date: Record<string, string>) => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { ssrHits: [
      { id: "1", job_information: { title: "Product Manager" }, company_name: "Example", apply_url: "https://example.com/jobs/1", ...date },
    ] } } })}</script>`;
    expect(parseHiringCafePage(raw({ date_fetched: "2026-11-04" }), "test")[0].postedAt).toBeNull();
    expect(parseHiringCafePage(raw({ date_fetched: "2026-11-04", date_posted: "2026-10-01" }), "test")[0].postedAt).toEqual(new Date("2026-10-01"));
  });
  it("recovers HTTP 406 with HTML negotiation and reports recovery only after parsing jobs", async () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting", title: "Product Manager", hiringOrganization: { name: "Example" }, url: "https://jobs.example.com/jobs/42",
    })}</script></html>`;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 406 }))
      .mockResolvedValueOnce(new Response(html, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const recovered = vi.fn();
      const jobs = await fetchCustomFeed("https://jobs.example.com/careers", "test", recovered);
      expect(jobs).toHaveLength(1);
      expect(fetcher.mock.calls[1][1].headers.Accept).toBe("text/html, application/xhtml+xml");
      expect(fetcher.mock.calls[1][1].redirect).toBe("manual");
      expect(recovered).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not follow private redirects when recovering the HTML format", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 406 }))
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://127.0.0.1/internal" } }));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(fetchCustomFeed("https://jobs.example.com/careers", "test")).rejects.toThrow("public HTTPS host");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
