import type { JobPosting } from "@workspace/api-client-react";

export function PreferenceBadge({ posting }: { posting: JobPosting }) {
  if (!posting.preferenceReasons?.length) return null;
  const adjustment = posting.preferenceAdjustment ?? 0;
  return (
    <details className="relative max-w-full" onClick={event => event.stopPropagation()}>
      <summary
        className="sem-badge cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        data-tone="neutral"
        title="Explain how your choices affect ranking"
        aria-label={`Explain ranking from your choices: ${adjustment > 0 ? "+" : ""}${adjustment}`}
        data-testid={`posting-preference-${posting.id}`}
      >
        Your choices <span className="tabular-nums">{adjustment > 0 ? "+" : ""}{adjustment}</span>
      </summary>
      <div className="mt-2 max-w-sm rounded-lg border border-slate-600 bg-slate-900 p-3 text-xs leading-relaxed text-slate-200">
        <p className="font-semibold text-slate-100">
          {adjustment > 0 ? "Higher priority" : adjustment < 0 ? "Lower priority" : "Balanced signals"} from your choices
        </p>
        <p className="mt-1">This is a ranking adjustment in points, not your Profile fit score or a judgment of your abilities.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {posting.preferenceReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
        </ul>
        <p className="mt-2 text-slate-300">
          Recorded when this job was imported. Undoing a response changes learning for future imports, not this saved explanation.
          Applied is a moderate positive signal; More like this is stronger. Duplicates, closed jobs, and dismissals without a reason do not teach dislike of a role.
        </p>
      </div>
    </details>
  );
}
