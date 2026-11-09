import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJobIdentity } from "../jobIdentity";
import { compareJobs, jobIdentityKeys } from "../duplicatePolicy";
import { fetchJobPageContent } from "../pageScraper";
import { historicalDuplicateMatches } from "../duplicateVisibility";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/identity-${name}.html`, import.meta.url), "utf8");
const inputUrl = "https://lensa.com/job/acme/product-manager/copy-a";
const otherUrl = "https://partner.com/jobs/partner-copy-77";
const observedAt = new Date("2026-11-06T00:00:00Z");
const resolve = (html: string, url = inputUrl, redirectChain = [url]) => extractJobIdentity({
  inputUrl: url, finalUrl: redirectChain.at(-1)!, redirectChain, observedAt, html, usable: true,
});
const response = (html: string, status = 200) => new Response(html, { status, headers: { "content-type": "text/html" } });
const candidate = (id: number, name: string, link: string) => ({
  id, title: "Senior Product Manager", company: "Acme", link, fullDescription: "Retained original history",
  jobIdentity: resolve(fixture(name), link), deletedAt: null as Date | null, appliedAt: null as Date | null,
});
beforeEach(() => vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("verified cross-site opening identity", () => {
  it("matches different aggregators to an employer-scoped requisition, not text", () => {
    const a = candidate(1, "lensa", inputUrl), b = candidate(2, "aggregator", otherUrl);
    expect(a.jobIdentity).toMatchObject({ status: "verified", inputUrl, signals: ["jsonld_jobposting_url"] });
    expect(b.jobIdentity.signals).toContain("canonical_link");
    expect(compareJobs(a, { ...b, title: "Partner's different wording", company: "Different source wording" }).kind).toBe("duplicate");
    expect(jobIdentityKeys(a)).toContain("ats:greenhouse:acme:91001");
    expect(JSON.parse(JSON.stringify(a.jobIdentity))).toEqual(a.jobIdentity);
  });
  it("requires review when identical title/company conflicts with known requisition IDs", () => {
    expect(compareJobs(candidate(1, "lensa", inputUrl), candidate(2, "other-requisition", otherUrl)).kind).toBe("review");
  });
  it("scopes IDs by employer and does not use unscoped identifier values", () => {
    const a = candidate(1, "lensa", inputUrl);
    const other = resolve(fixture("lensa").replaceAll("/acme/jobs/", "/another-employer/jobs/"), otherUrl);
    expect(compareJobs(a, { ...a, link: otherUrl, company: "Other", jobIdentity: other }).kind).toBe("distinct");
    const noUrl = fixture("lensa").replace(/"url":"https:\/\/boards[^"]+",/, "");
    expect(resolve(noUrl).status).toBe("uncertain");
  });
  it("accepts employer-domain originals only with explicit organization URL evidence", () => {
    const custom = fixture("lensa").replace("https://boards.greenhouse.io/acme/jobs/91001?utm_source=lensa", "https://careers.acme.com/jobs/R100");
    expect(resolve(custom)).toMatchObject({ status: "verified", originalUrl: "https://careers.acme.com/jobs/R100" });
    expect(resolve(custom.replace('"url":"https://acme.com"', '"url":"https://unrelated.com"')).status).toBe("uncertain");
  });
  it.each([
    ["conflicting_original_postings", fixture("lensa").replace("</head>", '<link rel="canonical" href="https://boards.greenhouse.io/acme/jobs/91002"></head>')],
    ["multiple_job_postings", fixture("lensa") + fixture("other-requisition")],
    ["no_original_posting_evidence", '<a href="https://boards.greenhouse.io/acme/jobs/91001">Recommended job</a>'],
    ["no_original_posting_evidence", '<link rel="canonical" href="https://boards.greenhouse.io/acme">'],
    ["no_original_posting_evidence", '<meta http-equiv="refresh" content="0;url=https://boards.greenhouse.io/acme/jobs/91001">'],
    ["no_original_posting_evidence", '<!-- <link rel="canonical" href="https://boards.greenhouse.io/acme/jobs/91001"> -->'],
    ["no_original_posting_evidence", '<script>const template = `<link rel="canonical" href="https://boards.greenhouse.io/acme/jobs/91001">`;</script>'],
  ])("leaves %s uncertain", (reason, html) => {
    expect(resolve(html)).toMatchObject({ status: "uncertain", reason });
    expect(resolve(html)).not.toHaveProperty("originalUrl");
  });
  it("can verify a standalone canonical ATS URL but rejects conflicting redirect requisitions", () => {
    expect(resolve('<link rel="canonical" href="https://jobs.lever.co/acme/req-1">').status).toBe("verified");
    expect(resolve(fixture("lensa"), inputUrl, [inputUrl, "https://boards.greenhouse.io/acme/jobs/91002", "https://boards.greenhouse.io/acme/jobs/91001"]))
      .toMatchObject({ status: "uncertain", reason: "conflicting_original_postings" });
  });
  it("does not let stale metadata verify redirects to a collection or login", () => {
    for (const target of ["https://jobs.lever.co/acme", "https://acme.com/login"]) {
      expect(resolve(fixture("lensa"), inputUrl, [inputUrl, target]))
        .toMatchObject({ status: "uncertain", reason: "redirect_to_collection_or_login" });
    }
  });
  it("preserves lifecycle, description and pair-specific distinct feedback", () => {
    const rows = [candidate(1, "lensa", inputUrl), { ...candidate(2, "aggregator", otherUrl), appliedAt: observedAt },
      { ...candidate(3, "aggregator", "https://third.com/jobs/another-copy"), deletedAt: observedAt }];
    const before = structuredClone(rows);
    expect(historicalDuplicateMatches(rows, new Set(["1:2"])).get(1)?.map((p) => p.id)).toEqual([3]);
    expect(historicalDuplicateMatches(rows, new Set(["1:2", "1:3"])).size).toBe(0);
    expect(rows).toEqual(before);
  });
});

describe("page scraping identity safety", () => {
  it("captures checked redirect chain and persists verified ATS metadata", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://boards.greenhouse.io/acme/jobs/91001" } }))
      .mockResolvedValueOnce(response(fixture("aggregator"))));
    const page = await fetchJobPageContent(inputUrl);
    expect(page?.jobIdentity).toMatchObject({ status: "verified", redirectChain: [inputUrl, "https://boards.greenhouse.io/acme/jobs/91001"] });
  });
  it.each([403, 404, 429])("does not trust metadata on HTTP %s pages", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture("lensa"), status)));
    expect((await fetchJobPageContent(inputUrl))?.jobIdentity).toMatchObject({ status: "uncertain", reason: `http_${status}` });
  });
  it.each(["Access denied", "Sign in to view this job", "Checking your browser", "Just a moment"])("ignores misleading metadata on %s pages", async (notice) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(`<main>${notice}</main>${fixture("lensa")}`)));
    expect((await fetchJobPageContent(inputUrl))?.jobIdentity?.status).toBe("uncertain");
  });
  it("leaves unsafe redirects and DNS targets uncertain", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/jobs/91001" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchJobPageContent(inputUrl))?.jobIdentity).toMatchObject({ status: "uncertain", reason: "unsafe_redirect" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response(fixture("lensa")));
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    expect((await fetchJobPageContent(inputUrl))?.jobIdentity).toMatchObject({ status: "uncertain", reason: "unsafe_original_posting" });
  });
  it("does not treat generic careers or login redirects as individual openings", async () => {
    for (const destination of ["https://acme.com/careers", "https://acme.com/jobs/login"]) {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: destination } }))
        .mockResolvedValueOnce(response("<p>Welcome to our careers website. Browse the latest opportunities. </p>".repeat(10))));
      expect((await fetchJobPageContent(inputUrl))?.jobIdentity?.status).toBe("uncertain");
    }
  });
});
