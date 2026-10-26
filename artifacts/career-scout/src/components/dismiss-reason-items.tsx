import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { dismissReasons, type DismissReason } from "@/lib/dismissal-reasons";

/** Every reason picker renders the same options, labels, ordering and busy state. */
export function DismissReasonItems({
  onSelect,
  disabled = false,
  testId,
}: {
  onSelect: (reason: DismissReason) => void | Promise<unknown>;
  disabled?: boolean;
  testId?: (reason: DismissReason) => string | undefined;
}) {
  return dismissReasons.map(({ kind, label }) => (
    <DropdownMenuItem
      key={kind}
      disabled={disabled}
      onSelect={() => { void onSelect(kind); }}
      data-testid={testId?.(kind)}
    >
      {label}
    </DropdownMenuItem>
  ));
}
