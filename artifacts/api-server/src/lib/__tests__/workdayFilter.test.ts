import { describe, expect, it } from "vitest";
import { isHiddenByWorkday } from "../workdayFilter";

describe("recoverable Workday ATS visibility", () => {
  it("uses the actual landing URL even if the imported link is an aggregator and identity is unverified", () => {
    const posting = {
      link: "https://example.com/redirect/job/123",
      jobIdentity: { finalUrl: "https://company.wd5.myworkdayjobs.com/en-US/Careers/job/123" },
    };
    expect(isHiddenByWorkday(posting)).toBe(true);
    expect(isHiddenByWorkday(posting, { excludeWorkday: false })).toBe(false);
  });
  it("uses the original application URL without treating a mere mention as Workday", () => {
    expect(isHiddenByWorkday({
      link: "https://example.com/job/123",
      jobIdentity: { originalUrl: "https://company.myworkdayjobs.com/jobs/123" },
    })).toBe(true);
    expect(isHiddenByWorkday({
      jobIdentity: { finalUrl: "https://example.com/jobs?description=myworkdayjobs" },
    })).toBe(false);
  });
  it.each([
    "https://company.wd5.myworkdayjobs.com/en-US/Careers/job/123",
    "https://wd3.myworkdaysite.com/recruiting/company/jobs/job/123",
    "https://MYWORKDAYJOBS.COM/jobs/123",
  ])("hides verified ATS links by default: %s", (link) => {
    expect(isHiddenByWorkday({ link })).toBe(true);
    expect(isHiddenByWorkday({ link }, { excludeWorkday: true })).toBe(true);
    expect(isHiddenByWorkday({ link }, { excludeWorkday: false })).toBe(false);
  });

  it.each([
    null, undefined, "", "not a URL",
    "https://linkedin.com/jobs/view/123",
    "https://myworkdayjobs.com.evil.example/jobs",
    "https://example.com/myworkdayjobs.com",
    "https://workday.com/company/product-manager",
  ])("does not guess ATS from unknown links or company names: %s", (link) => {
    expect(isHiddenByWorkday({ link })).toBe(false);
  });

  it("never changes a posting or its application history", () => {
    const posting = { link: "https://company.myworkdayjobs.com/jobs/123", appliedAt: new Date(), deletedAt: null };
    const before = { ...posting };
    expect(isHiddenByWorkday(posting)).toBe(true);
    expect(posting).toEqual(before);
  });
});
