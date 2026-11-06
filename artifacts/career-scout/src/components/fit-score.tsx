import { useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";

export type ScoreStatus = "pending" | "current" | "needs_reanalysis" | "failed";

export function fitTier(score: number) {
  if (score >= 80) return { label: "Strong fit", color: "hsl(var(--success))", cls: "bg-success/12 text-success border-success/30" };
  if (score >= 60) return { label: "Possible fit", color: "hsl(var(--primary))", cls: "bg-primary/10 text-indigo-200 border-primary/30" };
  return { label: "Stretch role", color: "hsl(var(--neutral))", cls: "bg-muted/60 text-neutral border-border" };
}

export function resolveStatus(score: number | null, status?: string | null): ScoreStatus {
  if (status === "pending" || status === "current" || status === "needs_reanalysis" || status === "failed") return status;
  return score == null ? "pending" : "current";
}

const statusText: Record<ScoreStatus, string> = {
  pending: "Pending analysis",
  current: "Up to date",
  needs_reanalysis: "Needs re-analysis",
  failed: "Analysis failed — retry",
};

export function FitScoreBadge({ score, status }: { score: number | null; status?: string | null }) {
  const s = resolveStatus(score, status);
  if (score == null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground animate-pulse"
        data-testid="score-ring-pending"
        title={statusText[s]}
      >
        Profile fit · {s === "failed" ? "retry needed" : "pending"}
      </span>
    );
  }
  const t = fitTier(score);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${t.cls}`}
      data-testid="score-ring"
      title={`Profile fit ${score}/100 — ${t.label} (${statusText[s]})`}
      aria-label={`Profile fit ${score} out of 100, ${t.label}, ${statusText[s]}`}
    >
      <span className="tabular-nums font-bold">{score}</span>
      <span className="font-medium opacity-90">{t.label}</span>
      {s === "needs_reanalysis" && (
        <span className="ml-0.5 text-[10px] text-warning" data-testid="score-status-stale">· re-analyze</span>
      )}
    </span>
  );
}

export function ScoreStatusPill({ score, status }: { score: number | null; status?: string | null }) {
  const s = resolveStatus(score, status);
  const cls = s === "failed" ? "text-warning border-warning/30 bg-warning/10" : s === "needs_reanalysis"
    ? "text-warning border-warning/30 bg-warning/10"
    : s === "pending"
      ? "text-muted-foreground border-border bg-muted/40 animate-pulse"
      : "text-slate-300 border-border bg-muted/30";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cls}`} data-testid="score-status">
      {statusText[s]}
    </span>
  );
}

export function ScoreBreakdown({
  score, onlineMatchScore, isOnline, reasoning, matchedSkills, missingSkills,
}: {
  score: number | null;
  onlineMatchScore?: number | null;
  isOnline: boolean;
  reasoning?: string | null;
  matchedSkills: string[];
  missingSkills: string[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground/90 hover:text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid="button-toggle-score-breakdown"
      >
        <span className="flex items-center gap-2"><Info className="w-4 h-4 text-muted-foreground" />How these scores work</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="px-3 pb-3 space-y-3 text-sm text-foreground/80" data-testid="score-breakdown">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search match{isOnline && onlineMatchScore != null ? ` · ${onlineMatchScore}` : ""}</p>
            {isOnline ? (
              <p>A quick discovery heuristic used while searching online. It compares role title, skills and basic listing details against your search criteria to decide what to bring in. The number shown here is recalculated from the current listing and profile, so it may differ from the value at discovery. It is computed independently and may differ from Profile fit.</p>
            ) : (
              <p>This posting didn't come from online search, so there was no search-match stage. Only the Profile fit applies.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profile fit{score != null ? ` · ${score}` : ""}</p>
            <p>A deeper AI review of the full posting against your complete candidate profile. Labels: Strong fit (80+), Possible fit (60–79), Stretch role (under 60). A lower score isn't a verdict on you — just how closely this listing lines up today.</p>
            {reasoning && <p className="mt-2 text-foreground/70 italic">"{reasoning}"</p>}
          </div>
          {(matchedSkills.length > 0 || missingSkills.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-3">
              {matchedSkills.length > 0 && (
                <div>
                  <p className="text-xs text-success mb-1">Evidence in your favor</p>
                  <div className="flex flex-wrap gap-1">{matchedSkills.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/25">{s}</span>)}</div>
                </div>
              )}
              {missingSkills.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Areas to strengthen</p>
                  <div className="flex flex-wrap gap-1">{missingSkills.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-muted/50 text-neutral border border-border">{s}</span>)}</div>
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">No numeric sub-scores are shown because the AI returns a single overall score.</p>
        </div>
      )}
    </div>
  );
}
