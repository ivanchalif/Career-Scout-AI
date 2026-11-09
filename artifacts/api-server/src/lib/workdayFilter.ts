import { isWorkdayListing } from "./responseLearning";

/** Filtering affects visibility only: never delete or skip the import. */
export function isHiddenByWorkday(
  posting: {
    link?: string | null;
    jobIdentity?: { finalUrl?: string | null; originalUrl?: string | null } | null;
  },
  settings?: { excludeWorkday?: boolean } | null,
): boolean {
  return settings?.excludeWorkday !== false && [
    posting.link, posting.jobIdentity?.finalUrl, posting.jobIdentity?.originalUrl,
  ].some(isWorkdayListing);
}
