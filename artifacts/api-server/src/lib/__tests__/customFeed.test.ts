import { describe, expect, it } from "vitest";
import { parseCustomFeed, validatePublicFeedUrl } from "../sources/customFeed";

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
});