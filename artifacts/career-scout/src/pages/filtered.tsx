import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  EyeOff, ExternalLink, Building2, Tag, Loader2,
  MailX, ShieldX, AlertTriangle, KeyRound, Copy, CheckCheck,
} from "lucide-react";
import { useListPostings, useListFilteredEmails } from "@workspace/api-client-react";
import type { FilteredEmailReason } from "@workspace/api-client-react";
import Layout from "@/components/layout";

type Tab = "suppressed" | "skipped";

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
      return (
        <span className={`${base} bg-zinc-900/60 text-zinc-400 border-zinc-700/40`}>
          <ShieldX className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
    case "application_response":
      return (
        <span className={`${base} bg-blue-950/40 text-blue-400 border-blue-800/30`}>
          <MailX className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
    case "body_keyword":
      return (
        <span className={`${base} bg-rose-950/40 text-rose-400 border-rose-800/30`}>
          <KeyRound className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
    case "duplicate":
      return (
        <span className={`${base} bg-amber-950/40 text-amber-400 border-amber-800/30`}>
          <Copy className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
    case "duplicate_dismissed":
      return (
        <span className={`${base} bg-orange-950/40 text-orange-400 border-orange-800/30`}>
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
    case "duplicate_applied":
      return (
        <span className={`${base} bg-emerald-950/40 text-emerald-400 border-emerald-800/30`}>
          <CheckCheck className="w-2.5 h-2.5 shrink-0" />{label}
        </span>
      );
  }
}

export default function FilteredPage() {
  const [tab, setTab] = useState<Tab>("suppressed");

  const { data: postings, isLoading: postingsLoading } = useListPostings({ hidden: true });
  const { data: skipped, isLoading: skippedLoading } = useListFilteredEmails();

  const sortedPostings = useMemo(
    () =>
      postings
        ? [...postings].sort(
            (a, b) =>
              new Date(b.posting.createdAt).getTime() -
              new Date(a.posting.createdAt).getTime(),
          )
        : [],
    [postings],
  );

  const isLoading = tab === "suppressed" ? postingsLoading : skippedLoading;

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
          <button
            onClick={() => setTab("suppressed")}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === "suppressed"
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Suppressed by filters
            {sortedPostings.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {sortedPostings.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("skipped")}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === "skipped"
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Skipped during sync
            {skipped && skipped.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {skipped.length}
              </span>
            )}
          </button>
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
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">
                    Edit filters →
                  </Link>
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
                            {new Date(posting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
                                  <Tag className="w-2.5 h-2.5 shrink-0" />
                                  "{kw}"
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
            {!skippedLoading && (!skipped || skipped.length === 0) && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                <MailX className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No skipped emails</p>
                <p className="mt-1 text-xs">Nothing has been filtered out at the sync stage yet. Records will appear here after the next Gmail sync runs.</p>
              </div>
            )}
            {skipped && skipped.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {skipped.length} email{skipped.length === 1 ? "" : "s"} skipped
                  </span>
                  <Link href="/profile" className="text-xs text-indigo-400 hover:underline">
                    Edit sync filters →
                  </Link>
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
                        {item.listingCompany && (
                          <span className="text-xs text-muted-foreground">{item.listingCompany}</span>
                        )}
                        <span className="text-xs text-muted-foreground/60 truncate">{item.senderEmail}</span>
                        {item.listingTitle && item.subject && item.listingTitle !== item.subject && (
                          <span className="text-xs text-muted-foreground/40 truncate hidden sm:block">
                            via "{item.subject}"
                          </span>
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
      </div>
    </Layout>
  );
}
