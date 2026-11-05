// Source-derived from artifacts/career-scout/src/pages/dashboard.tsx (Compact). Data and handlers are stubbed.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
import "./_group.css";
import { useState, useRef } from "react";
import { Plus, Mail, TrendingUp, BriefcaseBusiness, Star, Trash2, X, RefreshCw, Unplug, Sparkles, Link2, Ban, RotateCcw, Layers, ChevronDown, ChevronUp, MoreHorizontal, SearchCode, Download, Upload, Pencil, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";


function formatAdded(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}
function humanizeAvailabilityReason(reason: string): string {
  const known: Record<string, string> = {
    job_details_and_active_listing_evidence: "Job details and signs of an active listing were found.",
    no_active_listing_evidence: "The page did not provide clear signs that the listing is still active.",
    page_fetch_failed: "The listing page could not be reached for a status check.",
    insufficient_rendered_content: "The page did not show enough readable content to verify the listing.",
    timeout: "The page took too long to respond.",
    fetch_error: "A connection issue prevented the page from being checked.",
  };
  return known[reason] ?? `${reason.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())}${/[.!?]$/.test(reason) ? "" : "."}`;
}
function humanizeEvidence(value: string): string {
  const known: Record<string, string> = {
    jsonld_job_posting: "Structured job listing found",
    application_invitation: "Application invitation found",
    job_details: "Job details found",
  };
  return known[value] ?? value.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

const tones = {
  green: { dot: "bg-emerald-400", text: "text-emerald-300" },
  yellow: { dot: "bg-yellow-400", text: "text-yellow-200" },
  red: { dot: "bg-red-400", text: "text-red-300" },
};

function SourceHealth({ health, name }: { health?: any; name: string }) {
  if (!health) return <p className="text-[11px] text-muted-foreground mt-1">Health data unavailable</p>;
  const tone = tones[health.color];
  return (
    <div className="mt-1.5 text-[11px] leading-relaxed" data-testid="source-health">
      <p className="text-muted-foreground tabular-nums">
        Latest search added: <span className="text-foreground font-medium">{health.latestSearchAdded ?? "Not tracked yet"}</span>
        <span aria-hidden="true"> · </span>
        Total added: <span className="text-foreground font-medium">{health.totalAdded}</span>
      </p>
      <details className="mt-0.5">
        <summary
          className={`cursor-pointer rounded-sm w-fit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${tone.text}`}
          aria-label={`${name} source health: ${health.label}. Show rating details`}
        >
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${tone.dot}`} aria-hidden="true" />
          {health.label}
          <span className="text-muted-foreground ml-1">Why?</span>
        </summary>
        <div className="text-muted-foreground mt-1 space-y-1 pr-2">
          <p>
            Last 30 days: {health.recentAdded} added · {health.applied} applied · {health.dismissed} dismissed.
            {" "}{health.recentPostings} recently posted / {health.knownPostingDates} with known posting dates.
          </p>
          {health.reasons.map(reason => <p key={reason}>{reason}</p>)}
          <p>Latest search: {health.lastSearchAt ? new Date(health.lastSearchAt).toLocaleString() : "Not tracked yet. Per-search counts start with your next discovery run."}</p>
        </div>
      </details>
    </div>
  );
}

function StatusBadge({ tone = "neutral", children }: { tone?: string; children: React.ReactNode }) {
  return <span data-tone={tone} className="sem-badge">{children}</span>;
}
function Link({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <a href={href} onClick={(e) => e.preventDefault()} className={className}>{children}</a>;
}

export default function Compact() {
  const [onlineDiscoveryExpanded, setOnlineDiscoveryExpanded] = useState(false);
  const [discoveryMinScore, setDiscoveryMinScore] = useState(14);
  const [customSourceName, setCustomSourceName] = useState("");
  const [customSourceUrl, setCustomSourceUrl] = useState("");
  const [editingDiscoverySourceId] = useState<number | null>(null);
  const [editingSourceName, setEditingSourceName] = useState("");
  const [editingSourceUrl, setEditingSourceUrl] = useState("");
  const [sourceEditError, setSourceEditError] = useState<string | null>(null);
  const [autoSweepCount, setAutoSweepCount] = useState<number | null>(null);
  const [, setActiveTab] = useState("active");
  const [, setShowAddModal] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const activeTab: string = "active";
  const sweepingDuplicates = false, backfillingLinks = false, reanalyzing = false, exportingCsv = false, importingCsv = false;
  const gmailSyncing = false, onlineProcessing = false, gmailReconnectRequired = false;
  const gmailProgressText = "Starting Gmail sync…";
  const tabStats = { total: 47, avgFit: 71.4, strong: 9 };
  const postingsQ = { isLoading: false }, deletedQ = { isLoading: false }, discoverySourcesQ = { isLoading: false };
  const disconnectMutation = { isPending: false }, updateDiscoveryMutation = { isPending: false }, updateDiscoverySourceMutation = { isPending: false }, deleteDiscoverySourceMutation = { isPending: false }, createDiscoverySourceMutation = { isPending: false };
  const companyFilterQ = { data: { bayAreaNonRemoteOnly: true, excludeWorkday: true }, isLoading: false, isError: false };
  const gmailStatus = { connected: true, email: "maya.okafor@gmail.com", lastSyncedAt: new Date(Date.now() - 3_480_000).toISOString() };
  const health = (color: string, label: string) => ({ color, label, latestSearchAdded: 3, totalAdded: 28, recentAdded: 11, applied: 2, dismissed: 4, recentPostings: 9, knownPostingDates: 10, reasons: ["Most recent results were already saved."], lastSearchAt: new Date(Date.now() - 7_200_000).toISOString() });
  const discoverySources: any[] = [
    { id: 1, kind: "builtin", provider: "remotive", name: "Remotive", url: "https://remotive.com/api/remote-jobs", isSuppressed: false, health: health("green", "Useful") },
    { id: 2, kind: "custom", provider: null, name: "Greenhouse search", url: "https://www.google.com/search?q=site:boards.greenhouse.io+product+designer", isSuppressed: false, health: health("red", "Low usefulness") },
  ];
  const availableDiscoverySources: any[] = [{ provider: "themuse", name: "The Muse" }];
  const latestAvailabilityChecks: any[] | null = null;
  const discoveryStatus: any = { criteria: { roleTitles: ["Product Designer", "UX Engineer"], skills: ["Figma", "React"] }, scheduleHours: 24, freshnessWindow: "past_month", lastRunAt: new Date(Date.now() - 5_400_000).toISOString(), lastImported: 4, report: null, lastError: null };
  const noop = (..._args: any[]) => {};
  const onSweepDuplicates = noop, onBackfillLinks = noop, onReanalyzeAll = noop, onExportCsv = noop, onImportCsv = noop, onDiscoverOnline = noop, onSyncGmail = noop, onDisconnectGmail = noop, handleConnectGmail = noop, saveDiscoverySettings = noop, saveDiscoverySource = noop, cancelEditingDiscoverySource = noop, startEditingDiscoverySource = noop, toggleDiscoverySource = noop, removeDiscoverySource = noop, addBuiltInDiscoverySource = noop, addCustomDiscoverySource = noop;
  void setEditingSourceName; void setEditingSourceUrl; void setSourceEditError;

  return (
    <div className="dashboard-header min-h-screen bg-background text-foreground">
      <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto min-w-0" data-testid="dashboard-page">
        {/* Compact command bar: title, inline stats, utilities */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Dashboard</h1>
            <dl className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums" data-testid="dashboard-stats">
              {[
                { icon: BriefcaseBusiness, label: activeTab === "active" ? "Active postings" : activeTab === "applied" ? "Applied postings" : "Deleted postings", short: activeTab === "active" ? "active" : activeTab, value: tabStats.total },
                { icon: TrendingUp, label: "Avg fit score", short: "avg fit", value: tabStats.avgFit != null ? `${Math.round(tabStats.avgFit)}` : "—" },
                { icon: Star, label: "Strong matches (85+)", short: "strong", value: tabStats.strong },
              ].map((stat) => (
                <div key={stat.short} className="flex items-baseline gap-1" title={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <stat.icon className="h-3 w-3 self-center" aria-hidden="true" />
                  <dd className="text-sm font-semibold text-foreground">
                    {(activeTab === "deleted" ? deletedQ.isLoading : postingsQ.isLoading) ? <Skeleton className="inline-block h-4 w-6 align-middle" /> : stat.value}
                  </dd>
                  <span aria-hidden="true">{stat.short}</span>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-muted-foreground"
                  aria-busy={sweepingDuplicates || backfillingLinks || reanalyzing || exportingCsv || importingCsv}
                  data-testid="dashboard-tools-button"
                >
                  {sweepingDuplicates || backfillingLinks || reanalyzing || exportingCsv || importingCsv
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />}
                  Tools
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={onSweepDuplicates} disabled={sweepingDuplicates} className="items-start gap-2" data-testid="dedup-sweep-button">
                  {sweepingDuplicates ? <RefreshCw className="mt-0.5 w-3.5 h-3.5 animate-spin" /> : <Layers className="mt-0.5 w-3.5 h-3.5" />}
                  <span><span className="block">{sweepingDuplicates ? "Scanning..." : "Clean up duplicates"}</span><span className="block text-[11px] text-muted-foreground">Remove active jobs matching deleted or applied ones</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onBackfillLinks} disabled={backfillingLinks} className="items-start gap-2" data-testid="backfill-links-button">
                  {backfillingLinks ? <RefreshCw className="mt-0.5 w-3.5 h-3.5 animate-spin" /> : <Link2 className="mt-0.5 w-3.5 h-3.5" />}
                  <span><span className="block">{backfillingLinks ? "Finding..." : "Find job links"}</span><span className="block text-[11px] text-muted-foreground">Re-read original emails for listing links</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onReanalyzeAll} disabled={reanalyzing} className="items-start gap-2" data-testid="reanalyze-button">
                  <Sparkles className={`mt-0.5 w-3.5 h-3.5 ${reanalyzing ? "animate-pulse" : ""}`} />
                  <span><span className="block">{reanalyzing ? "Analyzing..." : "Re-analyze all"}</span><span className="block text-[11px] text-muted-foreground">Refresh AI skill matching</span></span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onExportCsv} disabled={exportingCsv} className="gap-2" data-testid="export-csv-button">
                  {exportingCsv ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {exportingCsv ? "Exporting..." : "Export CSV"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => importFileRef.current?.click()} disabled={importingCsv} className="gap-2" data-testid="import-csv-button">
                  {importingCsv ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {importingCsv ? "Importing..." : "Import CSV"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportCsv(file);
              }}
            />
            <Button
              onClick={() => setShowAddModal(true)}
              size="sm"
              className="h-8 bg-indigo-600 hover:bg-indigo-500 gap-1.5"
              data-testid="add-job-button"
              aria-label="Add job"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add job</span>
            </Button>
          </div>
        </div>

        {(gmailSyncing || onlineProcessing) && (
          <div
            className="mb-4 flex flex-col gap-2 rounded-xl border border-indigo-800/40 bg-indigo-950/25 px-4 py-3"
            role="status"
            aria-live="polite"
            data-testid="job-processing-status"
          >
            {gmailSyncing && (
              <div className="flex items-center gap-2 text-sm text-indigo-200" data-testid="gmail-processing-indicator">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span data-testid="gmail-sync-progress">
                  {gmailProgressText}. AI scoring runs separately.
                </span>
              </div>
            )}
            {onlineProcessing && (
              <div className="flex items-center gap-2 text-sm text-foreground" data-testid="online-processing-indicator">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span>Searching and processing online jobs. New matches will appear here when ready.</span>
              </div>
            )}
          </div>
        )}

        {/* Sources strip: online discovery (left) + Gmail (right on desktop) */}
        <div className="mb-3 rounded-lg border border-border/70 bg-card/40" data-testid="online-discovery-panel">
          <div className="flex flex-col gap-2 px-3 py-2 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <SearchCode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-xs">
                <span className="font-medium text-foreground">Online</span>
                <span className="text-muted-foreground">
                  {" · "}{discoverySources.filter((source) => !source.isSuppressed).length} sources
                  {discoveryStatus?.lastRunAt ? ` · ${formatAdded(discoveryStatus.lastRunAt)} · ${discoveryStatus.lastImported} added` : ""}
                </span>
                {discoverySources.some((source) => source.health?.color === "red") && (
                  <span className="ml-1.5 text-red-300" data-testid="discovery-source-health-alert">
                    · Needs review: {discoverySources.filter((source) => source.health?.color === "red").length}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                onClick={onDiscoverOnline}
                disabled={onlineProcessing}
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                data-testid="discover-online-button"
              >
                <SearchCode className={`w-3.5 h-3.5 ${onlineProcessing ? "animate-pulse" : ""}`} />
                {onlineProcessing ? "Searching…" : "Discover"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOnlineDiscoveryExpanded((expanded) => !expanded)}
                className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={onlineDiscoveryExpanded ? "Collapse online job discovery" : "Expand online job discovery"}
                aria-expanded={onlineDiscoveryExpanded}
                aria-controls="online-discovery-details"
                data-testid="toggle-online-discovery-panel"
              >
                <span className="hidden sm:inline">Settings</span>
                {onlineDiscoveryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {gmailStatus?.connected && !gmailReconnectRequired ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-2 xl:justify-end xl:border-t-0 xl:border-l xl:pl-3 xl:pt-0" data-testid="gmail-connected-banner">
                <Mail className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-xs xl:flex-none xl:text-right">
                  <span className="font-medium text-emerald-300">Gmail</span>
                  {gmailStatus.email && <span className="ml-1 text-emerald-400/70 break-all">{gmailStatus.email}</span>}
                  <span className="block text-[11px] text-emerald-400/60">
                    {gmailStatus.lastSyncedAt
                      ? `Last synced ${new Date(gmailStatus.lastSyncedAt).toLocaleString()}`
                      : "Not yet synced — click Sync to import job emails"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSyncGmail}
                  disabled={gmailSyncing}
                  aria-busy={gmailSyncing}
                  className="h-7 gap-1.5 px-2 text-xs text-emerald-400 border-emerald-700 hover:bg-emerald-950/50"
                  data-testid="gmail-sync-button"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gmailSyncing ? "animate-spin" : ""}`} />
                  {gmailSyncing ? "Syncing..." : "Sync"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onDisconnectGmail}
                  disabled={disconnectMutation.isPending}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  aria-label="Disconnect Gmail"
                  title="Disconnect Gmail"
                  data-testid="gmail-disconnect-button"
                >
                  <Unplug className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <div
                className={`flex min-w-0 items-center gap-2 border-t pt-2 xl:justify-end xl:border-t-0 xl:border-l xl:pl-3 xl:pt-0 ${gmailReconnectRequired ? "border-amber-800/50" : "border-border/60"}`}
                data-testid="gmail-connect-banner"
                role={gmailReconnectRequired ? "alert" : undefined}
              >
                <Mail className={`h-4 w-4 shrink-0 ${gmailReconnectRequired ? "text-amber-400" : "text-indigo-400"}`} aria-hidden="true" />
                <p className={`min-w-0 flex-1 text-xs xl:flex-none xl:text-right ${gmailReconnectRequired ? "text-amber-300" : "text-indigo-300"}`} title={gmailReconnectRequired
                  ? "Reconnect your Gmail account to resume importing jobs. Your existing jobs are safe."
                  : "Automatically import job emails and score them against your profile"}>
                  {gmailReconnectRequired ? "Gmail access expired. Your jobs are safe." : "Import job emails automatically"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2 text-xs text-indigo-400 border-indigo-700 hover:bg-indigo-950/50"
                  data-testid="gmail-connect-button"
                  onClick={handleConnectGmail}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {gmailReconnectRequired ? "Reconnect Gmail" : "Connect Gmail"}
                </Button>
              </div>
            )}
          </div>
          {discoveryStatus?.lastError && !onlineDiscoveryExpanded && (
            <p className="border-t border-border/60 px-3 py-1.5 text-xs text-destructive" role="alert" data-testid="discovery-error-collapsed">
              {discoveryStatus.lastError}
            </p>
          )}
          {onlineDiscoveryExpanded && (
            <div id="online-discovery-details" className="flex flex-col gap-3 border-t border-border/60 px-3 pb-3 pt-1">
              <p className="pt-2 text-xs text-muted-foreground">
                {discoveryStatus?.criteria.roleTitles.length || discoveryStatus?.criteria.skills.length
                  ? `Discovering US & Canada jobs matching ${[...discoveryStatus.criteria.roleTitles, ...discoveryStatus.criteria.skills].slice(0, 4).join(", ")}${(discoveryStatus.criteria.roleTitles.length + discoveryStatus.criteria.skills.length) > 4 ? "…" : ""}`
                  : "Add experience or skills to your profile to start matching in the US and Canada."}
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
                <label className="text-xs text-muted-foreground">Auto-discover</label>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                  value={discoveryStatus?.scheduleHours == null ? "manual" : String(discoveryStatus.scheduleHours)}
                  onChange={(event) => saveDiscoverySettings(event.target.value === "manual" ? null : Number(event.target.value))}
                  disabled={updateDiscoveryMutation.isPending}
                  data-testid="discovery-schedule-select"
                >
                  <option value="manual">Manually</option>
                  <option value="12">Every 12 hours</option>
                  <option value="24">Daily</option>
                  <option value="72">Every 3 days</option>
                </select>
                <label className="text-xs text-muted-foreground ml-1" htmlFor="discovery-freshness-select">Posted</label>
                <select
                  id="discovery-freshness-select"
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                  value={discoveryStatus?.freshnessWindow ?? "past_month"}
                  onChange={(event) => saveDiscoverySettings(
                    discoveryStatus?.scheduleHours ?? null,
                    discoveryMinScore,
                    event.target.value as OnlineDiscoverySettingsFreshnessWindow,
                  )}
                  disabled={updateDiscoveryMutation.isPending}
                  data-testid="discovery-freshness-select"
                >
                  <option value="past_week">Past week</option>
                  <option value="past_month">Past month</option>
                  <option value="any_time">Any time</option>
                </select>
                <p className="basis-full text-[11px] text-muted-foreground">
                  Freshness is a ranking preference; listings without a posted date remain eligible.
                </p>
                <label className="text-xs text-muted-foreground ml-1">Minimum match</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={discoveryMinScore}
                  onChange={(event) => setDiscoveryMinScore(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
                  onBlur={() => saveDiscoverySettings(discoveryStatus?.scheduleHours ?? null)}
                  className="h-8 w-16 text-xs"
                  data-testid="discovery-min-match-input"
                />
                <span className="text-xs text-muted-foreground">
                  {discoveryStatus?.lastRunAt
                    ? `Last search ${formatAdded(discoveryStatus.lastRunAt)} · ${discoveryStatus.lastImported} added`
                    : "Uses your profile, US/Canada location, and the same screening as email listings"}
                </span>
              </div>
              {discoveryStatus?.report && (
                <div className="text-xs text-muted-foreground space-y-1" data-testid="discovery-run-report">
                  <p>
                    {discoveryStatus.report.retrieved} results · {discoveryStatus.report.imported} added · {discoveryStatus.report.alreadySaved} already saved · {discoveryStatus.report.repeated} repeated
                  </p>
                  <p>
                    {discoveryStatus.report.excluded} excluded by matching or availability checks · {discoveryStatus.report.recentlyChecked} recently checked · {discoveryStatus.report.deferred} deferred by run limits
                  </p>
                  <p>
                    {discoveryStatus.report.pageChecks} pages checked · {discoveryStatus.report.unverified} availability unverified · {discoveryStatus.report.sourceFailures} source failures · {discoveryStatus.report.searchRequests} web searches
                  </p>
                  <p>Recent searches include a date-unrestricted fallback when few unseen results are found. Rejected listings can be checked again after six hours, or sooner if your preferences change.</p>
                </div>
              )}
              <div className="border-t border-border pt-3 space-y-3" data-testid="online-discovery-sources">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Job sources</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Suppress a source to pause it, or remove it without deleting saved jobs.</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {discoverySources.filter((source) => !source.isSuppressed).length} active
                  </span>
                </div>
                {discoverySourcesQ.isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <div className="space-y-1.5">
                    {discoverySources.map((source) => {
                      const isEditing = editingDiscoverySourceId === source.id;
                      return (
                        <div
                          key={source.id}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 border-b border-border/50 last:border-b-0 ${source.isSuppressed ? "opacity-75" : ""}`}
                        >
                          <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {isEditing ? (
                            <div className="min-w-0 flex-1 basis-full sm:basis-auto space-y-1.5">
                              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] gap-2">
                                <Input
                                  value={editingSourceName}
                                  onChange={(event) => {
                                    setEditingSourceName(event.target.value);
                                    setSourceEditError(null);
                                  }}
                                  placeholder="Source name"
                                  className="h-8 text-xs"
                                  aria-label={`Edit ${source.name} name`}
                                  data-testid={`edit-discovery-source-name-${source.id}`}
                                />
                                {source.kind === "builtin" ? (
                                  <p className="flex items-center text-[11px] text-muted-foreground truncate" title="Built-in source URLs cannot be changed">
                                    Built-in URL cannot be changed
                                  </p>
                                ) : (
                                  <Input
                                    value={editingSourceUrl}
                                    onChange={(event) => {
                                      setEditingSourceUrl(event.target.value);
                                      setSourceEditError(null);
                                    }}
                                    placeholder="Public HTTPS feed or search URL"
                                    className="h-8 text-xs"
                                    aria-label={`Edit ${source.name} URL`}
                                    data-testid={`edit-discovery-source-url-${source.id}`}
                                  />
                                )}
                              </div>
                              {sourceEditError && (
                                <p className="text-[11px] text-destructive" data-testid={`edit-discovery-source-error-${source.id}`}>
                                  {sourceEditError}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground truncate">{source.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{source.url}</p>
                              <SourceHealth health={source.health} name={source.name} />
                            </div>
                          )}
                          {source.isSuppressed && <StatusBadge tone="hidden">Suppressed</StatusBadge>}
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-success hover:text-success/80"
                                disabled={updateDiscoverySourceMutation.isPending}
                                onClick={() => saveDiscoverySource(source)}
                                data-testid={`save-discovery-source-${source.id}`}
                              >
                                <Check className="w-3 h-3 mr-1" /> Save
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-foreground hover:text-foreground"
                                disabled={updateDiscoverySourceMutation.isPending}
                                onClick={cancelEditingDiscoverySource}
                                data-testid={`cancel-edit-discovery-source-${source.id}`}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              disabled={updateDiscoverySourceMutation.isPending}
                              onClick={() => startEditingDiscoverySource(source)}
                              aria-label={`Edit ${source.name}`}
                              data-testid={`edit-discovery-source-${source.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-foreground hover:text-foreground"
                            disabled={updateDiscoverySourceMutation.isPending || isEditing}
                            onClick={() => toggleDiscoverySource(source)}
                            data-testid={`toggle-discovery-source-${source.id}`}
                          >
                            {source.isSuppressed ? <RotateCcw className="w-3 h-3 mr-1" /> : <Ban className="w-3 h-3 mr-1" />}
                            {source.isSuppressed ? "Restore" : "Suppress"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            disabled={deleteDiscoverySourceMutation.isPending || isEditing}
                            onClick={() => removeDiscoverySource(source)}
                            aria-label={`Remove ${source.name}`}
                            data-testid={`remove-discovery-source-${source.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                    {discoverySources.length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">No sources configured. Add one below to search online jobs.</p>
                    )}
                  </div>
                )}
                {availableDiscoverySources.filter((available) => !discoverySources.some((source) => source.kind === "builtin" && source.provider === available.provider)).length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Available</span>
                    {availableDiscoverySources
                      .filter((available) => !discoverySources.some((source) => source.kind === "builtin" && source.provider === available.provider))
                      .map((available) => (
                        <Button
                          key={available.provider}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-border text-foreground hover:bg-muted"
                          disabled={createDiscoverySourceMutation.isPending}
                          onClick={() => addBuiltInDiscoverySource(available.provider)}
                          data-testid={`add-discovery-source-${available.provider}`}
                        >
                          <Plus className="w-3 h-3 mr-1" /> {available.name}
                        </Button>
                      ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] gap-2">
                  <Input
                    value={customSourceName}
                    onChange={(event) => setCustomSourceName(event.target.value)}
                    placeholder="Source name (optional)"
                    className="h-8 text-xs"
                    data-testid="custom-discovery-source-name"
                  />
                  <Input
                    value={customSourceUrl}
                    onChange={(event) => {
                      setCustomSourceUrl(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomDiscoverySource();
                      }
                    }}
                    placeholder="Feed URL or Google Search URL"
                    className="h-8 text-xs"
                    data-testid="custom-discovery-source-url"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-border text-foreground hover:bg-muted"
                    disabled={createDiscoverySourceMutation.isPending}
                    onClick={addCustomDiscoverySource}
                    data-testid="add-custom-discovery-source"
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add source
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Use a public HTTPS RSS, Atom, JSON, or Google Search URL. Search URLs run through Brave, preserving operators such as site: and quoted phrases.</p>
              </div>
              {latestAvailabilityChecks !== null && (
                <div className="border-t border-border pt-3 space-y-2" data-testid="latest-availability-checks">
                  <div>
                    <p className="text-xs font-medium text-foreground">Latest checks this session</p>
                    <p className="text-[11px] text-muted-foreground">Confirmed closed listings are checked but not imported.</p>
                  </div>
                  {latestAvailabilityChecks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No availability checks were returned by the latest run.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {latestAvailabilityChecks.map((check, index) => (
                        <div key={`${check.url}-${index}`} className="py-2 border-b border-border/50 last:border-b-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={check.status === "open" ? "success" : check.status === "closed" ? "hidden" : "warning"}>
                              {check.status === "open" ? "Open" : check.status === "closed" ? "Closed · skipped" : "Unverified"}
                            </StatusBadge>
                            <span className="text-xs text-foreground">{humanizeEvidence(check.provider)}</span>
                            <span className="text-[11px] text-muted-foreground">Checked {formatAdded(check.checkedAt)}</span>
                            <span className="text-[11px] text-muted-foreground">{Math.round(check.confidence * 100)}% confidence</span>
                          </div>
                          <p className="mt-1 text-xs text-foreground/80">{humanizeAvailabilityReason(check.reason)}</p>
                          {check.evidence.length > 0 && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Evidence: {check.evidence.map(humanizeEvidence).join(", ")}
                            </p>
                          )}
                          <a
                            href={check.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block truncate text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          >
                            {check.url}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {discoveryStatus?.lastError && <p className="text-xs text-destructive">{discoveryStatus.lastError}</p>}
            </div>
          )}
        </div>

        {/* Auto-sweep banner */}
        {autoSweepCount != null && (
          <div className="flex items-start gap-3 mb-4 px-3 sm:px-4 py-2.5 bg-amber-950/40 border border-amber-800/50 rounded-lg text-sm text-amber-300">
            <Layers className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0 break-words">
              <strong>{autoSweepCount}</strong> duplicate job{autoSweepCount === 1 ? " was" : "s were"} automatically removed this session.{" "}
              <button
                className="underline underline-offset-2 hover:text-amber-200 transition-colors"
                onClick={() => { setActiveTab("deleted"); setAutoSweepCount(null); }}
              >
                View in Deleted tab
              </button>
            </span>
            <button
              className="text-amber-400/60 hover:text-amber-300 transition-colors shrink-0"
              onClick={() => setAutoSweepCount(null)}
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Collapsed notes: filter notices + ranking explanation */}
        <details className="group mb-3 text-xs text-muted-foreground" data-testid="dashboard-notes">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm w-fit hover:text-foreground">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
            <span>
              {[
                companyFilterQ.data?.bayAreaNonRemoteOnly !== false && !companyFilterQ.isLoading && !companyFilterQ.isError ? "Bay Area + remote only" : null,
                companyFilterQ.data?.excludeWorkday !== false && !companyFilterQ.isLoading && !companyFilterQ.isError ? "Workday hidden" : null,
                "How ranking works",
              ].filter(Boolean).join(" · ")}
            </span>
          </summary>
          <div className="mt-2 max-w-3xl space-y-2 border-l border-border/70 pl-3 leading-relaxed">
            {companyFilterQ.data?.bayAreaNonRemoteOnly !== false && !companyFilterQ.isLoading && !companyFilterQ.isError && (
              <p data-testid="bay-area-filter-notice">
                Allowing all SF Bay Area roles, explicitly remote jobs anywhere, and unknown locations. Non-local jobs without confirmed remote eligibility stay in{" "}
                <Link href="/filtered" className="underline underline-offset-2">Filtered</Link>.
              </p>
            )}
            {companyFilterQ.data?.excludeWorkday !== false && !companyFilterQ.isLoading && !companyFilterQ.isError && (
              <p data-testid="workday-filter-notice">
                Workday ATS jobs are hidden.{" "}
                <Link href="/filtered" className="underline underline-offset-2">Review them in Filtered</Link>
                {" "}or turn off “Hide Workday ATS” in Filters to show them again.
              </p>
            )}
            <p data-testid="response-learning-explanation">
              Applications and “More like this” favor similar jobs. Dismissal reasons reduce matching mismatches;
              repeated, specific feedback can filter future email and online results. Workday feedback applies only
              to known Workday links. Applied, dismissed, closed, and duplicate listings are not imported again.
              Dismissing without a reason does not mean you dislike that type of role. Undo reverses the signal for
              future imports. Recommended sorting combines AI fit with your choices; the AI fit score itself is unchanged.
            </p>
          </div>
        </details>
        {/* Mock list start, to judge vertical usage */}
        <div className="flex items-center border-b border-border mb-5 gap-3 py-2 text-sm">
          <span className="rounded border border-border px-2 py-1 text-xs">Filters</span>
          <span className="font-medium border-b-2 border-indigo-500 pb-1">Active 47</span><span className="text-muted-foreground">Applied 12</span><span className="text-muted-foreground">Deleted 30</span>
        </div>
        {["Senior Product Designer · Linear", "UX Engineer · Figma", "Design Systems Lead · Ramp", "Product Designer II · Lattice"].map((t, i) => (
          <div key={t} className="mb-2 rounded-lg border border-border bg-card px-4 py-3 text-sm"><span className="font-medium">{t}</span><span className="ml-2 text-xs text-muted-foreground">Fit {[91, 84, 78, 72][i]}</span></div>
        ))}
      </div>
    </div>
  );
}
