import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "hidden" | "destructive" | "neutral" | "accent";

/** Small semantic badge. Tone carries meaning; text must always state it too. */
export function StatusBadge({
  tone = "neutral",
  children,
  className = "",
  ...rest
}: { tone?: StatusTone; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-tone={tone} className={`sem-badge ${className}`} {...rest}>
      {children}
    </span>
  );
}
