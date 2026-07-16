import { useState, useMemo } from "react";
import { useGetFilterStats } from "@workspace/api-client-react";
import { Loader2, BarChart2, Calendar } from "lucide-react";
import Layout from "@/components/layout";

type DateMode = "all" | "90d" | "30d" | "7d" | "custom";

const PRESETS: { label: string; mode: Exclude<DateMode, "custom"> }[] = [
  { label: "All time", mode: "all" },
  { label: "90d",      mode: "90d" },
  { label: "30d",      mode: "30d" },
  { label: "7d",       mode: "7d" },
];

const PRESET_DAYS: Record<string, number> = { "90d": 90, "30d": 30, "7d": 7 };

function pct(num: number, denom: number): number | null {
  if (!denom) return null;
  return Math.round((num / denom) * 100);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function StatTile({ label, value, sub, color, pct: pctVal, pctLabel }: {
  label: string; value: number; sub: string; color: string; pct?: number | null; pctLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <p className={`text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</p>
        {pctVal != null && (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {pctVal}%{pctLabel ? <span className="text-[10px] ml-0.5 opacity-70">{pctLabel}</span> : null}
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-foreground leading-tight">{label}</p>
      <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>
    </div>
  );
}

export default function MetricsPage() {
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]   = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const params = useMemo<{ from?: string; to?: string } | undefined>(() => {
    if (dateMode === "all") return undefined;

    if (dateMode === "custom") {
      const result: { from?: string; to?: string } = {};
      if (customFrom) result.from = new Date(customFrom).toISOString();
      if (customTo) {
        const end = new Date(customTo);
        end.setDate(end.getDate() + 1);
        result.to = end.toISOString();
      }
      return Object.keys(result).length ? result : undefined;
    }

    const days = PRESET_DAYS[dateMode];
    return { from: new Date(Date.now() - days * 86_400_000).toISOString() };
  }, [dateMode, customFrom, customTo]);

  const { data, isLoading } = useGetFilterStats(params);

  const pf = data?.profileFilters;
  const rawActive      = pf?.rawActive ?? 0;
  const totalFetched   = data?.totalEmailsFetched   ?? 0;
  const totalExtracted = data?.totalJobsExtracted    ?? 0;
  const totalSkipped   = data?.totalJobsSkippedDedup ?? 0;

  const syncRangeLabel = useMemo(() => {
    if (dateMode === "all") return "all time";
    if (dateMode === "custom") {
      const parts: string[] = [];
      if (customFrom) parts.push(`from ${fmtDate(new Date(customFrom).toISOString())}`);
      if (customTo)   parts.push(`to ${fmtDate(new Date(customTo).toISOString())}`);
      return parts.length ? parts.join(" ") : "custom range";
    }
    return `last ${PRESET_DAYS[dateMode]}d`;
  }, [dateMode, customFrom, customTo]);

  return (
    <Layout>
      <div className="px-6 py-8 max-w-3xl mx-auto" data-testid="metrics-page">

        {/* Page header */}
        <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-400 shrink-0" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Metrics</h1>
              <p className="text-sm text-muted-foreground">Sync pipeline stats — date-filterable. Dashboard visibility is always the live snapshot.</p>
            </div>
          </div>

          {/* Date range controls */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              <div className="flex rounded-md overflow-hidden border border-border text-xs">
                {PRESETS.map((p) => (
                  <button
                    key={p.mode}
                    type="button"
                    onClick={() => setDateMode(p.mode)}
                    className={`px-2.5 py-1 transition-colors ${
                      dateMode === p.mode
                        ? "bg-indigo-600 text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDateMode("custom")}
                  className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                    dateMode === "custom"
                      ? "bg-indigo-600 text-white"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  <Calendar className="w-3 h-3" />
                  Custom
                </button>
              </div>
            </div>

            {dateMode === "custom" && (
              <div className="flex items-center gap-1.5 text-xs">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded border border-border bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="From"
                />
                <span className="text-muted-foreground">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded border border-border bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="To"
                />
              </div>
            )}
          </div>
        </div>

        {data && (
          <div className="space-y-6">

            {/* Dashboard visibility — always live, not date-filtered */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Dashboard visibility <span className="normal-case font-normal">(live snapshot — not date-filtered)</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Active postings" value={rawActive} sub="before filters" color="text-foreground" />
                <StatTile
                  label="Shown on dashboard"
                  value={pf!.shownOnDashboard}
                  sub="after all filters"
                  color="text-emerald-400"
                  pct={pct(pf!.shownOnDashboard, rawActive)}
                />
                <StatTile
                  label="Hidden by company"
                  value={pf!.hiddenByCompany}
                  sub={pf!.companyFilterMode === "off" ? "filter off" : `${pf!.companyFilterMode} · ${pf!.companyFilterCount} co.`}
                  color="text-amber-400"
                  pct={pct(pf!.hiddenByCompany, rawActive)}
                />
                <StatTile
                  label="Hidden by title kw"
                  value={pf!.hiddenByTitleKeywords}
                  sub={`${pf!.titleKeywordCount} keyword${pf!.titleKeywordCount === 1 ? "" : "s"}`}
                  color="text-rose-400"
                  pct={pct(pf!.hiddenByTitleKeywords, rawActive)}
                />
              </div>
              {rawActive > 0 && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct(pf!.shownOnDashboard, rawActive)}%` }} />
                    <div className="h-full bg-amber-500/60 transition-all" style={{ width: `${pct(pf!.hiddenByCompany, rawActive)}%` }} />
                    <div className="h-full bg-rose-500/60 transition-all" style={{ width: `${pct(pf!.hiddenByTitleKeywords, rawActive)}%` }} />
                  </div>
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Shown</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500/60 inline-block" />Company filter</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500/60 inline-block" />Title kw</span>
                  </div>
                </div>
              )}
            </div>

            {/* Sync pipeline — date-filtered */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sync pipeline —{" "}
                  <span className="normal-case font-normal">
                    {data.totalSyncs} sync{data.totalSyncs === 1 ? "" : "s"}, {syncRangeLabel}
                  </span>
                </p>
                {data.syncHistory.length > 0 && (
                  <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-indigo-400 hover:underline shrink-0">
                    {showHistory ? "Hide log" : "Show log"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="~Pre-filter" value={data.totalEmailsPreFilter} sub="subj/sender est." color="text-muted-foreground" />
                <StatTile
                  label="Body-filtered"
                  value={totalFetched}
                  sub="downloaded & parsed"
                  color="text-foreground"
                  pct={pct(totalFetched, data.totalEmailsPreFilter)}
                  pctLabel="of est."
                />
                <StatTile
                  label="Jobs extracted"
                  value={totalExtracted}
                  sub="by AI (one email → many jobs)"
                  color="text-indigo-400"
                />
                <StatTile
                  label="Jobs imported"
                  value={data.totalJobsImported}
                  sub="new to DB"
                  color="text-emerald-400"
                  pct={pct(data.totalJobsImported, totalExtracted)}
                />
              </div>

              {totalSkipped > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <StatTile
                    label="Active dups"
                    value={data.totalSkippedActiveDup}
                    sub="already in dashboard"
                    color="text-sky-400"
                    pct={pct(data.totalSkippedActiveDup, totalSkipped)}
                  />
                  <StatTile
                    label="You dismissed"
                    value={data.totalSkippedUserDeleted}
                    sub="previously deleted"
                    color="text-amber-400"
                    pct={pct(data.totalSkippedUserDeleted, totalSkipped)}
                  />
                  <StatTile
                    label="Applied role"
                    value={data.totalSkippedApplied}
                    sub="already applied"
                    color="text-violet-400"
                    pct={pct(data.totalSkippedApplied, totalSkipped)}
                  />
                </div>
              )}

              {/* Per-sync log */}
              {showHistory && data.syncHistory.length > 0 && (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Time</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium" title="Subject/sender estimate">~Pre</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Fetched</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Extracted</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Imported</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">Skipped</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium" title="Active duplicate">Dup</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium" title="Dismissed by you">Del</th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium" title="Already applied">App</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.syncHistory.map((ev) => {
                        const imp = pct(ev.jobsImported, ev.jobsExtracted);
                        return (
                          <tr key={ev.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 text-muted-foreground">
                              {new Date(ev.syncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">~{ev.emailsPreFilter}</td>
                            <td className="px-3 py-2 text-right">{ev.emailsFetched}</td>
                            <td className="px-3 py-2 text-right text-indigo-400">{ev.jobsExtracted}</td>
                            <td className="px-3 py-2 text-right text-emerald-400">
                              {ev.jobsImported}
                              {imp != null && <span className="ml-1 text-emerald-400/60">{imp}%</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{ev.jobsSkippedDedup}</td>
                            <td className="px-3 py-2 text-right text-sky-400">{ev.jobsSkippedActiveDup}</td>
                            <td className="px-3 py-2 text-right text-amber-400">{ev.jobsSkippedUserDeleted}</td>
                            <td className="px-3 py-2 text-right text-violet-400">{ev.jobsSkippedApplied}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {data.syncHistory.length === 0 && (
                <p className="text-xs text-muted-foreground/60 italic">No syncs in this range — try a wider window or run a sync.</p>
              )}
            </div>
          </div>
        )}

        {!data && !isLoading && (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
            No data yet — run a sync to see metrics.
          </div>
        )}
      </div>
    </Layout>
  );
}
