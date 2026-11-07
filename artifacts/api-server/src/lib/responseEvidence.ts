/**
 * Conservative title evidence, not guesses from an employer name or incidental
 * description text. Unknown or conflicting scope must not become a preference.
 */
export function juniorScope(title: string): string | null {
  if (/\b(senior|sr\.?|lead|principal|staff|director|head|vice president|vp|chief)\b/i.test(title)) return null;
  if (/\b(intern|internship)\b/i.test(title)) return "internship";
  if (/\b(junior|jr\.?|entry[- ]level|associate)\b/i.test(title)) return "junior / associate";
  return null;
}

const domains: [string, RegExp][] = [
  ["financial technology", /\b(fintech|financial technology|banking|payments|lending)\b/i],
  ["healthcare", /\b(healthcare|health care|healthtech|clinical|medical devices?)\b/i],
  ["cybersecurity", /\b(cybersecurity|cyber security|information security)\b/i],
  ["e-commerce", /\b(ecommerce|e-commerce|e commerce|online retail)\b/i],
  ["logistics", /\b(logistics|supply chain|freight)\b/i],
  ["advertising technology", /\b(adtech|advertising technology|programmatic advertising)\b/i],
  ["education technology", /\b(edtech|education technology|educational technology)\b/i],
];

export function explicitTitleDomain(title: string): string | null {
  const matches = domains.filter(([, pattern]) => pattern.test(title));
  // Multiple sectors are ambiguous; do not choose one on the user's behalf.
  return matches.length === 1 ? matches[0][0] : null;
}
