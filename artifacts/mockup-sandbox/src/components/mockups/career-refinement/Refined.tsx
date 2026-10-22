import type { ReactNode } from "react";
import "./_group.css";

// Extracted verbatim from the refined shared app components.
type StatusTone = "success" | "warning" | "hidden" | "destructive" | "neutral" | "accent";
function StatusBadge({
  tone = "neutral", children, className = "", ...rest
}: { tone?: StatusTone; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span data-tone={tone} className={`sem-badge ${className}`} {...rest}>{children}</span>;
}
function PageHeader({
  eyebrow, title, purpose, actions, titleTestId,
}: { eyebrow: string; title: ReactNode; purpose?: ReactNode; actions?: ReactNode; titleTestId?: string }) {
  return (
    <header className="page-head">
      <div className="min-w-0">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title break-words" data-testid={titleTestId}>{title}</h1>
        {purpose && <p className="page-purpose">{purpose}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 min-w-0">{actions}</div>}
    </header>
  );
}
export default function Refined() {
  return (
    <div className="career-refinement min-h-screen p-6 sm:p-10">
      <PageHeader eyebrow="Component reference" title="A calmer way to review." purpose="Shared headings and semantic states from the refined Career Scout interface. These are example states, not your live jobs." />
      <div className="space-y-5">
        {([
          ["success", "Applied", "Success · an action completed"],
          ["warning", "Needs re-analysis", "Warning · something needs attention"],
          ["hidden", "Suppressed", "Hidden · excluded from discovery"],
          ["destructive", "Could not save", "Destructive · a concrete error or removal"],
          ["neutral", "Online search", "Neutral · metadata, not a judgment"],
        ] as const).map(([tone, label, explanation]) => (
          <div key={tone} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <p className="text-sm text-muted-foreground">{explanation}</p>
            <StatusBadge tone={tone}>{label}</StatusBadge>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge tone="neutral" title="Ranking adjustment based on previous job choices">Your choices -8</StatusBadge>
          <span className="text-xs text-muted-foreground">Personalization stays informational.</span>
        </div>
      </div>
    </div>
  );
}
