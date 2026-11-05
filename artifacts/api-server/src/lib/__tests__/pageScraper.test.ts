import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJobPostingMetadata, fetchJobPageContent } from "../pageScraper";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const usableText = "A real job listing with responsibilities and qualifications. ".repeat(5);

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(lookup).mockReset();
});

describe("job page extraction and availability", () => {
  it.each([
    ["Job closed", "explicit_job_closed"],
    ["This job is closed", "explicit_job_closed"],
    ["Job no longer available", "explicit_job_unavailable"],
    ["The position is no longer open", "explicit_job_unavailable"],
    ["Job expired", "explicit_posting_expired"],
    ["Job posting expired", "explicit_posting_expired"],
    ["This job posting has expired", "explicit_posting_expired"],
    ["This job opening has been removed", "explicit_job_closed"],
    ["The role has been filled", "explicit_position_filled"],
    ["We are no longer accepting applications", "explicit_applications_closed"],
    ["Applications for this position are closed", "explicit_applications_closed"],
    ["The application window has ended", "explicit_applications_closed"],
    ["The job you are looking for is no longer available", "explicit_job_unavailable"],
  ])("recognizes landing-page closure: %s", async (notice, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(`<main><h1>${notice}</h1></main>`)));
    expect((await fetchJobPageContent("https://jobs.example.com/job"))?.availability)
      .toMatchObject({ status: "closed", reason });
  });

  it.each([
    "Our office is closed on weekends.",
    "If this job is closed, please look at our other positions.",
    "When a job posting expired, the recruiter updated it.",
    "This job is not closed.",
    "Do not assume this job is closed.",
    "Your session has expired. Sign in again.",
    "Our job alerts expire after 30 days.",
    "You will help customers with job posting expired notifications.",
    "We are not accepting applications from recruitment agencies.",
    "We are not accepting applications by email.",
  ])("does not mistake generic or hypothetical notices for closure: %s", async (notice) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(`<p>${notice}</p><p>Apply now.</p>${usableText}`)));
    // The instructional notification example is quoted as a responsibility,
    // not an assertion about the current job.
    expect((await fetchJobPageContent("https://jobs.example.com/job"))?.availability.status).not.toBe("closed");
  });

  it("detects closure after long descriptions and follows tracking redirects", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://jobs.example.com/expired" } }))
      .mockResolvedValueOnce(htmlResponse(`<p>${"Description text. ".repeat(300)}</p><h2>This position has been filled</h2>`)));
    const result = await fetchJobPageContent("https://jobs.example.com/tracking");
    expect(result?.finalUrl).toBe("https://jobs.example.com/expired");
    expect(result?.availability).toMatchObject({ status: "closed", reason: "explicit_position_filled" });
  });

  it("reads closure headings inside the landing-page header, but ignores script and footer examples", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(htmlResponse("<header><h1>This posting has expired</h1></header>"))
      .mockResolvedValueOnce(htmlResponse(`<script>const example = "Job closed";</script><footer>Job expired</footer><p>Apply now.</p>${usableText}`)));
    expect((await fetchJobPageContent("https://jobs.example.com/expired"))?.availability)
      .toMatchObject({ status: "closed", reason: "explicit_posting_expired" });
    expect((await fetchJobPageContent("https://jobs.example.com/open"))?.availability.status).toBe("open");
  });
  it("treats actual HTTP 404, including redirect destinations, as confirmed closure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(htmlResponse("Not found", 404))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://jobs.example.com/missing" } }))
      .mockResolvedValueOnce(htmlResponse("Not found", 404)));
    const direct = await fetchJobPageContent("https://jobs.example.com/direct");
    const redirected = await fetchJobPageContent("https://jobs.example.com/tracking");
    for (const result of [direct, redirected]) {
      expect(result?.availability).toMatchObject({ status: "closed", reason: "http_404", confidence: 1, evidence: ["http_404"] });
      expect(result?.contentUsable).toBe(false);
    }
    expect(redirected?.finalUrl).toBe("https://jobs.example.com/missing");
  });

  it.each([401, 403, 429, 500, 502, 503])("keeps HTTP %i unverified rather than closed", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse("Unavailable", status)));
    expect((await fetchJobPageContent("https://jobs.example.com/jobs/test"))?.availability)
      .toMatchObject({ status: "unverified", reason: `http_${status}` });
  });

  it("extracts authentic JobPosting fields and datePosted from JSON-LD", () => {
    const metadata = extractJobPostingMetadata(`<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Senior Product Manager",
      hiringOrganization: { name: "Example Co" },
      jobLocation: { address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "Canada" } },
      jobLocationType: "TELECOMMUTE",
      datePosted: "2025-02-03",
    })}</script>`);

    expect(metadata).toMatchObject({
      title: "Senior Product Manager",
      company: "Example Co",
      location: "Toronto, ON, Canada",
      remote: true,
      sourcePostedAt: new Date("2025-02-03"),
      fieldEvidence: {
        title: { source: "jsonld", confidence: 0.98 },
        sourcePostedAt: { source: "jsonld", confidence: 0.98 },
      },
    });
  });

  it("classifies an explicit closure but does not mistake incidental closed text", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(htmlResponse(`<p>This job is no longer available.</p>${usableText}`))
      .mockResolvedValueOnce(htmlResponse(`<p>Our office is closed on weekends. Apply now.</p>${usableText}`)));

    const closed = await fetchJobPageContent("https://jobs.example.com/jobs/closed");
    const open = await fetchJobPageContent("https://jobs.example.com/jobs/open");

    expect(closed?.availability.status).toBe("closed");
    expect(closed?.availability.reason).toBe("explicit_job_unavailable");
    expect(open?.availability.status).toBe("open");
  });

  it("does not call a readable homepage open and recognizes a short closure page", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(htmlResponse(`<p>About our company and its history.</p>${"We value great work. ".repeat(20)}`))
      .mockResolvedValueOnce(htmlResponse("<p>This job is no longer available.</p>")));
    expect((await fetchJobPageContent("https://jobs.example.com"))?.availability.status).toBe("unverified");
    expect((await fetchJobPageContent("https://jobs.example.com/removed"))?.availability.status).toBe("closed");
  });

  it("keeps access failures and JavaScript-only pages unverified", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(htmlResponse("Forbidden", 403))
      .mockResolvedValueOnce(htmlResponse("<div id=\"app\"></div><script>renderApp()</script>"))
      .mockRejectedValueOnce(new Error("The operation was aborted"))
      .mockResolvedValueOnce(htmlResponse(`<p>Sign in to view this job.</p>${usableText}`)));

    const forbidden = await fetchJobPageContent("https://jobs.example.com/jobs/forbidden");
    const jsOnly = await fetchJobPageContent("https://jobs.example.com/jobs/js");
    const timeout = await fetchJobPageContent("https://jobs.example.com/jobs/timeout");
    const login = await fetchJobPageContent("https://jobs.example.com/jobs/login");

    expect(forbidden?.availability).toMatchObject({ status: "unverified", reason: "http_403" });
    expect(jsOnly?.availability).toMatchObject({ status: "unverified", reason: "insufficient_rendered_content" });
    expect(timeout?.availability).toMatchObject({ status: "unverified", reason: "timeout" });
    expect(login?.availability).toMatchObject({ status: "unverified", reason: "login wall" });
  });

  it("does not fetch private or mixed private/public DNS results", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(usableText));
    vi.stubGlobal("fetch", fetchMock);

    const privateHost = await fetchJobPageContent("https://jobs.example.com/private");
    expect(privateHost?.availability).toMatchObject({ status: "unverified", reason: "unsafe_url" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.12", family: 4 },
    ] as never);
    const mixedDns = await fetchJobPageContent("https://jobs.example.com/mixed-dns");
    expect(mixedDns?.availability).toMatchObject({ status: "unverified", reason: "unsafe_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects local IPv6 addresses and does not return URL credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(usableText));
    vi.stubGlobal("fetch", fetchMock);

    const localIpv6 = await fetchJobPageContent("http://[::1]/job");
    const credentialed = await fetchJobPageContent("https://user:secret@jobs.example.com/job");

    expect(localIpv6?.availability).toMatchObject({ status: "unverified", reason: "unsafe_url" });
    expect(credentialed?.availability).toMatchObject({ status: "unverified", reason: "unsafe_url" });
    expect(credentialed?.finalUrl).not.toContain("user");
    expect(credentialed?.finalUrl).not.toContain("secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a redirect destination before fetching it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJobPageContent("https://jobs.example.com/job");

    expect(result?.availability).toMatchObject({ status: "unverified", reason: "unsafe_redirect" });
    expect(result?.finalUrl).toBe("https://jobs.example.com/job");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://jobs.example.com/job"),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows public redirects manually and checks DNS for every hop", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", {
        status: 302,
        headers: { location: "https://careers.example.net/open-role" },
      }))
      .mockResolvedValueOnce(htmlResponse(`<p>Apply now. Responsibilities and qualifications.</p>${usableText}`));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJobPageContent("https://jobs.example.com/redirect");

    expect(result?.availability.status).toBe("open");
    expect(result?.finalUrl).toBe("https://careers.example.net/open-role");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(lookup)).toHaveBeenCalledWith("jobs.example.com", { all: true, verbatim: true });
    expect(vi.mocked(lookup)).toHaveBeenCalledWith("careers.example.net", { all: true, verbatim: true });
  });

  it("stops after five redirects rather than following an unbounded chain", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("", {
      status: 302,
      headers: { location: "/another-hop" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJobPageContent("https://jobs.example.com/start");

    expect(result?.availability).toMatchObject({ status: "unverified", reason: "too_many_redirects" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not infer sourcePostedAt from any non-JSON-LD page content", () => {
    expect(extractJobPostingMetadata(`<p>Posted on 2025-01-01</p>`)).toBeNull();
  });
});