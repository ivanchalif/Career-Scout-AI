import { describe, expect, it, vi } from "vitest";
import { parseCustomFeed } from "../sources/customFeed";
import { parseHtmlListings } from "../sources/htmlListings";
import { expandSearchListings } from "../sources/expandListings";
import { jobLinkKind } from "../sources/jobLinks";
import type { OnlineJobCandidate } from "../sources/arbeitnow";
import { parseHiringCafePage } from "../sources/hiringCafe";

const candidate = (url: string): OnlineJobCandidate => ({
  provider: "brave:test", sourceJobId: url, title: "Product jobs", company: "Example",
  url, location: null, remote: false, description: "", tags: [], postedAt: null,
});

describe("HTML sources and job-list expansion", () => {
  it("extracts all JSON-LD postings including graph and nested ItemList entries", () => {
    const job = (id: string, location: string) => ({
      "@type": "JobPosting", title: `Product Manager ${id}`, hiringOrganization: { name: "Example" },
      url: `/roles/${id}`, description: "<p>Roadmaps &amp; discovery</p>", datePosted: "2026-11-01",
      jobLocation: [{ address: { addressLocality: location, addressRegion: "CA" } }],
    });
    const raw = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [job("1", "San Francisco"), { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", item: job("2", "Oakland") }] }],
    })}</script>`;
    const jobs = parseCustomFeed(raw, "text/html", "custom:test", "https://example.com/careers");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ title: "Product Manager 1", company: "Example", location: "San Francisco, CA", description: "Roadmaps & discovery", url: "https://example.com/roles/1" });
    expect(jobs[1].postedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("parses Lever listing anchors with real title, company and location", () => {
    const jobs = parseHtmlListings(`
      <a href="/example">All jobs</a><a href="/example/abc">Apply</a>
      <a class="posting-title" href="/example/abc"><h5>Senior Product Manager</h5>
      <span class="workplaceTypes">Remote</span><span class="posting-category location">San Francisco, CA</span></a>
    `, "https://jobs.lever.co/example", "test");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: "Senior Product Manager", company: "example", location: "San Francisco, CA", remote: true, url: "https://jobs.lever.co/example/abc" });
  });

  it("parses individual Greenhouse links, not the job-board navigation", () => {
    const jobs = parseHtmlListings('<a href="/example">Example jobs</a><a href="/example/jobs/123"><p class="body body--medium">Product Manager</p><p class="body body__secondary body--metadata">San Francisco, CA</p></a>',
      "https://job-boards.greenhouse.io/example", "test");
    expect(jobs.map(j => j.url)).toEqual(["https://job-boards.greenhouse.io/example/jobs/123"]);
    expect(jobs[0]).toMatchObject({ title: "Product Manager", location: "San Francisco, CA" });
  });

  it("extracts titled ItemList links and preserves unknown facts", () => {
    const raw = `<script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList", itemListElement: [
        { "@type": "ListItem", name: "Product Manager at Example", url: "/jobs/123" },
        { "@type": "ListItem", name: "All jobs at Example", url: "/jobs" },
        { "@type": "ListItem", name: "Unsafe at Example", url: "https://localhost/jobs/1" },
      ],
    })}</script>`;
    const jobs = parseHtmlListings(raw, "https://example.com/careers", "test");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: "Product Manager", company: "Example", location: null, remote: false, postedAt: null });
  });

  it("accepts explicit empty job lists but reports unsupported or gated HTML", () => {
    expect(parseHtmlListings('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[]}</script>', "https://example.com/jobs", "test")).toEqual([]);
    expect(() => parseCustomFeed("<html>Sign in to continue</html>", "text/html", "test", "https://example.com/jobs")).toThrow("no readable job listings");
    expect(() => parseCustomFeed("<html>Jobs</html>", "text/html", "test")).toThrow("source URL");
    expect(() => parseHiringCafePage('<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>', "test")).toThrow("expected job list");
    expect(parseHiringCafePage('<script id="__NEXT_DATA__">{"props":{"pageProps":{"ssrHits":[]}}}</script>', "test")).toEqual([]);
  });

  it("extracts Work at a Startup jobs from HTML-escaped public page data, not sign-in links", () => {
    const data = JSON.stringify({ props: { jobs: [
      { id: 107562, title: "Product Manager", companyName: "Example", location: "US / Remote (US)", companyOneLiner: "Build useful tools", applyUrl: "https://account.ycombinator.com/authenticate" },
      { id: 107563, title: "Product Lead", companyName: "Other", location: "San Francisco, CA" },
    ] } }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const jobs = parseCustomFeed(`<html><div data-page="${data}"></div></html>`, "text/html", "brave:startup", "https://www.workatastartup.com/jobs/r/product-manager");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ title: "Product Manager", company: "Example", remote: true, url: "https://www.workatastartup.com/jobs/107562", postedAt: null });
    expect(jobs[1].location).toBe("San Francisco, CA");
    expect(() => parseCustomFeed("<html>Sign in</html>", "text/html", "test", "https://workatastartup.com/jobs/r/product-manager")).toThrow("public job-list data");
  });

  it.each([
    ["https://jobs.lever.co/example", "listing"],
    ["https://jobs.lever.co/example/abc", "job"],
    ["https://job-boards.greenhouse.io/example", "listing"],
    ["https://boards.greenhouse.io/embed/job_app?for=example&token=123", "job"],
    ["https://workatastartup.com/jobs/r/product-manager", "listing"],
    ["https://workatastartup.com/jobs/57262", "job"],
    ["https://linkedin.com/jobs/search?keywords=product", "listing"],
    ["https://www.linkedin.com/jobs/view/product-manager-123", "job"],
    ["https://jobright.ai/jobs/info/123", "job"],
    ["https://hiringcafe.com/?searchState=x", "listing"],
    ["https://warmada.com/jobs/product-management/", "listing"],
    ["https://warmada.com/job/example-123", "job"],
    ["https://example.com/careers", "listing"],
  ])("classifies %s as %s", (url, kind) => {
    expect(jobLinkKind(url)).toBe(kind);
  });

  it("expands company/category results, preserving individual results and source attribution", async () => {
    const listing = candidate("https://jobs.lever.co/example");
    const job = candidate("https://jobs.lever.co/example/123");
    const fetch = vi.fn().mockResolvedValue([job]);
    const warn = vi.fn();
    const result = await expandSearchListings([listing, listing, candidate("https://example.com/roles/42")], fetch, warn);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(listing.url, listing.provider);
    expect(result).toEqual([job, candidate("https://example.com/roles/42")]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never imports a listing on failure and bounds expansion requests", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("blocked 403"));
    const warn = vi.fn();
    const listings = ["a", "b", "c", "d"].map(company => candidate(`https://jobs.lever.co/${company}`));
    const result = await expandSearchListings(listings, fetch, warn);
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("blocked 403"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("expansion limit"));
  });
});
