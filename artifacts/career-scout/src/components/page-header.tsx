import type { ReactNode } from "react";

export function PageHeader({
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
