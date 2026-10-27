import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useDismissPosting,
  useUndoPostingDismissal,
  useSetPostingFeedback,
  useUndoPostingFeedback,
  getListPostingsQueryKey,
  getListDeletedPostingsQueryKey,
  getGetPostingQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { useDismissalDialog } from "@/components/dismissal-dialog-provider";
import { type DismissReason } from "@/lib/dismissal-reasons";
export { dismissReasons, reasonLabel, type DismissReason } from "@/lib/dismissal-reasons";

function refreshAll(qc: QueryClient, id: number) {
  qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
  qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
  qc.invalidateQueries({ queryKey: getGetPostingQueryKey(id) });
  qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
}

export function usePostingDecision() {
  const qc = useQueryClient();
  const showDismissalDialog = useDismissalDialog();
  const dismissM = useDismissPosting();
  const undoDismissM = useUndoPostingDismissal();
  const setFbM = useSetPostingFeedback();
  const undoFbM = useUndoPostingFeedback();

  const pending = dismissM.isPending || undoDismissM.isPending || setFbM.isPending || undoFbM.isPending;

  async function dismiss(id: number, reason?: DismissReason): Promise<boolean> {
    if (pending) return false;
    try {
      const res = await dismissM.mutateAsync({ id, data: { reason: reason ?? null } });
      qc.setQueriesData({ queryKey: getListPostingsQueryKey() }, (old: unknown) =>
        Array.isArray(old) ? old.filter((i: { posting?: { id: number } }) => i?.posting?.id !== id) : old,
      );
      refreshAll(qc, id);
      showDismissalDialog({ id, undoToken: res.undoToken, reason: reason ?? null });
      return true;
    } catch {
      toast({ title: "Could not dismiss job", description: "Please try again.", variant: "destructive" });
      return false;
    }
  }

  async function undoDismissal(id: number, undoToken: string) {
    if (pending) return;
    try {
      await undoDismissM.mutateAsync({ id, data: { undoToken } });
      refreshAll(qc, id);
      toast({ title: "Job restored", duration: 3000 });
    } catch {
      toast({ title: "Could not undo", description: "Please try again.", variant: "destructive" });
    }
  }

  async function toggleMoreLikeThis(id: number, currentlyOn: boolean) {
    if (pending) return;
    try {
      if (currentlyOn) await undoFbM.mutateAsync({ id });
      else await setFbM.mutateAsync({ id, data: { kind: "more_like_this" } });
      refreshAll(qc, id);
    } catch {
      toast({ title: "Could not update feedback", description: "Please try again.", variant: "destructive" });
    }
  }

  return { pending, dismiss, undoDismissal, toggleMoreLikeThis };
}
