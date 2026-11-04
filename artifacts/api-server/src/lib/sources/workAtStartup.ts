import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";
import { publicJobUrl } from "./jobLinks";

/** Public Rails/Inertia bootstrap includes the jobs even though anchors render in JS. */
export function parseWorkAtStartupPage(raw: string, provider: string): OnlineJobCandidate[] {
  const encoded = raw.match(/\bdata-page=(["'])([\s\S]*?)\1/i)?.[2];
  if (!encoded) throw new Error("Work at a Startup page did not contain public job-list data.");
  const decoded = encoded.replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
  let payload: { props?: { jobs?: unknown } };
  try { payload = JSON.parse(decoded); } catch { throw new Error("Work at a Startup returned unreadable public job-list data."); }
  if (!Array.isArray(payload?.props?.jobs)) throw new Error("Work at a Startup page did not contain its expected job list.");
  const jobs = new Map<string, OnlineJobCandidate>();
  for (const item of payload.props.jobs.slice(0, 120)) {
    if (!item || typeof item !== "object") continue;
    const job = item as Record<string, unknown>;
    const title = typeof job.title === "string" ? htmlToPlainText(job.title) : "";
    const company = typeof job.companyName === "string" ? htmlToPlainText(job.companyName) : "";
    const id = String(job.id ?? "");
    if (!title || !company || !/^[1-9]\d*$/.test(id)) continue;
    const url = publicJobUrl(`/jobs/${id}`, "https://www.workatastartup.com");
    if (!url) continue;
    const location = typeof job.location === "string" ? htmlToPlainText(job.location) : null;
    jobs.set(url, {
      provider, sourceJobId: id, title, company, url, location,
      remote: /\bremote\b/i.test(location ?? ""),
      description: [title, company, location, typeof job.companyOneLiner === "string" ? htmlToPlainText(job.companyOneLiner) : ""].filter(Boolean).join("\n"),
      tags: [], postedAt: null,
    });
  }
  if (payload.props.jobs.length > 0 && jobs.size === 0) {
    throw new Error("Work at a Startup job records did not contain usable titles, companies and identifiers.");
  }
  return [...jobs.values()];
}
