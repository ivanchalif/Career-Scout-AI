import { describe, expect, it } from "vitest";
import { parseCustomFeed, validatePublicFeedUrl } from "../sources/customFeed";
import { isGoogleSearchUrl, parseBraveSearchResults, parseGoogleSearchResults } from "../sources/googleSearch";

describe("Custom online job feeds", () => {
  it("normalizes common JSON job feed shapes", () => {
    const jobs = parseCustomFeed(JSON.stringify({
      jobs: [{
        id: "role-7",
        title: "Staff Product Manager",
        company_name: "Example Co",
        description: "<p>Own product discovery and strategy.</p>",
        apply_url: "https://jobs.example.com/roles/7",
        location: "Remote — Canada",
        remote: true,
        skills: ["Product", "Strategy"],
        created_at: "2026-08-20T12:00:00.000Z",
      }],
    }), "application/json", "custom:10");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "custom:10",
      sourceJobId: "role-7",
      title: "Staff Product Manager",
      company: "Example Co",
      remote: true,
      tags: ["Product", "Strategy"],
    });
    expect(jobs[0]?.description).toContain("Own product discovery and strategy.");
  });

  it("normalizes public RSS and Atom style entries", () => {
    const jobs = parseCustomFeed(`
      <rss><channel><item>
        <guid>rss-25</guid>
        <title>Senior Product Manager</title>
        <company>Example Co</company>
        <description><![CDATA[<p>Build roadmap and lead discovery.</p>]]></description>
        <link>https://jobs.example.com/roles/25</link>
        <location>United States — Remote</location>
        <pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate>
      </item></channel></rss>
    `, "application/rss+xml", "custom:11");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "custom:11",
      sourceJobId: "rss-25",
      title: "Senior Product Manager",
      company: "Example Co",
      remote: true,
    });
    expect(jobs[0]?.url).toBe("https://jobs.example.com/roles/25");
  });

  it("only accepts public HTTPS feed URLs", () => {
    expect(validatePublicFeedUrl("https://feeds.example.com/jobs.rss").hostname).toBe("feeds.example.com");
    expect(() => validatePublicFeedUrl("http://feeds.example.com/jobs.rss")).toThrow("HTTPS");
    expect(() => validatePublicFeedUrl("https://127.0.0.1/feed.json")).toThrow("public HTTPS host");
    expect(() => validatePublicFeedUrl("https://192.168.1.5/feed.json")).toThrow("public HTTPS host");
  });

  it("normalizes Google Search job result links with a US location hint", () => {
    const searchUrl = "https://www.google.com/search?q=site%3Agreenhouse.io+%22Head+of+Product%22+%22San+Francisco%22";
    const jobs = parseGoogleSearchResults(`
      <a href="/url?q=https%3A%2F%2Fjob-boards.greenhouse.io%2Fnorthbeam%2Fjobs%2F12345&amp;sa=U">
        <h3>Job Application for Head of Product at Northbeam</h3>
      </a>
    `, searchUrl, "google:21");

    expect(isGoogleSearchUrl(searchUrl)).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "google:21",
      title: "Head of Product",
      company: "Northbeam",
      location: "San Francisco, United States",
    });
    expect(jobs[0]?.url).toBe("https://job-boards.greenhouse.io/northbeam/jobs/12345");
  });

  it("normalizes Brave results for a saved Google query", () => {
    const searchUrl = "https://www.google.com/search?q=site%3Agreenhouse.io+%22Head+of+Product%22+%22San+Francisco%22";
    const jobs = parseBraveSearchResults({
      web: {
        results: [{
          title: "Job Application for Head of Product at Northbeam",
          url: "https://job-boards.greenhouse.io/northbeam/jobs/12345",
          description: "Lead product strategy and build a world-class product organization.",
        }],
      },
    }, searchUrl, "brave:21");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "brave:21",
      title: "Head of Product",
      company: "Northbeam",
      location: "San Francisco, United States",
      remote: false,
    });
  });

  it("maps Canadian query locations to Canada", () => {
    const searchUrl = "https://www.google.com/search?q=site%3Agreenhouse.io+%22Product+Director%22+Toronto";
    const jobs = parseBraveSearchResults({
      web: {
        results: [{
          title: "Product Director at Example",
          url: "https://job-boards.greenhouse.io/example/jobs/987",
          description: "Build products in Toronto.",
        }],
      },
    }, searchUrl, "brave:22");

    expect(jobs[0]?.location).toBe("Toronto, Canada");
  });

  it("ignores empty or non-job Brave result sets", () => {
    const searchUrl = "https://www.google.com/search?q=%22Head+of+Product%22+%22San+Francisco%22";
    expect(parseBraveSearchResults({}, searchUrl, "brave:23")).toEqual([]);
    expect(parseBraveSearchResults({
      web: { results: [{ title: "Product news", url: "https://example.com/blog/product" }] },
    }, searchUrl, "brave:23")).toEqual([]);
  });
});