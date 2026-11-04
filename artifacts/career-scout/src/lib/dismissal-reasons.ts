export type DismissReason = "not_my_role" | "wrong_location" | "already_closed" | "workday" | "duplicate" | "wrong_domain" | "too_junior";

export const dismissReasons: ReadonlyArray<{ kind: DismissReason; label: string }> = [
  { kind: "duplicate", label: "Flag as duplicate" },
  { kind: "already_closed", label: "Mark as closed" },
  { kind: "not_my_role", label: "Not my role" },
  { kind: "too_junior", label: "Too junior" },
  { kind: "workday", label: "Workday" },
  { kind: "wrong_domain", label: "Wrong domain" },
  { kind: "wrong_location", label: "Wrong location" },
];

export function reasonLabel(kind: string): string {
  return dismissReasons.find((r) => r.kind === kind)?.label ?? (kind === "more_like_this" ? "More like this" : kind);
}
