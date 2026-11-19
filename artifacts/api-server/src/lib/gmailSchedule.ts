/** A saved null means Manual only; only accounts without a profile use the default. */
export function gmailScheduleHours(
  profile: { syncScheduleHours: number | null } | undefined,
  defaultHours: number,
): number | null {
  return profile ? profile.syncScheduleHours : defaultHours;
}
