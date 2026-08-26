import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";

const MAX_DESCRIPTION_CHARS = 12_000;

type GenericJobRecord = Record<string, unknown>;

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(record: GenericJobRecord, keys: string[]): string {
  for (const key of keys) {
    const value = textValue(record[key]);
    if (value) return value;
  }
  return "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function recordsFromJson(payload: unknown): GenericJobRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is GenericJobRecord => Boolean(item) && typeof item === "object");
  if (!payload || typeof payload !== "object") return [];
  const root = payload as GenericJobRecord;
  for (const key of ["data", "jobs", "results", "items", "listings"]) {
    if (Array.isArray(root[key])) {
      return root[key].filter((item): item is GenericJobRecord => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function candidateFromRecord(record: GenericJobRecord, provider: string, fallbackUrl?: string): OnlineJobCandidate | null {
  const title = firstText(record, ["title", "name", "job_title", "jobTitle"]);
  const company = firstText(record, ["company", "company_name", "companyName", "employer", "organization"]);
  const url = firstText(record, ["url", "link", "job_url", "jobUrl", "apply_url", "applyUrl"]) || fallbackUrl || "";
  if (!title || !company || !url) return null;

  const description = firstText(record, ["description", "summary", "content", "body", "snippet"]);
  const location = firstText(record, ["location", "job_location", "jobLocation", "city"]);
  const remoteType = firstText(record, ["remoteType", "remote_type", "workMode", "work_mode"]).toLowerCase();
  const tagsValue = record.tags ?? record.skills;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 25)
    : [];

  return {
    provider,
    sourceJobId: firstText(record, ["id", "guid", "slug", "job_id", "jobId"]) || null,
    title,
    company,
    description: htmlToPlainText(description).slice(0, MAX_DESCRIPTION_CHARS),
    url,
    location: location || null,
    remote: record.remote === true || ["remote", "fully remote", "work from home"].includes(remoteType),
    tags,
    postedAt: parseDate(record.postedAt ?? record.posted_at ?? record.createdAt ?? record.created_at ?? record.date),
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function xmlTag(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match?.[1]) return decodeXml(match[1]);
  }
  return "";
}

function xmlLink(block: string): string {
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)?.[1];
  if (href) return decodeXml(href);
  return xmlTag(block, ["link", "url"]);
}

function parseXmlFeed(raw: string, provider: string): OnlineJobCandidate[] {
  const entries = raw.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return entries.flatMap((entry) => {
    const candidate = candidateFromRecord({
      title: xmlTag(entry, ["title"]),
      company: xmlTag(entry, ["company", "company_name", "employer", "author"]),
      description: xmlTag(entry, ["description", "summary", "content", "content:encoded"]),
      url: xmlLink(entry),
      location: xmlTag(entry, ["location", "job_location"]),
      id: xmlTag(entry, ["guid", "id"]),
      date: xmlTag(entry, ["pubDate", "published", "updated", "date"]),
      remote: /\bremote\b/i.test(`${xmlTag(entry, ["location"])} ${xmlTag(entry, ["description", "summary"])}`),
    }, provider);
    return candidate ? [candidate] : [];
  });
}

export function parseCustomFeed(raw: string, contentType: string, provider: string): OnlineJobCandidate[] {
  if (contentType.includes("json") || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    const payload = JSON.parse(raw) as unknown;
    return recordsFromJson(payload).flatMap((record) => {
      const candidate = candidateFromRecord(record, provider);
      return candidate ? [candidate] : [];
    });
  }
  return parseXmlFeed(raw, provider);
}

export function validatePublicFeedUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Source URL must be a valid HTTPS URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") throw new Error("Source URL must use HTTPS.");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".internal")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw new Error("Source URL must point to a public HTTPS host.");
  }
  return parsed;
}

function isPrivateNetworkAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first === 100 && second >= 64 && second <= 127
    || first === 198 && (second === 18 || second === 19);
}

async function assertPublicResolvedHost(url: URL): Promise<void> {
  if (isIP(url.hostname)) {
    if (isPrivateNetworkAddress(url.hostname)) throw new Error("Source URL must point to a public HTTPS host.");
    return;
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error("Source URL must point to a public HTTPS host.");
  }
}

export async function fetchCustomFeed(url: string, provider: string): Promise<OnlineJobCandidate[]> {
  let parsedUrl = validatePublicFeedUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicResolvedHost(parsedUrl);
      response = await fetch(parsedUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: "application/json, application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": "CareerScout/1.0",
        },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      parsedUrl = validatePublicFeedUrl(new URL(location, parsedUrl).toString());
      response = undefined;
    }
    if (!response) throw new Error("Source followed too many redirects.");
    if (!response.ok) throw new Error(`Source request failed (${response.status}).`);
    const contentType = response.headers.get("content-type") ?? "";
    return parseCustomFeed(await response.text(), contentType, provider);
  } finally {
    clearTimeout(timeout);
  }
}