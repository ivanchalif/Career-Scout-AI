import { ThumbsUp, X } from "lucide-react";
import type { PostingFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePostingDecision } from "@/hooks/use-posting-decision";

export function PostingDecisionControls({
  postingId,
  feedback,
  onDismissed,
}: {
  postingId: number;
  feedback?: PostingFeedback | null;
  onDismissed?: () => void;
}) {
  const { pending, dismiss, toggleMoreLikeThis } = usePostingDecision();
  const on = feedback?.kind === "more_like_this";
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`w-9 h-9 sm:w-8 sm:h-8 ${on ? "text-indigo-300 bg-indigo-950/40" : "text-muted-foreground hover:text-indigo-300"}`}
              aria-pressed={on}
              aria-label="More like this"
              disabled={pending}
              onClick={() => void toggleMoreLikeThis(postingId, on)}
              data-testid={`posting-more-like-this-${postingId}`}
            >
              <ThumbsUp className={`w-3.5 h-3.5 ${on ? "fill-current" : ""}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{on ? "Saved. Click to undo" : "More like this"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-red-400 hover:bg-red-950/20"
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
