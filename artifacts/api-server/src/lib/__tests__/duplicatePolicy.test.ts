import { describe, expect, it } from "vitest";
import { atsIdentity, compareJobs, individualJobUrl, normalizeEmployer, normalizeTitle, pairKey } from "../duplicatePolicy";

const a = { title: "Senior Product Manager (AI)", company: "Acme Technologies, Inc.", link: "https://jobs.lever.co/acme/req-1", location: "San Francisco, CA" };
describe("duplicate evidence", () => {
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
