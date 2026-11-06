import { bayAreaFilterReason } from "./bayAreaFilter";
import { isHiddenByWorkday } from "./workdayFilter";

export type PostingVisibility = {
  companyFilterSettings?: { mode: string; companies: string[]; excludeWorkday?: boolean; bayAreaNonRemoteOnly?: boolean } | null;
  titleExcludeKeywords?: string[] | null;
};
export function postingFilterReason(
  posting: { title: string; company: string; link?: string | null; location?: string | null; remoteType?: string | null },
  profile?: PostingVisibility | null,
) {
  const settings = profile?.companyFilterSettings;
  const matchedCompany = settings?.companies.find((entry) =>
    posting.company.toLowerCase().includes(entry.toLowerCase()) || entry.toLowerCase().includes(posting.company.toLowerCase()));
  const companyReason = settings?.mode === "include" && !matchedCompany ? "Not in allowlist"
    : settings?.mode === "exclude" && matchedCompany ? `Excluded: "${matchedCompany}"` : null;
  const titleReasons = (profile?.titleExcludeKeywords ?? []).filter((keyword) => posting.title.toLowerCase().includes(keyword.toLowerCase()));
  const locationReason = bayAreaFilterReason(posting, settings);
  const byAts = isHiddenByWorkday(posting, settings);
  if (!companyReason && !titleReasons.length && !locationReason && !byAts) return null;
  return {
    byLocation: !!locationReason, locationReason, byAts,
    byCompany: !!companyReason, companyReason, byTitle: !!titleReasons.length, titleReasons,
  };
}
