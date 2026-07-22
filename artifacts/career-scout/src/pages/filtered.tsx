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

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateRangeCutoff(range: DateRange): number {
  if (range === "all") return 0;
  const d = new Date();
  if (range === "today") d.setHours(0, 0, 0, 0);
  else if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  return d.getTime();
}

function dateRangeStart(range: DateRange): string | undefined {
  const cutoff = dateRangeCutoff(range);
  return cutoff ? new Date(cutoff).toISOString() : undefined;
}

function fmtDate(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

// ─── Shared filter bar ────────────────────────────────────────────────────────

interface FilterBarProps {
  dateRange: DateRange;
  onDateRange: (r: DateRange) => void;
  text: string;
  onText: (v: string) => void;
  textPlaceholder?: string;
  reasonValue: string;
  onReason: (v: string) => void;
  reasonOptions: { value: string; label: string }[];
  allReasonLabel?: string;
}

function FilterBar({
  dateRange, onDateRange,
  text, onText, textPlaceholder = "Search…",
  reasonValue, onReason, reasonOptions, allReasonLabel = "All reasons",
}: FilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      {/* Date pills */}
      <div className="flex gap-0.5 p-0.5 bg-muted/40 rounded-lg border border-border self-start shrink-0">
        {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
          <button
            key={r}
            onClick={() => onDateRange(r)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              dateRange === r
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r === "today" ? "Today" : r === "7d" ? "7 d" : r === "30d" ? "30 d" : "All"}
          </button>
        ))}
      </div>

      {/* Text search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder={textPlaceholder}
          value={text}
          onChange={(e) => onText(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
        />
      </div>

      {/* Reason / outcome dropdown */}
      <select
        value={reasonValue}
        onChange={(e) => onReason(e.target.value)}
        className="shrink-0 text-sm bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
      >
        <option value="">{allReasonLabel}</option>
        {reasonOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Reason badge ─────────────────────────────────────────────────────────────

function ReasonBadge({ reason, keyword }: { reason: FilteredEmailReason; keyword?: string | null }) {
  const base = "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0";
  switch (reason) {
    case "blocked_sender":
      return <span className={`${base} bg-zinc-900/60 text-zinc-400 border-zinc-700/40`}><ShieldX className="w-2.5 h-2.5 shrink-0" />Blocked sender</span>;
    case "application_response":
      return <span className={`${base} bg-blue-950/40 text-blue-400 border-blue-800/30`}><MailX className="w-2.5 h-2.5 shrink-0" />App response</span>;
    case "body_keyword":
      return <span className={`${base} bg-rose-950/40 text-rose-400 border-rose-800/30`}><KeyRound className="w-2.5 h-2.5 shrink-0" />{keyword ? `"${keyword}"` : "Body keyword"}</span>;
    case "duplicate":
      return <span className={`${base} bg-amber-950/40 text-amber-400 border-amber-800/30`}><Copy className="w-2.5 h-2.5 shrink-0" />Duplicate</span>;
    case "duplicate_dismissed":
      return <span className={`${base} bg-orange-950/40 text-orange-400 border-orange-800/30`}><AlertTriangle className="w-2.5 h-2.5 shrink-0" />Dismissed</span>;
    case "duplicate_applied":
      return <span className={`${base} bg-emerald-950/40 text-emerald-400 border-emerald-800/30`}><CheckCheck className="w-2.5 h-2.5 shrink-0" />Applied</span>;
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

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-30" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs">{sub}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FilteredPage() {
  const [tab, setTab] = useState<Tab>("suppressed");

  // ── Suppressed tab filters ────
  const [suppDateRange, setSuppDateRange] = useState<DateRange>("all");
  const [suppText, setSuppText] = useState("");
  const [suppReason, setSuppReason] = useState("");

  // ── Skipped tab filters ───────
  const [skipDateRange, setSkipDateRange] = useState<DateRange>("all");
  const [skipText, setSkipText] = useState("");
  const [skipReason, setSkipReason] = useState("");

  // ── Sync log tab filters ──────
  const [logDateRange, setLogDateRange] = useState<DateRange>("7d");
  const [logText, setLogText] = useState("");
  const [logOutcome, setLogOutcome] = useState("");

  // Data fetches
  const { data: postings, isLoading: postingsLoading } = useListPostings({ hidden: true });
  const { data: skipped, isLoading: skippedLoading } = useListFilteredEmails();

  const syncLogParams = useMemo(() => ({
    startDate: dateRangeStart(logDateRange),
    ...(logText.trim() ? { sender: logText.trim() } : {}),
    ...(logOutcome ? { outcome: logOutcome } : {}),
  }), [logDateRange, logText, logOutcome]);

  const { data: syncLog, isLoading: syncLogLoading } = useListEmailSyncLog(syncLogParams);

  // ── Suppressed: client-side filter ───────────────────────────────────────────
  const filteredPostings = useMemo(() => {
    if (!postings) return [];
    const cutoff = dateRangeCutoff(suppDateRange);
    const q = suppText.toLowerCase().trim();
    return [...postings]
      .sort((a, b) =>
        new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime()
      )
      .filter(({ posting, filterReason }) => {
        if (cutoff && new Date(posting.createdAt).getTime() < cutoff) return false;
        if (suppReason === "company" && !filterReason?.byCompany) return false;
        if (suppReason === "title" && !filterReason?.byTitle) return false;
        if (q) {
          const haystack = `${posting.title} ${posting.company} ${posting.location ?? ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
  }, [postings, suppDateRange, suppText, suppReason]);

  // ── Skipped: client-side filter ───────────────────────────────────────────────
  const filteredSkipped = useMemo(() => {
    if (!skipped) return [];
    const cutoff = dateRangeCutoff(skipDateRange);
    const q = skipText.toLowerCase().trim();
    return skipped.filter((item) => {
      if (cutoff && new Date(item.filteredAt).getTime() < cutoff) return false;
      if (skipReason && item.reason !== skipReason) return false;
      if (q) {
        const haystack = [
          item.subject, item.senderEmail, item.senderName,
          item.listingTitle, item.listingCompany, item.blockedKeyword,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [skipped, skipDateRange, skipText, skipReason]);

  const isLoading =
    tab === "suppressed" ? postingsLoading :
    tab === "skipped" ? skippedLoading :
    syncLogLoading;

  // tab counts use raw (unfiltered) lengths for badge, filtered for result count
  const handleLogText = useCallback((v: string) => setLogText(v), []);

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
              suppressed: "Suppressed",
              skipped: "Skipped during sync",
              "sync-log": "Sync log",
            };
            const rawCounts: Record<Tab, number | undefined> = {
              suppressed: postings?.length || undefined,
              skipped: skipped?.length || undefined,
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
                {rawCounts[t] !== undefined && (
                  <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {rawCounts[t]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Suppressed ── */}
        {tab === "suppressed" && (
          <>
            <FilterBar
              dateRange={suppDateRange} onDateRange={setSuppDateRange}
              text={suppText} onText={setSuppText}
              textPlaceholder="Search title or company…"
              reasonValue={suppReason} onReason={setSuppReason}
              allReasonLabel="All filter types"
              reasonOptions={[
                { value: "company", label: "Company filter" },
                { value: "title", label: "Title keyword" },
              ]}
            />

            {!postingsLoading && filteredPostings.length === 0 && (
              <EmptyState
                icon={EyeOff}
                title={postings?.length ? "No matches" : "No filtered jobs"}
                sub={
                  postings?.length
                    ? "Try clearing the search or date filter."
                    : "Your current filters aren't suppressing any active postings."
                }
              />
            )}

            {filteredPostings.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {filteredPostings.length} of {postings?.length ?? 0} job{postings?.length === 1 ? "" : "s"}
                  </span>
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">Edit filters →</Link>
                </div>
                <ul className="divide-y divide-border">
                  {filteredPostings.map(({ posting, report, filterReason }) => (
                    <li key={posting.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 flex-wrap">
                          <Link
                            href={`/postings/${posting.id}`}
                            className="text-sm font-medium text-foreground hover:text-indigo-400 transition-colors truncate"
                          >
                            {posting.title}
                          </Link>
                          {report?.fitScore != null && (
                            <span className={`shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums ${
                              report.fitScore >= 80
                                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                                : report.fitScore >= 60
                                ? "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                                : "bg-red-950/60 text-red-400 border border-red-800/40"
                            }`}>
                              {report.fitScore}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">{posting.company}</span>
                          {posting.location && (
                            <span className="text-xs text-muted-foreground/60">{posting.location}</span>
                          )}
                          <span className="text-xs text-muted-foreground/50">
                            {fmtDateTime(posting.createdAt)}
                          </span>
                        </div>
                        {filterReason && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {filterReason.byCompany && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-950/40 text-amber-400 border border-amber-800/30"
                                title={filterReason.companyReason ?? undefined}
                              >
                                <Building2 className="w-2.5 h-2.5 shrink-0" />
                                {filterReason.companyReason ?? "Company filter"}
                              </span>
                            )}
                            {filterReason.byTitle &&
                              filterReason.titleReasons.map((kw) => (
                                <span
                                  key={kw}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-950/40 text-rose-400 border border-rose-800/30"
                                >
                                  <Tag className="w-2.5 h-2.5 shrink-0" />"{kw}"
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        {posting.link && (
                          <a
                            href={posting.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground/50 hover:text-indigo-400 transition-colors"
                            title="Open original posting"
                          >
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
            <FilterBar
              dateRange={skipDateRange} onDateRange={setSkipDateRange}
              text={skipText} onText={setSkipText}
              textPlaceholder="Search subject, sender, or title…"
              reasonValue={skipReason} onReason={setSkipReason}
              allReasonLabel="All reasons"
              reasonOptions={[
                { value: "blocked_sender", label: "Blocked sender" },
                { value: "application_response", label: "App response" },
                { value: "body_keyword", label: "Body keyword" },
                { value: "duplicate", label: "Duplicate" },
                { value: "duplicate_dismissed", label: "Dismissed posting" },
                { value: "duplicate_applied", label: "Already applied" },
              ]}
            />

            {!skippedLoading && filteredSkipped.length === 0 && (
              <EmptyState
                icon={MailX}
                title={skipped?.length ? "No matches" : "No skipped emails"}
                sub={
                  skipped?.length
                    ? "Try clearing the search or date filter."
                    : "Nothing has been filtered out at the sync stage yet."
                }
              />
            )}

            {filteredSkipped.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {filteredSkipped.length} of {skipped?.length ?? 0} skipped
                  </span>
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">Edit sync filters →</Link>
                </div>
                <ul className="divide-y divide-border">
                  {filteredSkipped.map((item) => (
                    <li key={item.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                          {item.listingTitle || item.subject || "(no subject)"}
                        </span>
                        <ReasonBadge reason={item.reason} keyword={item.blockedKeyword} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                        {item.listingCompany && (
                          <span>{item.listingCompany}</span>
                        )}
                        <span className="truncate text-muted-foreground/60">{item.senderEmail}</span>
                        {item.listingTitle && item.subject && item.listingTitle !== item.subject && (
                          <span className="hidden sm:block text-muted-foreground/40 truncate">via "{item.subject}"</span>
                        )}
                        <span className="ml-auto shrink-0 text-muted-foreground/50">
                          {fmtDateTime(item.filteredAt)}
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
            <FilterBar
              dateRange={logDateRange} onDateRange={setLogDateRange}
              text={logText} onText={handleLogText}
              textPlaceholder="Search by sender…"
              reasonValue={logOutcome} onReason={setLogOutcome}
              allReasonLabel="All outcomes"
              reasonOptions={[
                { value: "imported", label: "Imported" },
                { value: "partial", label: "Partial" },
                { value: "all_skipped", label: "All skipped" },
                { value: "no_listings", label: "No listings" },
                { value: "skipped_blocked_sender", label: "Blocked sender" },
                { value: "skipped_application_response", label: "App response" },
                { value: "empty_body", label: "Empty body" },
              ]}
            />

            {!syncLogLoading && (!syncLog || syncLog.length === 0) && (
              <EmptyState
                icon={List}
                title="No sync records found"
                sub={
                  logDateRange !== "all"
                    ? "Try a wider date range, or wait for the next sync to run."
                    : "No syncs have run yet."
                }
              />
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
                        <span className="truncate">
                          {item.senderName ? `${item.senderName} · ` : ""}{item.senderEmail}
                        </span>
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
                          {fmtDateTime(item.processedAt)}
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
