import { htmlToPlainText, type OnlineJobCandidate } from "./arbeitnow";

/** Parse listing-specific fields; do not infer location from page/query titles. */
export function parseWarmadaPage(raw: string, provider: string): OnlineJobCandidate[] {
  const jobs = new Map<string, OnlineJobCandidate>();
  const rows = raw.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bjob-row-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for (const [, attributes, body] of rows) {
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let url: URL;
    try { url = new URL(href.replace(/&amp;/g, "&"), "https://warmada.com"); } catch { continue; }
    if (url.protocol !== "https:" || !["warmada.com", "www.warmada.com"].includes(url.hostname) || !url.pathname.startsWith("/job/")) continue;
    const field = (name: string) => htmlToPlainText(body.match(new RegExp(`<span\\b[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i"))?.[1] ?? "");
    const title = field("job-row-title");
    const company = field("job-row-company");
    if (!title || !company) continue;
    const meta = body.match(/<span\b[^>]*class=["'][^"']*\bjob-row-meta\b[^"']*["'][^>]*>([\s\S]*)/i)?.[1] ?? "";
    const details = [...meta.matchAll(/<span\b[^>]*>([^<]*)<\/span>/gi)].map(match => htmlToPlainText(match[1])).filter(Boolean);
    const location = details.find(value => !/^(?:remote|hybrid|on[- ]?site|fully remote|posted\b|\$)/i.test(value)) ??
      details.find(value => /^remote\b/i.test(value) && !/^remote$/i.test(value)) ?? null;
    jobs.set(url.href, {
      provider, sourceJobId: url.pathname, title, company, url: url.href,
      location, remote: details.some(value => /^(?:fully )?remote$/i.test(value)),
      description: htmlToPlainText(body).slice(0, 12_000), tags: [],
      // "Posted today" is not a stable timestamp; full posting enrichment can supply one.
      postedAt: null,
    });
    if (jobs.size >= 120) break;
  }
  if (!jobs.size && !/<title[^>]*>\s*0\b[^<]*\bjobs\b/i.test(raw)) {
    throw new Error("Warmada page did not contain readable job listings; its listing format may have changed.");
  }
  return [...jobs.values()];
}
