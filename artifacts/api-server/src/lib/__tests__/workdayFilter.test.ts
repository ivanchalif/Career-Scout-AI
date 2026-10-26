import { describe, expect, it } from "vitest";
import { isHiddenByWorkday } from "../workdayFilter";

describe("recoverable Workday ATS visibility", () => {
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
