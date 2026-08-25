import { describe, expect, it } from "vitest";
import { htmlToPlainText, parseArbeitnowPayload } from "../sources/arbeitnow";

describe("Arbeitnow source adapter", () => {
  it("normalizes valid feed records and ignores unusable entries", () => {
    const jobs = parseArbeitnowPayload({
      data: [
        {
          slug: "principal-product-manager-123",
          title: "Principal Product Manager",
          company_name: "Example Co",
          description: "<p>Build <strong>great</strong> products.</p>",
          url: "https://jobs.example.com/roles/123?utm_source=arbeitnow",
          location: "Remote - United States",
          remote: true,
          tags: ["Product", "SaaS"],
          created_at: 1_700_000_000,
        },
        { title: "Missing company", url: "https://example.com" },
      ],
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "arbeitnow",
      sourceJobId: "principal-product-manager-123",
      title: "Principal Product Manager",
      company: "Example Co",
      remote: true,
      tags: ["Product", "SaaS"],
    });
    expect(jobs[0]?.description).toContain("Build great products.");
  });

  it("converts job HTML into readable plain text", () => {
    expect(htmlToPlainText("<script>ignore()</script><p>Hello&nbsp;world</p><ul><li>One</li></ul>"))
      .toBe("Hello world\nOne");
  });
});