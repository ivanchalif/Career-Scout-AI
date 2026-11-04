import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";
import { boardCompany, jobLinkKind, publicJobUrl } from "./jobLinks";
import { parseWarmadaPage } from "./warmada";
import { parseWorkAtStartupPage } from "./workAtStartup";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === "string" ? htmlToPlainText(value).trim() : "";
const typed = (value: RecordValue, type: string) =>
  (Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]).some(t => typeof t === "string" && t.split(/[/#]/).at(-1)?.toLowerCase() === type.toLowerCase());

function nodes(value: unknown, depth = 0): RecordValue[] {
  if (depth > 8) return [];
  if (Array.isArray(value)) return value.slice(0, 200).flatMap(v => nodes(v, depth + 1));
  if (!value || typeof value !== "object") return [];
  const node = object(value);
  return [node, ...["@graph", "itemListElement", "item", "mainEntity"].flatMap(key => nodes(node[key], depth + 1))];
}

function locations(value: unknown): string | null {
  const list = Array.isArray(value) ? value : [value];
  const names = list.map(item => {
    if (typeof item === "string") return text(item);
    const location = object(item);
    const address = object(location.address);
    const country = typeof address.addressCountry === "string" ? address.addressCountry : object(address.addressCountry).name;
    return [text(address.addressLocality), text(address.addressRegion), text(country)].filter(Boolean).join(", ") || text(location.name);
  }).filter(Boolean);
  return names.length ? [...new Set(names)].join("; ") : null;
}

/** Supports JSON-LD job lists and known job-board links without executing page JS. */
export function parseHtmlListings(raw: string, baseUrl: string, provider: string): OnlineJobCandidate[] {
  if (["warmada.com", "www.warmada.com"].includes(new URL(baseUrl).hostname)) return parseWarmadaPage(raw, provider);
  if (["workatastartup.com", "www.workatastartup.com"].includes(new URL(baseUrl).hostname) && jobLinkKind(baseUrl) === "listing") {
    return parseWorkAtStartupPage(raw, provider);
  }
  const jobs = new Map<string, OnlineJobCandidate>();
  let recognizedEmptyList = false;
  function add(job: OnlineJobCandidate) {
    if (jobs.size < 120) jobs.set(job.url, job);
  }
  for (const script of [...raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0, 20)) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    for (const node of nodes(parsed)) {
      if (typed(node, "ItemList") && Array.isArray(node.itemListElement) && node.itemListElement.length === 0) recognizedEmptyList = true;
      if (typed(node, "JobPosting")) {
        const title = text(node.title);
        const company = text(object(node.hiringOrganization).name) || text(node.hiringOrganization);
        const link = text(node.url) || (jobLinkKind(baseUrl) !== "listing" ? baseUrl : "");
        const url = link ? publicJobUrl(link, baseUrl) : null;
        if (!title || !company || !url) continue;
        const date = typeof node.datePosted === "string" ? new Date(node.datePosted) : null;
        add({
          provider, sourceJobId: text(node.identifier && object(node.identifier).value) || url,
          title, company, url, location: locations(node.jobLocation),
          remote: /\bTELECOMMUTE\b/i.test(text(node.jobLocationType)),
          description: text(node.description).slice(0, 12_000), tags: [],
          postedAt: date && !Number.isNaN(date.getTime()) ? date : null,
        });
      } else if (typed(node, "ListItem")) {
        const item = object(node.item);
        const link = text(node.url) || text(item.url);
        const name = text(node.name) || text(item.name);
        const split = name.lastIndexOf(" at ");
        const url = link ? publicJobUrl(link, baseUrl) : null;
        if (!url || split < 1) continue;
        add({ provider, sourceJobId: url, title: name.slice(0, split), company: name.slice(split + 4), url, location: null, remote: false, description: name, tags: [], postedAt: null });
      }
    }
  }
  for (const anchor of raw.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = publicJobUrl(anchor[2], baseUrl);
    if (!url || jobs.has(url)) continue;
    const kind = jobLinkKind(url);
    // Unfamiliar links need a job-like path; never turn all navigation into jobs.
    if (kind !== "job" && !/\/(?:jobs?|careers?)\/[^/?#]+/i.test(new URL(url).pathname)) continue;
    const body = anchor[3];
    let title = text(
      body.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ??
      body.match(/<p\b[^>]*class=["'][^"']*\bbody--medium\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? body,
    );
    if (!title || /^(?:apply(?: now)?|view(?: all)?(?: jobs?| details)?|learn more|see jobs?|careers?|jobs?)$/i.test(title)) continue;
    let company = boardCompany(url);
    const at = title.lastIndexOf(" at ");
    if (at > 0) { company = title.slice(at + 4); title = title.slice(0, at); }
    if (!company || title.length > 250) continue;
    const location = text(
      body.match(/<span\b[^>]*class=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
      body.match(/<p\b[^>]*class=["'][^"']*\bbody--metadata\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],
    );
    const remoteLabel = text(body.match(/<span\b[^>]*class=["'][^"']*\bworkplaceTypes\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    add({ provider, sourceJobId: url, title, company, url, location: location || null, remote: /^remote\b/i.test(remoteLabel) || /^remote\b/i.test(location), description: text(body).slice(0, 12_000), tags: [], postedAt: null });
  }
  if (!jobs.size && !recognizedEmptyList && !/\b(?:no (?:open |available |matching )?(?:jobs|positions|openings)|0 (?:open )?(?:jobs|positions|openings))\b/i.test(htmlToPlainText(raw))) {
    throw new Error("HTML source contains no readable job listings. It may require JavaScript, sign-in, or a supported page format.");
  }
  return [...jobs.values()];
}
