import { createContext, useContext, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSetDismissalReason, useUndoPostingDismissal,
  getListPostingsQueryKey, getListDeletedPostingsQueryKey,
  getGetPostingQueryKey, getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DismissReasonItems } from "@/components/dismiss-reason-items";
import { reasonLabel, type DismissReason } from "@/lib/dismissal-reasons";
import { toast } from "@/hooks/use-toast";

type DismissedJob = { id: number; undoToken: string; reason: DismissReason | null };
const DismissalDialogContext = createContext<((job: DismissedJob) => void) | null>(null);

export function useDismissalDialog() {
  const show = useContext(DismissalDialogContext);
  if (!show) throw new Error("DismissalDialogProvider is required");
  return show;
}

// Keep the dialog above routes and job cards: dismissing can unmount either.
export function DismissalDialogProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  return <DismissalDialogState key={userId ?? "signed-out"}>{children}</DismissalDialogState>;
}

function DismissalDialogState({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<DismissedJob | null>(null);
  return (
    <DismissalDialogContext.Provider value={setJob}>
      {children}
      {job && <DismissalDialog key={job.undoToken} job={job} onClose={() => setJob(null)} />}
    </DismissalDialogContext.Provider>
  );
}

function DismissalDialog({ job, onClose }: { job: DismissedJob; onClose: () => void }) {
  const qc = useQueryClient();
  const reasonM = useSetDismissalReason();
  const undoM = useUndoPostingDismissal();
  const [token, setToken] = useState(job.undoToken);
  const [reason, setReason] = useState<DismissReason | null>(job.reason);
  const [error, setError] = useState<string | null>(null);
  const busy = reasonM.isPending || undoM.isPending;

  function refresh() {
    qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
    qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPostingQueryKey(job.id) });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  async function pick(kind: DismissReason) {
    setError(null);
    try {
      const result = await reasonM.mutateAsync({ id: job.id, data: { undoToken: token, reason: kind } });
      setToken(result.undoToken || token);
      setReason(kind);
      refresh();
    } catch {
      setError("Could not save reason. Your job is still dismissed. Try again or choose Not now.");
    }
  }

  async function undo() {
    setError(null);
    try {
      await undoM.mutateAsync({ id: job.id, data: { undoToken: token } });
      refresh();
      onClose();
      toast({ title: "Job restored", duration: 3000 });
    } catch {
      setError("Could not undo. Please try again.");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent data-testid={`dismiss-dialog-${job.id}`}>
        <DialogHeader>
          <DialogTitle>Job dismissed</DialogTitle>
          <DialogDescription>
            This job is now in Deleted. Would you like to add a reason to help refine future recommendations?
            You can skip this step or undo the dismissal.
          </DialogDescription>
        </DialogHeader>
        {reason && <p className="text-sm text-muted-foreground" role="status">Reason: {reasonLabel(reason)}</p>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy} aria-busy={reasonM.isPending} data-testid={`dismiss-add-reason-${job.id}`}>
              {reasonM.isPending ? "Saving…" : reason ? "Change reason" : "Add reason"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DismissReasonItems onSelect={pick} disabled={busy} testId={kind => `dismiss-reason-${kind}-${job.id}`} />
          </DropdownMenuContent>
        </DropdownMenu>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={undo} disabled={busy} aria-busy={undoM.isPending} data-testid={`dismiss-undo-${job.id}`}>
            <Undo2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {undoM.isPending ? "Restoring…" : "Undo dismissal"}
          </Button>
          <Button onClick={onClose} disabled={busy} data-testid={`dismiss-done-${job.id}`}>
            {reason ? "Done" : "Not now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
