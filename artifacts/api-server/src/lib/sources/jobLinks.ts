export type JobLinkKind = "job" | "listing" | "unknown";

/** Only classify known boards confidently; leave unfamiliar individual links alone. */
export function jobLinkKind(raw: string): JobLinkKind {
  let url: URL;
  try { url = new URL(raw); } catch { return "unknown"; }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (/^jobs(?:\.eu)?\.lever\.co$/.test(host)) {
    return /^\/[^/]+\/[^/]+(?:\/apply)?$/.test(path) ? "job" : "listing";
  }
  if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(host)) {
    return /\/jobs\/\d+/.test(path) || /^\d+$/.test(url.searchParams.get("gh_jid") ?? "") ||
      path === "/embed/job_app" && /^\d+$/.test(url.searchParams.get("token") ?? "") ? "job" : "listing";
  }
  if (host === "workatastartup.com") return /^\/jobs\/\d+(?:\/[^/]+)?$/.test(path) ? "job" : "listing";
  if (host === "linkedin.com") return /^\/jobs\/view\/[^/]+$/.test(path) ? "job" : "listing";
  if (host === "jobright.ai") return /^\/jobs\/info\/[^/]+$/.test(path) ? "job" : "listing";
  if (host === "hiringcafe.com" || host === "warmada.com") return /^\/job\/[^/]+$/.test(path) ? "job" : "listing";
  if (/^\/(?:jobs?|careers?|openings|positions)(?:\/search)?$/i.test(path)) return "listing";
  return "unknown";
}

export function boardCompany(raw: string): string | null {
  const url = new URL(raw);
  if (/^(?:jobs(?:\.eu)?\.lever\.co|(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io)$/.test(url.hostname)) {
    return url.pathname.split("/").filter(Boolean)[0]?.replace(/[-_]/g, " ") ?? null;
  }
  return null;
}

export function publicJobUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"), base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (/^(?:localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) ||
      /\.(?:localhost|internal)$/i.test(url.hostname)) return null;
    if (jobLinkKind(url.href) === "listing") return null;
    return url.href;
  } catch { return null; }
}
