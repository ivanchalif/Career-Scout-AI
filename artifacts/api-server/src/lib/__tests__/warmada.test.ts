import { describe, expect, it } from "vitest";
import { parseWarmadaPage } from "../sources/warmada";

function row(title = "Lead Product Manager", company = "Example &amp; Co", location = "San Francisco, CA", arrangement = "Hybrid", href = "/job/example-123") {
  return `<a class="job-row-link" href="${href}"><span class="job-row-title">${title}</span><span class="job-row-company">${company}</span><span class="job-row-meta"><span>${location}</span><span>${arrangement}</span><span>$183K–$283K a year</span><span>Posted today</span></span></a>`;
}

describe("Warmada HTML listing parser", () => {
  it("extracts real listing fields rather than silently returning no jobs", () => {
    const [job] = parseWarmadaPage(`<html>${row()}</html>`, "custom:43");
    expect(job).toMatchObject({ provider: "custom:43", title: "Lead Product Manager", company: "Example & Co", location: "San Francisco, CA", remote: false, url: "https://warmada.com/job/example-123", postedAt: null });
  });
  it("keeps remote location evidence and does not infer a date from relative text", () => {
    const [job] = parseWarmadaPage(row("Product Manager", "Example", "Remote - USA", "Remote"), "test");
    expect(job.location).toBe("Remote - USA");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBeNull();
  });
  it("deduplicates rows and rejects links outside the expected public job host", () => {
    const jobs = parseWarmadaPage(row() + row() + row("Bad", "Bad", "NY", "Remote", "https://evil.example/job/1"), "test");
    expect(jobs).toHaveLength(1);
  });
  it("fails explicitly on unreadable markup but accepts an explicit empty listing page", () => {
    expect(() => parseWarmadaPage("<title>115 Product Management Jobs</title>", "test")).toThrow("readable job listings");
    expect(parseWarmadaPage("<title>0 Product Management Jobs | Warmada</title>", "test")).toEqual([]);
  });
});
