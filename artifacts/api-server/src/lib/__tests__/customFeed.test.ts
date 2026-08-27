import { describe, expect, it } from "vitest";
import { parseCustomFeed, validatePublicFeedUrl } from "../sources/customFeed";
import { isGoogleSearchUrl, parseBraveSearchResults, parseGoogleSearchResults } from "../sources/googleSearch";
import { isHiringCafeUrl, parseHiringCafePage } from "../sources/hiringCafe";

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

  it("accepts Lever board links without a /jobs path", () => {
    const searchUrl = "https://www.google.com/search?q=site%3Alever.co+%22Head+of+Product%22+%22San+Francisco%22";
    const jobs = parseBraveSearchResults({
      web: {
        results: [{
          title: "Crunchbase - Head of Product",
          url: "https://jobs.lever.co/crunchbase/909f1a52-fb98-47f9-828b-bb4cc1268b88",
          description: "Lead product strategy in San Francisco.",
        }],
      },
    }, searchUrl, "brave:24");

    expect(jobs[0]).toMatchObject({
      title: "Head of Product",
      company: "Crunchbase",
      location: "San Francisco, United States",
    });
  });

  it("normalizes server-rendered HiringCafe jobs", () => {
    const url = "https://hiringcafe.com/?searchState=%7B%22departments%22%3A%5B%22Product%20Management%22%5D%7D";
    const jobs = parseHiringCafePage(`
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            ssrHits: [{
              id: "role-1",
              apply_url: "https://jobs.example.com/role-1",
              job_information: { title: "Head of Product" },
              attributed_org: { name: "Example Co" },
              v5_processed_job_data: {
                requirements_summary: "Ten years of product leadership.",
                role_activities: ["product strategy"],
                job_category: "Product Management",
                formatted_workplace_location: "San Francisco, California, United States",
                workplace_type: "Hybrid",
              },
            }],
          },
        },
      })}</script>
    `, "hiringcafe:13");

    expect(isHiringCafeUrl(url)).toBe(true);
    expect(jobs[0]).toMatchObject({
      title: "Head of Product",
      company: "Example Co",
      location: "San Francisco, California, United States",
      remote: false,
    });
  });
});