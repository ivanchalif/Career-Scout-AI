import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, SearchCheck } from "lucide-react";
import {
  useInvestigateOnlineDiscoverySource, useUpdateOnlineDiscoverySource,
  getGetOnlineDiscoverySourcesQueryKey, type OnlineDiscoverySource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { reasonLabel } from "@/lib/dismissal-reasons";

function errorMessage(error: unknown) {
  return (error as { data?: { error?: string } })?.data?.error
    ?? "Could not investigate this source. Please try again.";
}
function queryText(url: string) {
  try { return new URL(url).searchParams.get("q") ?? url; } catch { return url; }
}

/** Inline, not a modal: users must have time to review findings and exact
 * changes without the app's short modal-inactivity deadline.
 */
export function SourceInvestigation({ source, onEdit }: {
  source: OnlineDiscoverySource; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const investigation = useInvestigateOnlineDiscoverySource();
  const update = useUpdateOnlineDiscoverySource();
  const [expanded, setExpanded] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const result = investigation.data;
  const stale = !!result && new Date(result.sourceUpdatedAt).getTime() !== new Date(source.updatedAt).getTime();
  const busy = investigation.isPending || update.isPending;
  const review = result?.recommendations.find(item => item.id === reviewId);

  function investigate() {
    setExpanded(true);
    setReviewId(null);
    setMessage(null);
    setSaveError(null);
    investigation.mutate({ id: source.id });
  }
  async function apply() {
    if (!review || stale || busy) return;
    const data = review.action === "pause" ? { suppressed: true }
      : review.action === "update_query" && review.proposedUrl ? { url: review.proposedUrl } : null;
    if (!data) return;
    setSaveError(null);
    try {
      await update.mutateAsync({ id: source.id, data });
      setReviewId(null);
      setMessage(review.action === "pause"
        ? "Source paused. Existing jobs are unchanged. Use Restore beside this source to enable it again."
        : "Source query updated. Run the investigation again to check retrieval with the new query.");
      await qc.invalidateQueries({ queryKey: getGetOnlineDiscoverySourcesQueryKey() });
    } catch (error) {
      setSaveError((error as { data?: { error?: string } })?.data?.error ?? "Could not apply the solution. Nothing was confirmed saved; retry or refresh the source.");
    }
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1"
        onClick={result || investigation.isPending ? () => setExpanded(value => !value) : investigate}
        aria-label={`Investigate ${source.name}`} aria-expanded={expanded} aria-controls={`source-investigation-${source.id}`}
        data-testid={`investigate-source-${source.id}`}>
        {investigation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          : <SearchCheck className="w-3 h-3" aria-hidden="true" />}
        {result ? "Investigation" : "Investigate"}
      </Button>
      {expanded && (
        <section id={`source-investigation-${source.id}`} aria-label={`${source.name} investigation`}
          className="basis-full min-w-0 border-l-2 border-primary/50 pl-3 py-2 mt-1 space-y-3 text-sm"
          data-testid={`source-investigation-${source.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="font-semibold">Source investigation</h4>
              <p className="text-xs text-muted-foreground">Reads this source's history and tests live retrieval. No jobs are imported, removed or rescored.</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>Hide</Button>
          </div>
          {investigation.isPending && <p role="status">Investigating usefulness and testing the source… This may take a moment.</p>}
          {investigation.isError && <p role="alert" className="text-destructive">{errorMessage(investigation.error)}</p>}
          {message && <p role="status" className="text-success">{message}</p>}
          {result && !investigation.isPending && (
            <>
              <p className="font-medium">{result.summary}</p>
              <p className="text-xs text-muted-foreground">Investigated {new Date(result.investigatedAt).toLocaleString()}.
                {" "}Health reflects recent outcomes and will not immediately turn green after a settings change.</p>
              <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
                {result.findings.map((finding, index) => <li key={index}>{finding}</li>)}
              </ul>
              {result.dismissals.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold mb-1">Dismissal reasons · last 30 days</h5>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {result.dismissals.map(item => <li key={item.reason}>{item.reason === "no_reason" ? "No reason selected" : reasonLabel(item.reason)}: {item.count}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs"><span className="font-semibold">Live retrieval: </span>
                {result.probe.status === "ok" ? `${result.probe.retrieved} links · ${result.probe.unseen} not in saved URL history · ${result.probe.eligibleBySavedFilters} pass saved filters`
                  : result.probe.status === "failed" ? "Failed" : "Not run"}
                {result.probe.error && <span className="block text-muted-foreground">{result.probe.error}</span>}
              </p>
              {[...result.probe.recoveryNotes, ...result.probe.warnings].map((note, index) =>
                <p key={index} className="text-xs text-muted-foreground">{note}</p>)}
              {stale && <p role="status" className="text-warning">Source settings changed. Investigate again before applying recommendations from this report.</p>}
              <div className="space-y-3">
                <h5 className="font-semibold text-xs">Review solutions</h5>
                {result.recommendations.map(item => (
                  <div key={item.id} className="space-y-1">
                    <p className="text-xs font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.explanation}</p>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                      disabled={busy || (stale && item.action !== "retry")}
                      onClick={() => item.action === "retry" ? investigate() : item.action === "edit" ? onEdit() : setReviewId(item.id)}>
                      {item.action === "retry" ? "Reinvestigate" : item.action === "edit" ? "Edit source" : "Review change"}
                    </Button>
                  </div>
                ))}
              </div>
              {review && !stale && (
                <div className="border-t border-border pt-3 space-y-2" data-testid={`source-solution-review-${source.id}`}>
                  <p className="font-medium text-xs">Proposed change: {review.title}</p>
                  {review.proposedUrl ? (
                    <div className="space-y-1 text-xs break-words">
                      <p>Current query: <span className="text-muted-foreground">{queryText(source.url)}</span></p>
                      <p>Proposed query: <span className="text-foreground">{queryText(review.proposedUrl)}</span></p>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">Pause {source.name}. No existing jobs or feedback will be changed.</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => void apply()}>
                      {update.isPending ? "Applying…" : "Apply solution"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setReviewId(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              {saveError && <p role="alert" className="text-destructive">{saveError}</p>}
            </>
          )}
          {investigation.isError && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={investigate}>Retry investigation</Button>}
        </section>
      )}
    </>
  );
}
