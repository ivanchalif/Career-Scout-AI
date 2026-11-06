import { describe, expect, it } from "vitest";
import { atsIdentity, canonicalizeJobUrl, compareJobs, individualJobUrl, normalizeEmployer, normalizeTitle, pairKey } from "../duplicatePolicy";

const a = { title: "Senior Product Manager (AI)", company: "Acme Technologies, Inc.", link: "https://jobs.lever.co/acme/req-1", location: "San Francisco, CA" };
describe("duplicate evidence", () => {
  it("unwraps LinkedIn login redirects and ignores email tracking", () => {
    const publicUrl = "https://www.linkedin.com/jobs/view/4485526932/";
    const wrapper = `https://www.linkedin.com/uas/login?session_redirect=${encodeURIComponent(`${publicUrl}?trackingId=first`)}&skipRedirect=true`;
    const other = `https://www.linkedin.com/ssr-login/passwordless-email-login?session_redirect=${encodeURIComponent(`${publicUrl}?trackingId=second`)}&otpToken=not-a-real-token`;
    expect(canonicalizeJobUrl(wrapper)).toBe("https://linkedin.com/jobs/view/4485526932");
    expect(compareJobs({ ...a, link: wrapper }, { ...a, link: other }).kind).toBe("duplicate");
    expect(compareJobs({ ...a, link: wrapper }, { ...a, link: publicUrl }).kind).toBe("duplicate");
  });
  it.each([
    "https://evil.example/jobs/view/4485526932",
    "https://linkedin.com.evil.example/jobs/view/4485526932",
    "https://user:pass@linkedin.com/jobs/view/4485526932",
    "javascript:alert(1)",
  ])("does not trust unsafe or foreign LinkedIn redirect targets: %s", (target) => {
    const link = `https://www.linkedin.com/uas/login?session_redirect=${encodeURIComponent(target)}`;
    expect(individualJobUrl(link)).toBeNull();
  });
  it("recognizes stable Jobright IDs despite changing impression IDs", () => {
    const link = "https://jobright.ai/jobs/info/6ac43d34064da25272e12265";
    expect(compareJobs({ ...a, link: `${link}?imp_id=first&utm_source=email` },
      { ...a, link: `${link}?imp_id=second&utm_source=another` }).kind).toBe("duplicate");
  });
  it.each([
    ["https://linkedin.com/jobs/view/123", "https://linkedin.com/jobs/view/456"],
    ["https://jobright.ai/jobs/info/abc", "https://jobright.ai/jobs/info/def"],
  ])("preserves distinct provider job IDs even with matching text", (first, second) => {
    expect(compareJobs({ ...a, link: first }, { ...a, link: second }).kind).toBe("distinct");
  });
  it("preserves functional job identifiers on unknown providers", () => {
    expect(compareJobs({ ...a, link: "https://example.org/jobs?jobId=123" },
      { ...a, link: "https://example.org/jobs?jobId=456" }).kind).not.toBe("duplicate");
  });
  it("rejects the real Uber/Cultura false positive", () => {
    expect(compareJobs(
      { title: "Sr Product Manager - Uber Parcel", company: "Uber Technologies, Inc." },
      { title: "Product Manager", company: "Cultura Technologies" },
    ).kind).toBe("distinct");
  });
  it("keeps meaningful employer words and parenthetical title details", () => {
    expect(normalizeEmployer("Cultura Technologies, Inc.")).toBe("cultura technologies");
    expect(normalizeEmployer("Uber Technologies, Inc.")).toBe("uber technologies");
    expect(normalizeTitle(a.title)).toContain("ai");
  });
  it("recognizes exact individual URLs despite tracking", () => {
    expect(compareJobs(a, { ...a, title: "Different source wording", link: `${a.link}?utm_source=mail` }).kind).toBe("duplicate");
  });
  it("recognizes the same employer-scoped requisition across apply URLs", () => {
    expect(compareJobs(a, { ...a, link: `${a.link}/apply` }).kind).toBe("duplicate");
  });
  it("does not confuse IDs at different employers", () => {
    expect(compareJobs(a, { ...a, company: "Different Employer", link: "https://jobs.lever.co/other/req-1" }).kind).toBe("distinct");
  });
  it("different requisition IDs are different jobs regardless of text", () => {
    expect(compareJobs(a, { ...a, link: "https://jobs.lever.co/acme/req-2" }).kind).toBe("distinct");
  });
  it.each(["https://example.com", "https://example.com/careers", "https://jobs.lever.co/acme", "https://example.com/jobs/search", "https://example.com/jobs?department=product"])("does not equate collection URLs: %s", (link) => {
    expect(individualJobUrl(link)).toBeNull();
    expect(compareJobs({ ...a, title: "Product Manager", link }, { ...a, title: "Product Manager", link }).kind).not.toBe("duplicate");
  });
  it("same title and company are not enough even with the same location", () => {
    expect(compareJobs({ ...a, title: "Product Manager", link: null }, { ...a, title: "Product Manager", link: null }).kind).toBe("distinct");
  });
  it("same employer/title/specialty offers review, never automatic removal", () => {
    const result = compareJobs({ ...a, link: null }, { ...a, company: "Acme Technologies", link: null });
    expect(result.kind).toBe("review");
    expect(result.evidence).toContain("Matching specialty or team terms in both titles");
  });
  it.each([
    { title: "Junior Product Manager (AI)" },
    { title: "Senior Product Manager (Security)" },
    { location: "Alpharetta, GA" },
    { company: "Other Technologies" },
  ])("meaningful role or employer differences prevent review: %j", (change) => {
    expect(compareJobs({ ...a, link: null }, { ...a, link: null, ...change }).kind).toBe("distinct");
  });
  it("only substantially matching descriptions support generic-title review", () => {
    const description = "Lead cross functional product strategy, roadmap delivery and customer research across the platform. ".repeat(4);
    expect(compareJobs({ ...a, title: "Product Manager", link: null, fullDescription: description },
      { ...a, title: "Product Manager", link: null, fullDescription: description }).kind).toBe("review");
  });
  it("scopes ATS IDs to both vendor and employer", () => {
    expect(atsIdentity(a.link)).toEqual({ scope: "lever:acme", id: "req-1" });
    expect(pairKey(10, 2)).toBe("2:10");
  });
});
