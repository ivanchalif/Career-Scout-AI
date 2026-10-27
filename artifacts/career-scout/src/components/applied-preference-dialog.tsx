import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSetPostingFeedback,
  getListPostingsQueryKey,
  getGetPostingQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function AppliedPreferenceDialog({
  job, onClose,
}: {
  job: { id: number; title: string };
  onClose: () => void;
}) {
  const feedback = useSetPostingFeedback();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState(false);

  async function confirm() {
    setError(false);
    try {
      await feedback.mutateAsync({ id: job.id, data: { kind: "more_like_this" } });
      qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPostingQueryKey(job.id) });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Marked as More like this", description: "Your choice will help refine future recommendations." });
      onClose();
    } catch {
      setError(true);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !feedback.isPending) onClose(); }}>
      <DialogContent data-testid="applied-preference-dialog">
        <DialogHeader>
          <DialogTitle>Find more jobs like this?</DialogTitle>
          <DialogDescription>
            “{job.title}” is now marked as applied. Would you also like to mark it as
            “More like this” to help refine future recommendations?
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Could not save your preference. Your applied status is saved. Try again or choose Not now.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={feedback.isPending} data-testid="applied-preference-skip">
            Not now
          </Button>
          <Button onClick={confirm} disabled={feedback.isPending} aria-busy={feedback.isPending} data-testid="applied-preference-confirm">
            {feedback.isPending ? "Saving…" : "Yes, more like this"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
