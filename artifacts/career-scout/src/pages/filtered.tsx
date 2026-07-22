import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  EyeOff, ExternalLink, Building2, Tag, Loader2,
  MailX, ShieldX, AlertTriangle, KeyRound, Copy, CheckCheck,
  List, Search, CheckCircle2, XCircle, HelpCircle, Layers,
} from "lucide-react";
import {
  useListPostings,
  useListFilteredEmails,
  useListEmailSyncLog,
} from "@workspace/api-client-react";
import type { FilteredEmailReason, EmailSyncOutcome } from "@workspace/api-client-react";
import Layout from "@/components/layout";

type Tab = "suppressed" | "skipped" | "sync-log";
type DateRange = "today" | "7d" | "30d" | "all";

// ─── Filter-badge helpers ─────────────────────────────────────────────────────

function reasonLabel(reason: FilteredEmailReason, keyword?: string | null): string {
  switch (reason) {
    case "blocked_sender": return "Blocked sender";
    case "application_response": return "Application response";
    case "body_keyword": return keyword ? `Keyword: "${keyword}"` : "Body keyword";
    case "duplicate": return "Duplicate";
    case "duplicate_dismissed": return "Dismissed posting";
    case "duplicate_applied": return "Already applied";
  }
}

function ReasonBadge({ reason, keyword }: { reason: FilteredEmailReason; keyword?: string | null }) {
  const label = reasonLabel(reason, keyword);
  const base = "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border";
  switch (reason) {
    case "blocked_sender":
      return <span className={`${base} bg-zinc-900/60 text-zinc-400 border-zinc-700/40`}><ShieldX className="w-2.5 h-2.5 shrink-0" />{label}</span>;
    case "application_response":
      return <span className={`${base} bg-blue-950/40 text-blue-400 border-blue-800/30`}><MailX className="w-2.5 h-2.5 shrink-0" />{label}</span>;
    case "body_keyword":
      return <span className={`${base} bg-rose-950/40 text-rose-400 border-rose-800/30`}><KeyRound className="w-2.5 h-2.5 shrink-0" />{label}</span>;
    case "duplicate":
      return <span className={`${base} bg-amber-950/40 text-amber-400 border-amber-800/30`}><Copy className="w-2.5 h-2.5 shrink-0" />{label}</span>;
    case "duplicate_dismissed":
      return <span className={`${base} bg-orange-950/40 text-orange-400 border-orange-800/30`}><AlertTriangle className="w-2.5 h-2.5 shrink-0" />{label}</span>;
    case "duplicate_applied":
      return <span className={`${base} bg-emerald-950/40 text-emerald-400 border-emerald-800/30`}><CheckCheck className="w-2.5 h-2.5 shrink-0" />{label}</span>;
  }
}

// ─── Outcome badge ────────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: EmailSyncOutcome }) {
  const base = "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0";
  switch (outcome) {
    case "imported":
      return <span className={`${base} bg-emerald-950/50 text-emerald-400 border-emerald-800/30`}><CheckCircle2 className="w-2.5 h-2.5" />Imported</span>;
    case "partial":
      return <span className={`${base} bg-amber-950/50 text-amber-400 border-amber-800/30`}><Layers className="w-2.5 h-2.5" />Partial</span>;
    case "no_listings":
      return <span className={`${base} bg-zinc-900/60 text-zinc-500 border-zinc-700/30`}><HelpCircle className="w-2.5 h-2.5" />No listings</span>;
    case "all_skipped":
      return <span className={`${base} bg-rose-950/40 text-rose-400 border-rose-800/30`}><XCircle className="w-2.5 h-2.5" />All skipped</span>;
    case "skipped_blocked_sender":
      return <span className={`${base} bg-zinc-900/60 text-zinc-400 border-zinc-700/40`}><ShieldX className="w-2.5 h-2.5" />Blocked sender</span>;
    case "skipped_application_response":
      return <span className={`${base} bg-blue-950/40 text-blue-400 border-blue-800/30`}><MailX className="w-2.5 h-2.5" />App response</span>;
    case "empty_body":
      return <span className={`${base} bg-zinc-900/60 text-zinc-500 border-zinc-700/30`}><XCircle className="w-2.5 h-2.5" />Empty body</span>;
  }
}

