export interface OnlineJobCandidate {
  provider: string;
  sourceJobId: string | null;
  title: string;
  company: string;
  description: string;
  url: string;
  location: string | null;
  remote: boolean;
  tags: string[];
  postedAt: Date | null;
}

type ArbeitnowJob = {
  slug?: unknown;
  title?: unknown;
  company_name?: unknown;
  description?: unknown;
  url?: unknown;
  location?: unknown;
  remote?: unknown;
  tags?: unknown;
  created_at?: unknown;
};

const MAX_DESCRIPTION_CHARS = 12_000;

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]{2,8};/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseArbeitnowPayload(payload: unknown): OnlineJobCandidate[] {
  const jobs = (payload as { data?: unknown })?.data;
  if (!Array.isArray(jobs)) throw new Error("Arbeitnow returned an invalid response.");

  return (jobs as ArbeitnowJob[]).flatMap((job) => {
    const title = typeof job.title === "string" ? job.title.trim() : "";
    const company = typeof job.company_name === "string" ? job.company_name.trim() : "";
    const url = typeof job.url === "string" ? job.url.trim() : "";
    if (!title || !company || !url) return [];

    const createdAt = typeof job.created_at === "number" ? new Date(job.created_at * 1_000) : null;
    return [{
      provider: "arbeitnow" as const,
      sourceJobId: typeof job.slug === "string" && job.slug.trim() ? job.slug.trim() : null,
      title,
      company,
      description: htmlToPlainText(typeof job.description === "string" ? job.description : "").slice(0, MAX_DESCRIPTION_CHARS),
      url,
      location: typeof job.location === "string" && job.location.trim() ? job.location.trim() : null,
      remote: job.remote === true,
      tags: Array.isArray(job.tags) ? job.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 25) : [],
      postedAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    }];
  });
}

export async function fetchArbeitnowJobs(): Promise<OnlineJobCandidate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "CareerScout/1.0" },
    });
    if (!response.ok) throw new Error(`Arbeitnow request failed (${response.status}).`);
    return parseArbeitnowPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}