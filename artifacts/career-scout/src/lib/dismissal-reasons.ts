export type DismissReason = "not_my_role" | "wrong_location" | "already_closed" | "workday" | "duplicate";

export const dismissReasons: ReadonlyArray<{ kind: DismissReason; label: string }> = [
  { kind: "not_my_role", label: "Not my role" },
  { kind: "wrong_location", label: "Wrong location" },
  { kind: "already_closed", label: "Mark as closed" },
  { kind: "workday", label: "Workday" },
  { kind: "duplicate", label: "Flag as duplicate" },
];

export function reasonLabel(kind: string): string {
  return dismissReasons.find((r) => r.kind === kind)?.label ?? (kind === "more_like_this" ? "More like this" : kind);
}