function dateRangeStart(range: DateRange): string | undefined {
  if (range === "all") return undefined;
  const d = new Date();
  if (range === "today") d.setHours(0, 0, 0, 0);
  else if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  return d.toISOString();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FilteredPage() {
  const [tab, setTab] = useState<Tab>("suppressed");

  // Suppressed tab
  const { data: postings, isLoading: postingsLoading } = useListPostings({ hidden: true });

  // Skipped during sync tab
  const { data: skipped, isLoading: skippedLoading } = useListFilteredEmails();

  // Sync log tab — filter state
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [senderFilter, setSenderFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("");

  const syncLogParams = useMemo(() => ({
    startDate: dateRangeStart(dateRange),
    ...(senderFilter.trim() ? { sender: senderFilter.trim() } : {}),
    ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
  }), [dateRange, senderFilter, outcomeFilter]);

  const { data: syncLog, isLoading: syncLogLoading } = useListEmailSyncLog(syncLogParams);

  const sortedPostings = useMemo(
    () => postings
      ? [...postings].sort((a, b) =>
          new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime())
      : [],
    [postings],
  );

  const isLoading =
    tab === "suppressed" ? postingsLoading :
    tab === "skipped" ? skippedLoading :
    syncLogLoading;

  const handleSenderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSenderFilter(e.target.value);
  }, []);

  return (
    <Layout>
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <EyeOff className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Filtered Jobs</h1>
            <p className="text-sm text-muted-foreground">
              Review jobs that were hidden or skipped so nothing slips through unnoticed.
            </p>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 border-b border-border">
          {(["suppressed", "skipped", "sync-log"] as Tab[]).map((t) => {
            const labels: Record<Tab, string> = {
              "suppressed": "Suppressed by filters",
              "skipped": "Skipped during sync",
              "sync-log": "Sync log",
            };
            const counts: Record<Tab, number | undefined> = {
              "suppressed": sortedPostings.length || undefined,
              "skipped": skipped?.length || undefined,
              "sync-log": undefined,
            };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? "border-indigo-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[t]}
                {counts[t] !== undefined && (
                  <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {counts[t]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Suppressed by profile filters ── */}
        {tab === "suppressed" && (
          <>
            {!postingsLoading && sortedPostings.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                <EyeOff className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No filtered jobs</p>
                <p className="mt-1 text-xs">Your current filters aren't suppressing any active postings — or no syncs have run yet.</p>
              </div>
            )}
            {sortedPostings.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {sortedPostings.length} job{sortedPostings.length === 1 ? "" : "s"} suppressed
                  </span>
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">Edit filters →</Link>
                </div>
                <ul className="divide-y divide-border">
                  {sortedPostings.map(({ posting, report, filterReason }) => (
                    <li key={posting.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 flex-wrap">
                          <Link href={`/postings/${posting.id}`} className="text-sm font-medium text-foreground hover:text-indigo-400 transition-colors truncate">
                            {posting.title}
                          </Link>
                          {report?.fitScore != null && (
                            <span className={`shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums ${
                              report.fitScore >= 80 ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                              : report.fitScore >= 60 ? "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                              : "bg-red-950/60 text-red-400 border border-red-800/40"
                            }`}>
                              {report.fitScore}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">{posting.company}</span>
                          {posting.location && <span className="text-xs text-muted-foreground/60">{posting.location}</span>}
                          <span className="text-xs text-muted-foreground/50">
                            {new Date(posting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        </div>
                        {filterReason && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {filterReason.byCompany && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-950/40 text-amber-400 border border-amber-800/30" title={filterReason.companyReason ?? undefined}>
                                <Building2 className="w-2.5 h-2.5 shrink-0" />
                                {filterReason.companyReason ?? "Company filter"}
                              </span>
                            )}
                            {filterReason.byTitle && filterReason.titleReasons.map((kw) => (
                              <span key={kw} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-950/40 text-rose-400 border border-rose-800/30">
                                <Tag className="w-2.5 h-2.5 shrink-0" />"{kw}"
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        {posting.link && (
                          <a href={posting.link} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-indigo-400 transition-colors" title="Open original posting">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* ── Tab: Skipped during sync ── */}
        {tab === "skipped" && (
          <>
            {!skippedLoading && (!skipped || skipped.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                <MailX className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No skipped emails</p>
                <p className="mt-1 text-xs">Nothing has been filtered out at the sync stage yet. Records appear here after the next Gmail sync runs.</p>
              </div>
            )}
            {skipped && skipped.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {skipped.length} email{skipped.length === 1 ? "" : "s"} skipped
                  </span>
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">Edit sync filters →</Link>
                </div>
                <ul className="divide-y divide-border">
                  {skipped.map((item) => (
                    <li key={item.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                          {item.listingTitle || item.subject || "(no subject)"}
                        </span>
                        <ReasonBadge reason={item.reason} keyword={item.blockedKeyword} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {item.listingCompany && <span className="text-xs text-muted-foreground">{item.listingCompany}</span>}
                        <span className="text-xs text-muted-foreground/60 truncate">{item.senderEmail}</span>
                        {item.listingTitle && item.subject && item.listingTitle !== item.subject && (
                          <span className="text-xs text-muted-foreground/40 truncate hidden sm:block">via "{item.subject}"</span>
                        )}
                        <span className="text-xs text-muted-foreground/50 ml-auto shrink-0">
                          {new Date(item.filteredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* ── Tab: Sync log ── */}
        {tab === "sync-log" && (
          <>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              {/* Date range pills */}
              <div className="flex gap-1 p-0.5 bg-muted/40 rounded-lg border border-border self-start">
                {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setDateRange(r)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      dateRange === r
                        ? "bg-card text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r === "today" ? "Today" : r === "7d" ? "7 days" : r === "30d" ? "30 days" : "All time"}
                  </button>
                ))}
              </div>

              {/* Sender text filter */}
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by sender…"
                  value={senderFilter}
                  onChange={handleSenderChange}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
              </div>

              {/* Outcome filter */}
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                className="text-sm bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500/50 self-start"
              >
                <option value="">All outcomes</option>
                <option value="imported">Imported</option>
                <option value="partial">Partial</option>
                <option value="all_skipped">All skipped</option>
                <option value="no_listings">No listings</option>
                <option value="skipped_blocked_sender">Blocked sender</option>
                <option value="skipped_application_response">App response</option>
              </select>
            </div>

            {/* Results */}
            {!syncLogLoading && (!syncLog || syncLog.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                <List className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No sync records found</p>
                <p className="mt-1 text-xs">
                  {dateRange !== "all" ? "Try a wider date range, or wait for the next sync to run." : "No syncs have run yet."}
                </p>
              </div>
            )}
            {syncLog && syncLog.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {syncLog.length} email{syncLog.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {syncLog.map((item) => (
                    <li key={item.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                          {item.subject || "(no subject)"}
                        </span>
                        <OutcomeBadge outcome={item.outcome} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                        <span className="truncate">{item.senderName ? `${item.senderName} ·` : ""} {item.senderEmail}</span>
                        {item.listingsExtracted > 0 && (
                          <span className="shrink-0 text-muted-foreground/60">
                            {item.listingsExtracted} listing{item.listingsExtracted === 1 ? "" : "s"}
                            {item.listingsImported > 0 && `, ${item.listingsImported} imported`}
                            {item.listingsSkipped > 0 && `, ${item.listingsSkipped} skipped`}
                          </span>
                        )}
                        {item.skipReasons.length > 0 && (
                          <span className="shrink-0 text-muted-foreground/50">
                            ({item.skipReasons.join(", ")})
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-muted-foreground/50">
                          {new Date(item.processedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          {" "}
                          {new Date(item.processedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
