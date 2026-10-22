import { StatusBadge } from "@/components/status-badge";
import type { JobPosting } from "@workspace/api-client-react";

export function PreferenceBadge({ posting }: { posting: JobPosting }) {
  if (!posting.preferenceReasons?.length) return null;
  const adjustment = posting.preferenceAdjustment ?? 0;
  const explanation = posting.preferenceReasons.join(". ");
  return (
    <StatusBadge
      tone="neutral"
      title={explanation}
      aria-label={`Ranking from your choices: ${adjustment > 0 ? "+" : ""}${adjustment}. ${explanation}`}
      data-testid={`posting-preference-${posting.id}`}
    >
      Your choices <span className="tabular-nums">{adjustment > 0 ? "+" : ""}{adjustment}</span>
    </StatusBadge>
  );
}
