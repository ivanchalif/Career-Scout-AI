import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";
import { validatePublicFeedUrl } from "./customFeed";

const MAX_RESULTS = 40;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

export function isHiringCafeUrl(rawUrl: string): boolean {
  try {
    const url = validatePublicFeedUrl(rawUrl);
    return url.hostname === "hiringcafe.com" || url.hostname === "www.hiringcafe.com";
  } catch {
    return false;
  }
}

export function validateHiringCafeUrl(rawUrl: string): URL {
  const url = validatePublicFeedUrl(rawUrl);
  if (url.hostname !== "hiringcafe.com" && url.hostname !== "www.hiringcafe.com") {
    throw new Error("HiringCafe source must use a hiringcafe.com URL.");
  }
  return url;
}

export function parseHiringCafePage(raw: string, provider: string): OnlineJobCandidate[] {
  const nextData = raw.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!nextData) throw new Error("HiringCafe page did not contain job data.");
  const payload = JSON.parse(nextData) as JsonRecord;
  const pageProps = record(record(payload.props).pageProps);
  const hits = Array.isArray(pageProps.ssrHits) ? pageProps.ssrHits : [];

  return hits.slice(0, MAX_RESULTS).flatMap((rawHit) => {
    const hit = record(rawHit);
    const job = record(hit.job_information);
    const processed = record(hit.v5_processed_job_data);
    const organization = record(hit.attributed_org);
    const title = text(job.title) || text(processed.core_job_title);
    const company = text(organization.name) || text(hit.company_name);
    const url = text(hit.apply_url);
    if (!title || !company || !url) return [];
    const activities = stringList(processed.role_activities);
    const tools = stringList(processed.technical_tools);
    const description = [
      text(processed.requirements_summary),
      activities.length > 0 ? `Responsibilities: ${activities.join(", ")}` : "",
    ].filter(Boolean).join(" ");
    const location = text(processed.formatted_workplace_location)
      || stringList(processed.workplace_cities)[0]
      || stringList(processed.workplace_states)[0]
      || stringList(processed.workplace_countries)[0]
      || null;
    const workplaceType = text(processed.workplace_type);
    const dateText = text(hit.date_fetched) || text(hit.date_posted);
    const postedAt = dateText && !Number.isNaN(new Date(dateText).getTime()) ? new Date(dateText) : null;

    return [{
      provider,
      sourceJobId: text(hit.id) || text(hit.objectID) || url,
      title,
      company,
      description: htmlToPlainText(description || title).slice(0, 12_000),
      url,
      location,
      remote: /\bremote\b/i.test(workplaceType),
      tags: [...new Set([text(processed.job_category), ...activities, ...tools].filter(Boolean))].slice(0, 25),
      postedAt,
    }];
  });
}

export async function fetchHiringCafeJobs(rawUrl: string, provider: string): Promise<OnlineJobCandidate[]> {
  let url = validateHiringCafeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: "text/html",
          "User-Agent": "CareerScout/1.0",
        },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      url = validateHiringCafeUrl(new URL(location, url).toString());
      response = undefined;
    }
    if (!response) throw new Error("HiringCafe source followed too many redirects.");
    if (!response.ok) throw new Error(`HiringCafe request failed (${response.status}).`);
    return parseHiringCafePage(await response.text(), provider);
  } finally {
    clearTimeout(timeout);
  }
}