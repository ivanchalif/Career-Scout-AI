import { Badge } from "@/components/ui/badge";
import type { JobPosting } from "@workspace/api-client-react";

export function PreferenceBadge({ posting }: { posting: JobPosting }) {
  if (!posting.preferenceReasons?.length) return null;
  const adjustment = posting.preferenceAdjustment ?? 0;
  const explanation = posting.preferenceReasons.join(". ");
  return (
    <Badge
      variant="outline"
      className="text-xs text-violet-300 border-violet-800/50"
      title={explanation}
      aria-label={`Ranking from your choices: ${adjustment > 0 ? "+" : ""}${adjustment}. ${explanation}`}
      data-testid={`posting-preference-${posting.id}`}
    >
      Your choices {adjustment > 0 ? "+" : ""}{adjustment}
    </Badge>
  );
}
