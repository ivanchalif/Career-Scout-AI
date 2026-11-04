import type { OnlineDiscoverySourceHealth } from "@workspace/api-client-react";

const tones = {
  green: { dot: "bg-emerald-400", text: "text-emerald-300" },
  yellow: { dot: "bg-yellow-400", text: "text-yellow-200" },
  red: { dot: "bg-red-400", text: "text-red-300" },
};

export function SourceHealth({ health, name }: { health?: OnlineDiscoverySourceHealth; name: string }) {
  if (!health) return <p className="text-[11px] text-muted-foreground mt-1">Health data unavailable</p>;
  const tone = tones[health.color];
  return (
    <div className="mt-1.5 text-[11px] leading-relaxed" data-testid="source-health">
      <p className="text-muted-foreground tabular-nums">
        Latest search added: <span className="text-foreground font-medium">{health.latestSearchAdded ?? "Not tracked yet"}</span>
        <span aria-hidden="true"> · </span>
        Total added: <span className="text-foreground font-medium">{health.totalAdded}</span>
      </p>
      <details className="mt-0.5">
        <summary
          className={`cursor-pointer rounded-sm w-fit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${tone.text}`}
          aria-label={`${name} source health: ${health.label}. Show rating details`}
        >
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${tone.dot}`} aria-hidden="true" />
          {health.label}
          <span className="text-muted-foreground ml-1">Why?</span>
        </summary>
        <div className="text-muted-foreground mt-1 space-y-1 pr-2">
          <p>
            Last 30 days: {health.recentAdded} added · {health.applied} applied · {health.dismissed} dismissed.
            {" "}{health.recentPostings} recently posted / {health.knownPostingDates} with known posting dates.
          </p>
          {health.reasons.map(reason => <p key={reason}>{reason}</p>)}
          <p>Latest search: {health.lastSearchAt ? new Date(health.lastSearchAt).toLocaleString() : "Not tracked yet. Per-search counts start with your next discovery run."}</p>
        </div>
      </details>
    </div>
  );
}
