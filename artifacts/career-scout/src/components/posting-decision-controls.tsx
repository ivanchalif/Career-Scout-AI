import { Copy, ThumbsUp, X } from "lucide-react";
import type { PostingFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePostingDecision } from "@/hooks/use-posting-decision";

export function PostingDecisionControls({
  postingId,
  feedback,
  onDismissed,
  primaryAction = "more-like-this",
}: {
  postingId: number;
  feedback?: PostingFeedback | null;
  onDismissed?: () => void;
  primaryAction?: "more-like-this" | "duplicate";
}) {
  const { pending, dismiss, toggleMoreLikeThis } = usePostingDecision();
  const on = feedback?.kind === "more_like_this";
  const duplicate = primaryAction === "duplicate";
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`w-9 h-9 sm:w-8 sm:h-8 ${duplicate ? "text-muted-foreground hover:text-foreground hover:bg-muted/60" : on ? "text-indigo-300 bg-indigo-950/40" : "text-muted-foreground hover:text-indigo-300"}`}
              aria-pressed={duplicate ? undefined : on}
              aria-label={duplicate ? "Flag as duplicate" : "More like this"}
              disabled={pending}
              onClick={async () => {
                if (duplicate) {
                  if (await dismiss(postingId, "duplicate")) onDismissed?.();
                } else {
                  await toggleMoreLikeThis(postingId, on);
                }
              }}
              data-testid={duplicate ? `posting-flag-duplicate-${postingId}` : `posting-more-like-this-${postingId}`}
            >
              {duplicate
                ? <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                : <ThumbsUp className={`w-3.5 h-3.5 ${on ? "fill-current" : ""}`} aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{duplicate ? "Flag as duplicate" : on ? "Saved. Click to undo" : "More like this"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              aria-label="Dismiss"
              disabled={pending}
              onClick={async () => {
                if (await dismiss(postingId)) onDismissed?.();
              }}
              data-testid={`posting-dismiss-${postingId}`}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dismiss</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
