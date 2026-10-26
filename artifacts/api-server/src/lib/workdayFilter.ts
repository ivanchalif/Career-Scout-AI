import { isWorkdayListing } from "./responseLearning";

/** Filtering affects visibility only: never delete or skip the import. */
export function isHiddenByWorkday(
  posting: { link?: string | null },
  settings?: { excludeWorkday?: boolean } | null,
): boolean {
  return settings?.excludeWorkday !== false && isWorkdayListing(posting.link);
}
