import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useDismissPosting,
  useSetDismissalReason,
  useUndoPostingDismissal,
  useSetPostingFeedback,
  useUndoPostingFeedback,
  getListPostingsQueryKey,
  getListDeletedPostingsQueryKey,
  getGetPostingQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

export type DismissReason = "not_my_role" | "wrong_location" | "already_closed" | "workday";

export const dismissReasons: Array<{ kind: DismissReason; label: string }> = [
  { kind: "not_my_role", label: "Not my role" },
  { kind: "wrong_location", label: "Wrong location" },
  { kind: "already_closed", label: "Already closed" },
  { kind: "workday", label: "Workday" },
];

export function reasonLabel(kind: string): string {
  return dismissReasons.find((r) => r.kind === kind)?.label ?? (kind === "more_like_this" ? "More like this" : kind);
}

const TOAST_MS = 5000;

function refreshAll(qc: QueryClient, id: number) {
  qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
  qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
  qc.invalidateQueries({ queryKey: getGetPostingQueryKey(id) });
  qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
}

function DismissToastBody({
  id,
  initialToken,
  initialReason,
  close,
  setHold,
}: {
  id: number;
  initialToken: string;
  initialReason: string | null;
  close: () => void;
  setHold: (hold: boolean) => void;
}) {
  const qc = useQueryClient();
  const reasonM = useSetDismissalReason();
  const undoM = useUndoPostingDismissal();
  const [token, setToken] = useState(initialToken);
  const [reason, setReason] = useState<string | null>(initialReason);
  const [error, setError] = useState<string | null>(null);
  const busy = reasonM.isPending || undoM.isPending;
  const [menuOpen, setMenuOpen] = useState(false);
  const holdRef = useRef(setHold);
  holdRef.current = setHold;
  const hold = busy || menuOpen;
  useEffect(() => {
    holdRef.current(hold);
  }, [hold]);

  async function pick(kind: DismissReason) {
    setError(null);
    try {
      const res = await reasonM.mutateAsync({ id, data: { undoToken: token, reason: kind } });
      setToken(res.undoToken || token);
      setReason(kind);
      refreshAll(qc, id);
    } catch {
      setError("Could not save reason. Undo is still available.");
    }
  }

  async function undo() {
    setError(null);
    try {
      await undoM.mutateAsync({ id, data: { undoToken: token } });
      refreshAll(qc, id);
      close();
      toast({ title: "Job restored", duration: 3000 });
    } catch {
      setError("Could not undo. Try again.");
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      data-testid={`dismiss-toast-${id}`}
    >
      {reason && <span className="text-xs text-muted-foreground mr-1">Reason: {reasonLabel(reason)}</span>}
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={undo} disabled={busy} data-testid={`dismiss-undo-${id}`}>
        <Undo2 className="h-3 w-3" />
        Undo
      </Button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} data-testid={`dismiss-add-reason-${id}`}>
            {reason ? "Change reason" : "Add reason"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[110]">
          {dismissReasons.map((r) => (
            <DropdownMenuItem key={r.kind} onSelect={() => void pick(r.kind)} data-testid={`dismiss-reason-${r.kind}-${id}`}>
              {r.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p className="w-full text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}

export function usePostingDecision() {
  const qc = useQueryClient();
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
      const ref = { close: () => {}, hold: (_h: boolean) => {}, held: false };
      const t = toast({
        title: "Job dismissed",
        duration: TOAST_MS,
        onOpenChange: (open) => {
          if (!open && !ref.held) ref.close();
        },
        description: (
          <DismissToastBody id={id} initialToken={res.undoToken} initialReason={reason ?? null} close={() => ref.close()} setHold={(h) => ref.hold(h)} />
        ),
      });
      ref.close = t.dismiss;
      // Pause (effectively) while the reason menu is open or a save is pending; re-arm full duration after.
      ref.hold = (h) => {
        ref.held = h;
        t.update({ id: t.id, duration: h ? 24 * 60 * 60 * 1000 : TOAST_MS });
      };
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
