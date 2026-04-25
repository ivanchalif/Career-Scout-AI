import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  Plus, Search, SlidersHorizontal, Mail, TrendingUp,
  BriefcaseBusiness, CircleAlert, ExternalLink, Trash2,
  RefreshCw, Unplug, ArrowUpDown, Sparkles, Link2, CheckCircle2, Undo2,
} from "lucide-react";
import {
  useGetDashboardSummary,
  useListPostings,
  useCreatePosting,
  useDeletePosting,
  useMarkApplied,
  useGetGmailStatus,
  useSyncGmail,
  useDisconnectGmail,
  getListPostingsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetGmailStatusQueryKey,
  type CreatePostingBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import Layout from "@/components/layout";

function ScoreRing({ score, onClick }: { score: number | null; onClick?: () => void }) {
  if (score === null) {
    return (
      <div
        className="relative flex items-center justify-center w-14 h-14"
        title="AI scoring in progress"
        data-testid="score-ring-pending"
      >
        <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90 animate-spin" style={{ animationDuration: "3s" }}>
          <circle cx="28" cy="28" r={22} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
          <circle
            cx="28"
            cy="28"
            r={22}
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="3"
            strokeDasharray="20 118"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
        <span className="absolute text-[9px] text-muted-foreground font-medium leading-none text-center">AI</span>
      </div>
    );
  }
  const color =
    score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center justify-center w-14 h-14 rounded-full hover:bg-muted/40 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Click to see scoring details"
      data-testid="score-ring"
    >
      <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${progress} ${circumference - progress}`}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute text-xs font-bold"
        style={{ color }}
      >
        {score}
      </span>
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  loading?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className="text-2xl font-bold text-foreground">{value}</p>
      )}
    </div>
  );
}

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

export default function DashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [minFitScore, setMinFitScore] = useState<number | undefined>(undefined);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [detailPosting, setDetailPosting] = useState<{
    posting: {
      id: number; title: string; company: string; link?: string | null;
      appliedAt?: string | null; source: string; salaryMin?: number | null;
      salaryMax?: number | null; fullDescription: string; extractedSkills: string[];
      createdAt: Date | string;
    };
    report: {
      fitScore?: number | null; reasoning?: string | null;
      matchedSkills: string[]; missingSkills: string[];
      compensationGap?: number | null;
    } | null;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKeyState] = useState<string>(
    () => localStorage.getItem("dashboard-sort") ?? "date-desc"
  );
  const setSortKey = useCallback((key: string) => {
    localStorage.setItem("dashboard-sort", key);
    setSortKeyState(key);
  }, []);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [backfillingLinks, setBackfillingLinks] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "applied">("active");

  const dashboardQ = useGetDashboardSummary();
  const postingsQ = useListPostings({
    search: search || undefined,
    minFitScore,
    applied: activeTab === "applied" ? true : false,
  });
  const gmailStatusQ = useGetGmailStatus();
  const createMutation = useCreatePosting();
  const deleteMutation = useDeletePosting();
  const markAppliedMutation = useMarkApplied();
  const syncMutation = useSyncGmail();
  const disconnectMutation = useDisconnectGmail();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreatePostingBody>({
    defaultValues: { title: "", company: "", fullDescription: "", source: "manual" },
  });

  const summary = dashboardQ.data;
  const rawPostings = postingsQ.data ?? [];
  const gmailStatus = gmailStatusQ.data;

  const postings = useMemo(() => {
    const items = [...rawPostings];
    switch (sortKey) {
      case "date-desc":
        return items.sort((a, b) => new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime());
      case "date-asc":
        return items.sort((a, b) => new Date(a.posting.createdAt).getTime() - new Date(b.posting.createdAt).getTime());
      case "score-desc":
        return items.sort((a, b) => {
          const sa = a.report?.fitScore ?? -1;
          const sb = b.report?.fitScore ?? -1;
          return sb - sa;
        });
      case "score-asc":
        return items.sort((a, b) => {
          const sa = a.report?.fitScore ?? 101;
          const sb = b.report?.fitScore ?? 101;
          return sa - sb;
        });
      case "title-asc":
        return items.sort((a, b) => a.posting.title.localeCompare(b.posting.title));
      case "title-desc":
        return items.sort((a, b) => b.posting.title.localeCompare(a.posting.title));
      case "company-asc":
        return items.sort((a, b) => a.posting.company.localeCompare(b.posting.company));
      case "company-desc":
        return items.sort((a, b) => b.posting.company.localeCompare(a.posting.company));
      default:
        return items;
    }
  }, [rawPostings, sortKey]);

  const gmailConnectUrl = "/api/gmail/connect";

  async function onSyncGmail() {
    await syncMutation.mutateAsync(
      undefined,
      {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          toast({
            title: "Gmail synced",
            description: data.synced > 0
              ? `Imported ${data.synced} new job${data.synced === 1 ? "" : "s"} from Gmail.`
              : "No new job emails found.",
          });
        },
        onError: () => toast({ title: "Sync failed", description: "Could not sync Gmail.", variant: "destructive" }),
      }
    );
  }

  async function onReanalyzeAll() {
    setReanalyzing(true);
    try {
      await fetch("/api/postings/rescore-all", { method: "POST" });
      toast({
        title: "Re-analysis queued",
        description: "All jobs are being re-analyzed in the background. Scores will update shortly.",
      });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setReanalyzing(false);
      }, 8000);
    } catch {
      toast({ title: "Error", description: "Failed to queue re-analysis.", variant: "destructive" });
      setReanalyzing(false);
    }
  }

  async function onBackfillLinks() {
    setBackfillingLinks(true);
    try {
      const res = await fetch("/api/postings/backfill-links", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Unknown error");
      }
      const { updated, skipped } = await res.json() as { updated: number; skipped: number };
      if (updated === 0 && skipped === 0) {
        toast({ title: "All links already present", description: "No job postings needed a link update." });
      } else {
        toast({
          title: `Updated ${updated} job${updated === 1 ? "" : "s"}`,
          description: skipped > 0 ? `${skipped} posting${skipped === 1 ? "" : "s"} had no extractable link.` : "All linkable postings now have job description links.",
        });
        qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Error", description: msg === "Gmail account not connected" ? "Connect Gmail to backfill links." : "Failed to fetch links from Gmail.", variant: "destructive" });
    } finally {
      setBackfillingLinks(false);
    }
  }

  async function onDisconnectGmail() {
    await disconnectMutation.mutateAsync(
      undefined,
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Gmail disconnected" });
        },
        onError: () => toast({ title: "Error", description: "Failed to disconnect Gmail.", variant: "destructive" }),
      }
    );
  }

  async function onAdd(data: CreatePostingBody) {
    await createMutation.mutateAsync(
      { data: { ...data, source: "manual" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setShowAddModal(false);
          reset();
          toast({ title: "Job added", description: `"${data.title}" at ${data.company} added.` });
        },
        onError: () => toast({ title: "Error", description: "Failed to add job posting.", variant: "destructive" }),
      }
    );
  }

  async function onDelete(id: number) {
    await deleteMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setDeleteId(null);
          toast({ title: "Deleted", description: "Job posting removed." });
        },
        onError: () => toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }),
      }
    );
  }

  async function onToggleApplied(id: number, isCurrentlyApplied: boolean) {
    await markAppliedMutation.mutateAsync(
      { id },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setDetailPosting((prev) =>
            prev?.posting.id === id
              ? { ...prev, posting: { ...prev.posting, appliedAt: result.appliedAt ?? null } }
              : prev
          );
          toast({
            title: isCurrentlyApplied ? "Marked as not applied" : "Marked as applied",
            description: isCurrentlyApplied
              ? "Job moved back to your active list."
              : "Job moved to your Applied tab.",
          });
        },
        onError: () => toast({ title: "Error", description: "Failed to update status.", variant: "destructive" }),
      }
    );
  }

  return (
    <Layout>
      <div className="px-6 py-8 max-w-5xl mx-auto" data-testid="dashboard-page">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Your job opportunities, ranked by fit</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onBackfillLinks}
              disabled={backfillingLinks}
              className="gap-2 text-muted-foreground"
              data-testid="backfill-links-button"
              title="Re-fetch original emails to extract job description links for existing postings"
            >
              {backfillingLinks ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
              {backfillingLinks ? "Finding links..." : "Find links"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReanalyzeAll}
              disabled={reanalyzing}
              className="gap-2 text-muted-foreground"
              data-testid="reanalyze-button"
              title="Re-run AI analysis on all jobs to refresh skill matching"
            >
              <Sparkles className={`w-3.5 h-3.5 ${reanalyzing ? "animate-pulse" : ""}`} />
              {reanalyzing ? "Analyzing..." : "Re-analyze"}
            </Button>
            <Button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-500 gap-2"
              data-testid="add-job-button"
            >
              <Plus className="w-4 h-4" />
              Add job
            </Button>
          </div>
        </div>

        {/* Gmail banner */}
        {gmailStatus?.connected ? (
          <div className="flex items-center gap-3 bg-emerald-950/30 border border-emerald-800/30 rounded-xl px-5 py-3.5 mb-6" data-testid="gmail-connected-banner">
            <Mail className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-300">
                Gmail connected
                {gmailStatus.email && (
                  <span className="text-emerald-400/70 font-normal ml-1">· {gmailStatus.email}</span>
                )}
              </p>
              <p className="text-xs text-emerald-400/60 mt-0.5">
                {gmailStatus.lastSyncedAt
                  ? `Last synced ${new Date(gmailStatus.lastSyncedAt).toLocaleString()}`
                  : "Not yet synced — click Sync to import job emails"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onSyncGmail}
                disabled={syncMutation.isPending}
                className="text-emerald-400 border-emerald-700 hover:bg-emerald-950/50 gap-1.5"
                data-testid="gmail-sync-button"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {syncMutation.isPending ? "Syncing..." : "Sync now"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDisconnectGmail}
                disabled={disconnectMutation.isPending}
                className="text-muted-foreground hover:text-destructive gap-1.5"
                data-testid="gmail-disconnect-button"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl px-5 py-3.5 mb-6" data-testid="gmail-connect-banner">
            <Mail className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-300">Connect Gmail to auto-import jobs</p>
              <p className="text-xs text-indigo-400/70 mt-0.5">Automatically import job emails and score them against your profile</p>
            </div>
            <a href={gmailConnectUrl}>
              <Button
                variant="outline"
                size="sm"
                className="text-indigo-400 border-indigo-700 hover:bg-indigo-950/50 gap-1.5"
                data-testid="gmail-connect-button"
              >
                <Mail className="w-3.5 h-3.5" />
                Connect Gmail
              </Button>
            </a>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={BriefcaseBusiness}
            label="Total postings"
            value={summary?.totalPostings ?? 0}
            loading={dashboardQ.isLoading}
          />
          <StatCard
            icon={TrendingUp}
            label="Avg fit score"
            value={summary?.avgFitScore != null ? `${Math.round(summary.avgFitScore)}` : "—"}
            loading={dashboardQ.isLoading}
          />
          <StatCard
            icon={CircleAlert}
            label="Top matches"
            value={summary?.topMatches?.length ?? 0}
            loading={dashboardQ.isLoading}
          />
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-1 mb-5 border-b border-border">
          <button
            onClick={() => setActiveTab("active")}
            data-testid="tab-active"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === "active"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setActiveTab("applied")}
            data-testid="tab-applied"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              activeTab === "applied"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Applied
          </button>
        </div>

        {/* Search + filters */}
        <div className="flex justify-end mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className={`gap-2 ${showFilters ? "border-indigo-500 text-indigo-400" : ""}`}
            data-testid="filter-button"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-card border border-border rounded-lg">
            <div className="flex-1 min-w-48 space-y-1">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search jobs..."
                  className="pl-9 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="search-input"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort</Label>
              <div className="relative">
                <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  data-testid="sort-select"
                  className="h-9 pl-8 pr-3 text-sm rounded-md border border-input bg-background text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                >
                  <option value="date-desc">Date: Newest first</option>
                  <option value="date-asc">Date: Oldest first</option>
                  <option value="score-desc">Score: Highest first</option>
                  <option value="score-asc">Score: Lowest first</option>
                  <option value="title-asc">Title: A → Z</option>
                  <option value="title-desc">Title: Z → A</option>
                  <option value="company-asc">Company: A → Z</option>
                  <option value="company-desc">Company: Z → A</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Min fit score</Label>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="e.g. 70"
                className="w-28 h-9 text-sm"
                value={minFitScore ?? ""}
                onChange={(e) => setMinFitScore(e.target.value ? Number(e.target.value) : undefined)}
                data-testid="min-score-input"
              />
            </div>
            {(search || minFitScore != null || sortKey !== "date-desc") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(""); setMinFitScore(undefined); setSortKey("date-desc"); }}
              >
                Reset
              </Button>
            )}
          </div>
        )}

        {/* Postings list */}
        {postingsQ.isLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : postings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {activeTab === "applied" ? (
              <>
                <CheckCircle2 className="w-10 h-10 text-muted-foreground mb-4" />
                <p className="text-foreground font-medium">No applied jobs yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click <span className="text-foreground font-medium">Apply</span> on any job in your Active tab to track it here.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setActiveTab("active")}
                  className="mt-4"
                  data-testid="go-to-active-button"
                >
                  View active jobs
                </Button>
              </>
            ) : (
              <>
                <BriefcaseBusiness className="w-10 h-10 text-muted-foreground mb-4" />
                <p className="text-foreground font-medium">No job postings yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add your first job manually or connect Gmail to auto-import
                </p>
                <Button
                  onClick={() => setShowAddModal(true)}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-500"
                  data-testid="empty-add-job-button"
                >
                  Add a job
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {postings.map((item) => {
              const { posting, report } = item;
              const score = report?.fitScore ?? null;
              return (
                <div
                  key={posting.id}
                  className="flex items-center gap-4 bg-card border border-border rounded-xl px-5 py-4 hover:border-indigo-800/50 transition-colors cursor-pointer"
                  data-testid={`posting-card-${posting.id}`}
                  onClick={() => setDetailPosting(item)}
                >
                  <ScoreRing score={score} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-semibold text-foreground"
                        data-testid={`posting-title-${posting.id}`}
                      >
                        {posting.title}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {posting.source}
                      </Badge>
                      {posting.appliedAt && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                          Applied
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {posting.company}
                      {(posting.salaryMin || posting.salaryMax) && (
                        <span className="ml-2 text-xs text-emerald-400 font-medium">
                          {posting.salaryMin && posting.salaryMax
                            ? `$${(posting.salaryMin / 1000).toFixed(0)}k–$${(posting.salaryMax / 1000).toFixed(0)}k`
                            : posting.salaryMin
                            ? `$${(posting.salaryMin / 1000).toFixed(0)}k+`
                            : `up to $${(posting.salaryMax! / 1000).toFixed(0)}k`}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-muted-foreground/60">
                        {formatAdded(posting.createdAt)}
                      </span>
                    </p>
                    {report?.matchedSkills && report.matchedSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {report.matchedSkills.slice(0, 4).map((skill) => (
                          <span key={skill} className="text-xs px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {posting.link && (
                      <a href={posting.link} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="w-8 h-8" data-testid={`posting-link-${posting.id}`}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onToggleApplied(posting.id, !!posting.appliedAt)}
                      disabled={markAppliedMutation.isPending}
                      data-testid={`posting-apply-${posting.id}`}
                      title={posting.appliedAt ? "Undo applied" : "Mark as applied"}
                      className={`w-8 h-8 ${posting.appliedAt ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground hover:text-emerald-400"}`}
                    >
                      {posting.appliedAt ? <Undo2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteId(posting.id)}
                      data-testid={`posting-delete-${posting.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add job modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add job posting</DialogTitle>
            <DialogDescription>
              Manually add a job opportunity to score it against your profile.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onAdd)} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Job title</Label>
              <Input
                id="title"
                placeholder="e.g. Senior Software Engineer"
                data-testid="input-job-title"
                {...register("title", { required: true })}
              />
              {errors.title && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                placeholder="e.g. Acme Corp"
                data-testid="input-company"
                {...register("company", { required: true })}
              />
              {errors.company && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link">Job URL (optional)</Label>
              <Input
                id="link"
                placeholder="https://..."
                data-testid="input-job-link"
                {...register("link")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullDescription">Job description</Label>
              <Textarea
                id="fullDescription"
                placeholder="Paste the full job description here..."
                rows={5}
                data-testid="input-job-description"
                {...register("fullDescription", { required: true })}
              />
              {errors.fullDescription && <p className="text-xs text-destructive">Required</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowAddModal(false); reset(); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500"
                disabled={createMutation.isPending}
                data-testid="submit-add-job"
              >
                {createMutation.isPending ? "Adding..." : "Add job"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Job detail modal */}
      <Dialog open={detailPosting !== null} onOpenChange={(open) => { if (!open) setDetailPosting(null); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden p-0">
          {detailPosting && (() => {
            const { posting, report } = detailPosting;
            const fitScore = report?.fitScore ?? null;
            const color = fitScore != null ? (fitScore >= 80 ? "#22c55e" : fitScore >= 60 ? "#f59e0b" : "#ef4444") : "hsl(var(--muted-foreground))";
            const radius = 26;
            const circumference = 2 * Math.PI * radius;
            const progress = fitScore != null ? (fitScore / 100) * circumference : 0;
            const isApplied = !!posting.appliedAt;
            return (
              <>
                {/* Sticky header */}
                <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
                  <div className="flex items-start gap-4 pr-6">
                    {/* Score ring */}
                    <div className="relative flex items-center justify-center w-14 h-14 shrink-0">
                      {fitScore != null ? (
                        <>
                          <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
                            <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                            <circle cx="28" cy="28" r={radius} fill="none" stroke={color} strokeWidth="3"
                              strokeDasharray={`${progress} ${circumference - progress}`} strokeLinecap="round" />
                          </svg>
                          <span className="absolute text-xs font-bold" style={{ color }}>{fitScore}</span>
                        </>
                      ) : (
                        <>
                          <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90 animate-spin" style={{ animationDuration: "3s" }}>
                            <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                            <circle cx="28" cy="28" r={radius} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="3"
                              strokeDasharray="20 118" strokeLinecap="round" opacity="0.4" />
                          </svg>
                          <span className="absolute text-[9px] text-muted-foreground font-medium">AI</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-lg leading-snug">{posting.title}</DialogTitle>
                      <DialogDescription className="flex flex-wrap items-center gap-2 mt-1">
                        <span>{posting.company}</span>
                        {(posting.salaryMin || posting.salaryMax) && (
                          <span className="text-xs text-emerald-400 font-medium">
                            {posting.salaryMin && posting.salaryMax
                              ? `$${(posting.salaryMin / 1000).toFixed(0)}k–$${(posting.salaryMax / 1000).toFixed(0)}k`
                              : posting.salaryMin ? `$${(posting.salaryMin / 1000).toFixed(0)}k+`
                              : `up to $${(posting.salaryMax! / 1000).toFixed(0)}k`}
                          </span>
                        )}
                        <Badge variant="secondary" className="text-xs">{posting.source}</Badge>
                        <span className="text-xs text-muted-foreground/60">
                          Added {formatAdded(posting.createdAt)}
                        </span>
                        {posting.link && (
                          <a href={posting.link} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-xs">
                            <ExternalLink className="w-3 h-3" />
                            View job posting
                          </a>
                        )}
                      </DialogDescription>
                    </div>
                  </div>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  {/* AI reasoning */}
                  {report?.reasoning && (
                    <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-foreground leading-relaxed">
                      {report.reasoning}
                    </div>
                  )}

                  {/* Skills */}
                  {fitScore != null && (
                    (report?.matchedSkills?.length ?? 0) === 0 && (report?.missingSkills?.length ?? 0) === 0 ? (
                      <div className="rounded-lg bg-muted/30 px-4 py-3 text-center">
                        <p className="text-xs text-muted-foreground">No specific skill requirements were found in this posting.</p>
                        <p className="text-xs text-muted-foreground mt-1">Use <span className="text-foreground font-medium">Re-analyze</span> to refresh.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-emerald-400 mb-2">Matched skills</p>
                          {(report?.matchedSkills?.length ?? 0) > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {report!.matchedSkills.map((s) => (
                                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">{s}</span>
                              ))}
                            </div>
                          ) : <p className="text-xs text-muted-foreground">None from your profile</p>}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-red-400 mb-2">Missing skills</p>
                          {(report?.missingSkills?.length ?? 0) > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {report!.missingSkills.map((s) => (
                                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-red-950/40 text-red-400 border border-red-800/30">{s}</span>
                              ))}
                            </div>
                          ) : <p className="text-xs text-muted-foreground">None — full match</p>}
                        </div>
                      </div>
                    )
                  )}

                  {/* Compensation gap */}
                  {report?.compensationGap != null && (
                    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-3">
                      <span className="text-xs text-muted-foreground">Compensation gap</span>
                      <span className={`ml-auto text-sm font-semibold ${report.compensationGap >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {report.compensationGap >= 0 ? "+" : ""}${Math.abs(report.compensationGap).toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">{report.compensationGap >= 0 ? "above target" : "below target"}</span>
                    </div>
                  )}

                  {/* Description */}
                  {posting.fullDescription && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Job description</p>
                      <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/20 px-4 py-3 max-h-64 overflow-y-auto">
                        {posting.fullDescription}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant={isApplied ? "outline" : "default"}
                      className={isApplied ? "gap-2 border-emerald-700 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30" : "gap-2 bg-emerald-700 hover:bg-emerald-600"}
                      onClick={() => onToggleApplied(posting.id, isApplied)}
                      disabled={markAppliedMutation.isPending}
                      data-testid="modal-apply-button"
                    >
                      {isApplied ? <><Undo2 className="w-4 h-4" /> Undo applied</> : <><CheckCircle2 className="w-4 h-4" /> Mark as applied</>}
                    </Button>
                    {posting.link && (
                      <a href={posting.link} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="gap-2">
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open job
                        </Button>
                      </a>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                    onClick={() => { setDetailPosting(null); setDeleteId(posting.id); }}
                    data-testid="modal-delete-button"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job posting?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The posting and its match report will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteId !== null && onDelete(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
