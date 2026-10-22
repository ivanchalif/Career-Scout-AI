// Extracted from the app's PreferenceBadge and Badge components.
import "./_group.css";

function PreferenceBadge({ posting }: { posting: { id: number; preferenceAdjustment: number; preferenceReasons: string[] } }) {
  if (!posting.preferenceReasons?.length) return null;
  const adjustment = posting.preferenceAdjustment ?? 0;
  const explanation = posting.preferenceReasons.join(". ");
  return (
    <div
      className="whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover-elevate text-violet-300 border-violet-800/50"
      title={explanation}
      aria-label={`Ranking from your choices: ${adjustment > 0 ? "+" : ""}${adjustment}. ${explanation}`}
      data-testid={`posting-preference-${posting.id}`}
    >
      Your choices {adjustment > 0 ? "+" : ""}{adjustment}
    </div>
  );
}

export default function Current() {
  return (
    <div className="career-refinement min-h-screen flex items-center justify-center p-6">
      <div className="space-y-4">
        <h1 className="text-sm font-semibold">Current preference badge</h1>
        <PreferenceBadge posting={{ id: 1, preferenceAdjustment: -8, preferenceReasons: ["Similar to roles you dismissed as not your role"] }} />
        <p className="text-xs text-muted-foreground max-w-sm">Source component preserved before the semantic color refinement.</p>
      </div>
    </div>
  );
}
