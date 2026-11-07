import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import {
  Plus, Search, SlidersHorizontal, Mail, TrendingUp,
  BriefcaseBusiness, Star, Trash2, X,
  RefreshCw, Unplug, ArrowUpDown, Sparkles, Link2, CheckCircle2, Undo2, MapPin, Ban, RotateCcw, Layers, Copy, Archive,
  ChevronDown, ChevronUp, MoreHorizontal, ExternalLink, SearchCode, Download, Upload, Pencil, Check, Loader2,
} from "lucide-react";
import {
  useGetDashboardSummary,
  useGetPostingPage,
  useCreatePosting,
  useDeletePosting,
  useMarkApplied,
  useGetGmailStatus,
  useSyncGmail,
  useDisconnectGmail,
  useGetCompanyFilterSettings,
  useUpdateCompanyFilterSettings,
  useGetTitleExcludeSettings,
  useUpdateTitleExcludeSettings,
  useGetOnlineDiscoveryStatus,
  useRunOnlineDiscovery,
  useUpdateOnlineDiscoverySettings,
  useGetOnlineDiscoverySources,
  useCreateOnlineDiscoverySource,
  useUpdateOnlineDiscoverySource,
  useDeleteOnlineDiscoverySource,
  getGetTitleExcludeSettingsQueryKey,
  useRestorePosting,
  useReopenPosting,
  getListPostingsQueryKey,
  getListDeletedPostingsQueryKey,
  getGetPostingQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetGmailStatusQueryKey,
  getGetCompanyFilterSettingsQueryKey,
  getGetOnlineDiscoveryStatusQueryKey,
  getGetOnlineDiscoverySourcesQueryKey,
  type CreatePostingBody,
  type JobPosting,
  type OnlineDiscoverySource,
  type OnlineDiscoverySettingsFreshnessWindow,
  type DiscoveryAvailabilityCheck,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { JobPagination } from "@/components/job-pagination";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import Layout from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { SourceHealth } from "@/components/source-health";
import { PostingDecisionControls } from "@/components/posting-decision-controls";
import { PreferenceBadge } from "@/components/preference-badge";
import { FitScoreBadge, fitTier } from "@/components/fit-score";
import { QueryError } from "@/components/query-error";
import { usePostingDecision, reasonLabel } from "@/hooks/use-posting-decision";
import { DismissReasonItems } from "@/components/dismiss-reason-items";
import { AppliedPreferenceDialog } from "@/components/applied-preference-dialog";
import { readDashboardSorts, saveDashboardSort, type DashboardSorts, type DashboardView } from "@/lib/dashboard-sorts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

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

function availabilityLabel(posting: JobPosting): string | null {
  switch (posting.availabilityStatus) {
    case "open": return "Reported open";
    case "closed": return "Reported closed";
    case "unverified": return "Availability unverified";
    case null: return "Availability not checked";
    default: return null;
  }
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

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}


export default function DashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken, userId } = useAuth();
  const [search, setSearch] = useState("");
  const [minFitScore, setMinFitScore] = useState<number | undefined>(undefined);
  const [showAddModal, setShowAddModal] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<{
    ids: number[]; total: number; jobs: Array<{ id: number; title: string; company: string }>;
  } | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardView>("active");
  const [page, setPage] = useState(0);
  const sortScope = userId ?? "signed-out";
  const storedSorts = useMemo(() => readDashboardSorts(localStorage, sortScope), [sortScope]);
  const [sortOverrides, setSortOverrides] = useState<Record<string, DashboardSorts>>({});
  const viewSorts = sortOverrides[sortScope] ?? storedSorts;
  const sortKey = viewSorts[activeTab];
  useEffect(() => { setPage(0); }, [activeTab, search, minFitScore, sortKey]);
  const setSortKey = useCallback((key: string) => {
    saveDashboardSort(localStorage, sortScope, activeTab, key);
    setSortOverrides(previous => ({
      ...previous,
      [sortScope]: { ...(previous[sortScope] ?? storedSorts), [activeTab]: key },
    }));
  }, [sortScope, activeTab, storedSorts]);
  const [appliedPreferenceJob, setAppliedPreferenceJob] = useState<{ id: number; title: string } | null>(null);
  useEffect(() => { setAppliedPreferenceJob(null); }, [userId]);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [backfillingLinks, setBackfillingLinks] = useState(false);
  const [sweepingDuplicates, setSweepingDuplicates] = useState(false);
  const [retryingLinks, setRetryingLinks] = useState<Set<number>>(new Set());
  const [exportingCsv, setExportingCsv] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  type NearDupPair = {
    id1: number; id2: number;
    title1: string; title2: string;
    company1: string; company2: string;
    location1: string | null; location2: string | null;
    url1: string | null; url2: string | null;
    applied_at1: string | null; applied_at2: string | null;
    deleted_at1: string | null; deleted_at2: string | null;
    salary_min1: number | null; salary_min2: number | null;
    salary_max1: number | null; salary_max2: number | null;
    created_at1: string; created_at2: string;
    evidence: string[];
    confidence: "review" | "duplicate";
  };
  const [nearDupMap, setNearDupMap] = useState<Map<number, NearDupPair & { isId1: boolean }>>(new Map());
  const [dismissedNearDups, setDismissedNearDups] = useState<Set<string>>(new Set());
  const [nearDupRevision, setNearDupRevision] = useState(0);
  const [savingDistinctPair, setSavingDistinctPair] = useState<string | null>(null);
  const [reviewingNearDups, setReviewingNearDups] = useState<Set<number>>(new Set());
  const [autoSweepCount, setAutoSweepCount] = useState<number | null>(null);
  const [discoveryMinScore, setDiscoveryMinScore] = useState(12);
  const [onlineDiscoveryExpanded, setOnlineDiscoveryExpanded] = useState(false);
  const [customSourceName, setCustomSourceName] = useState("");
  const [customSourceUrl, setCustomSourceUrl] = useState("");
  const [editingDiscoverySourceId, setEditingDiscoverySourceId] = useState<number | null>(null);
  const [editingSourceName, setEditingSourceName] = useState("");
  const [editingSourceUrl, setEditingSourceUrl] = useState("");
  const [sourceEditError, setSourceEditError] = useState<string | null>(null);
  const [gmailProcessing, setGmailProcessing] = useState(false);
  const [gmailReconnectRequired, setGmailReconnectRequired] = useState(false);
  const [onlineProcessing, setOnlineProcessing] = useState(false);
  const [latestAvailabilityChecks, setLatestAvailabilityChecks] = useState<DiscoveryAvailabilityCheck[] | null>(null);

  // Historical jobs are not swept merely by opening the dashboard.
  useEffect(() => {
    setDismissedNearDups(new Set());
    setNearDupMap(new Map());
    setSavingDistinctPair(null);
  }, [userId]);

  async function flagAsDuplicate(postingId: number) {
    if (!await decision.dismiss(postingId, "duplicate")) return;
    setNearDupMap((prev) => {
      const next = new Map(prev);
      const entry = next.get(postingId);
      const pairedId = entry ? (entry.isId1 ? entry.id2 : entry.id1) : undefined;
      next.delete(postingId);
      if (pairedId !== undefined) next.delete(pairedId);
      return next;
    });
  }

  async function dismissNearDup(postingId: number) {
    const entry = nearDupMap.get(postingId);
    const pairedId = entry ? (entry.isId1 ? entry.id2 : entry.id1) : undefined;
    if (!entry || pairedId === undefined) return;
    const key = [postingId, pairedId].sort((a, b) => a - b).join(":");
    setSavingDistinctPair(key);
    try {
      const token = await getToken();
      const result = await fetch("/api/postings/not-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ postingId, otherPostingId: pairedId }),
      });
      if (!result.ok) throw new Error("Could not save this comparison");
      setDismissedNearDups((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setReviewingNearDups((prev) => {
        const next = new Set(prev);
        next.delete(postingId);
        next.delete(pairedId);
        return next;
      });
      setNearDupRevision((revision) => revision + 1);
      toast({ title: "Saved as different jobs", description: "This specific pair will no longer be suggested as duplicates." });
    } catch {
      toast({ title: "Could not save comparison", description: "Nothing changed. Please try again.", variant: "destructive" });
    } finally { setSavingDistinctPair(null); }
  }

  function toggleReviewNearDup(postingId: number) {
    const entry = nearDupMap.get(postingId);
    const pairedId = entry ? (entry.isId1 ? entry.id2 : entry.id1) : undefined;
    setReviewingNearDups((prev) => {
      const next = new Set(prev);
      if (next.has(postingId)) {
        next.delete(postingId);
        if (pairedId !== undefined) next.delete(pairedId);
      } else {
        next.add(postingId);
        if (pairedId !== undefined) next.add(pairedId);
      }
      return next;
    });
  }

  const companyFilterQ = useGetCompanyFilterSettings();
  const updateCompanyFilterMutation = useUpdateCompanyFilterSettings();

  const titleExcludeQ = useGetTitleExcludeSettings();
  const updateTitleExcludeMutation = useUpdateTitleExcludeSettings();
  const [titleExcludeInput, setTitleExcludeInput] = useState("");

  async function addTitleExcludeKeyword(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const current = titleExcludeQ.data?.keywords ?? [];
    if (current.some((k) => k.toLowerCase() === trimmed.toLowerCase())) return;
    const next = [...current, trimmed];
    setTitleExcludeInput("");
    await updateTitleExcludeMutation.mutateAsync({ data: { keywords: next } }, {
      onSuccess: (data) => {
        qc.setQueryData(getGetTitleExcludeSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: ["/api/postings"] });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  }

  async function removeTitleExcludeKeyword(kw: string) {
    const current = titleExcludeQ.data?.keywords ?? [];
    const next = current.filter((k) => k !== kw);
    await updateTitleExcludeMutation.mutateAsync({ data: { keywords: next } }, {
      onSuccess: (data) => {
        qc.setQueryData(getGetTitleExcludeSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: ["/api/postings"] });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    });
  }

  async function blockCompany(companyName: string) {
    const current = companyFilterQ.data ?? { mode: "off" as const, companies: [] };
    const alreadyBlocked = current.mode === "exclude" &&
      current.companies.some((c) => companyName.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(companyName.toLowerCase()));
    if (alreadyBlocked) {
      toast({ title: "Already blocked", description: `${companyName} is already in your company block list.` });
      return;
    }
    const newSettings = {
      ...current,
      mode: "exclude" as const,
      companies: [...(current.mode === "exclude" ? current.companies : []), companyName],
    };
    await updateCompanyFilterMutation.mutateAsync({ data: newSettings }, {
      onSuccess: () => {
        qc.setQueryData(getGetCompanyFilterSettingsQueryKey(), newSettings);
        qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
        toast({
          title: "Company blocked",
          description: `${companyName} added to your block list. Jobs from this company are now hidden.`,
        });
      },
      onError: () => {
        toast({ title: "Error", description: "Could not block company.", variant: "destructive" });
      },
    });
  }

  const dashboardQ = useGetDashboardSummary();
  const pageQuery = useGetPostingPage(
    {
      search: search || undefined,
      minFitScore,
      applied: activeTab === "applied" ? true : activeTab === "active" ? false : undefined,
      archived: activeTab === "deleted" || undefined,
      limit: 25,
      offset: page * 25,
      sort: sortKey as "recommended" | "date-desc" | "date-asc" | "score-desc" | "score-asc" | "title-asc" | "title-desc" | "company-asc" | "company-desc",
      compact: true,
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: {
        // Keep existing posting mutation invalidations refreshing this page too.
        queryKey: [...getListPostingsQueryKey(), "page", { activeTab, search, minFitScore, page, sortKey }],
        refetchInterval: (query: any) => {
          const data = query.state.data?.items;
          if (!data || document.visibilityState === "hidden") return false;
          const hasUnscored = data.some((p: any) => p.report?.fitScore == null);
          return hasUnscored ? 5000 : 30_000;
        },
      } as any,
    },
  );
  const postingsQ = { ...pageQuery, data: pageQuery.data?.items };
  const totalPages = Math.ceil((pageQuery.data?.total ?? 0) / 25);
  useEffect(() => {
    if (pageQuery.data) setPage((current) => Math.min(current, Math.max(0, totalPages - 1)));
  }, [pageQuery.data, totalPages]);
  const deletedQ = postingsQ;
  const gmailStatusQ = useGetGmailStatus({
    query: {
      queryKey: getGetGmailStatusQueryKey(),
      refetchInterval: (query) => query.state.data?.connected
        ? (query.state.data.syncing ? 1500 : 5000)
        : false,
    },
  });
  const discoveryQ = useGetOnlineDiscoveryStatus();
  const discoverySourcesQ = useGetOnlineDiscoverySources({ query: { queryKey: getGetOnlineDiscoverySourcesQueryKey(), staleTime: 0, refetchInterval: 15_000, refetchOnMount: "always" } });
  const createMutation = useCreatePosting();
  const deleteMutation = useDeletePosting();
  const decision = usePostingDecision();
  const markAppliedMutation = useMarkApplied();
  const restoreMutation = useRestorePosting();
  const reopenMutation = useReopenPosting();
  const syncMutation = useSyncGmail();
  const disconnectMutation = useDisconnectGmail();
  const runDiscoveryMutation = useRunOnlineDiscovery();
  const updateDiscoveryMutation = useUpdateOnlineDiscoverySettings();
  const createDiscoverySourceMutation = useCreateOnlineDiscoverySource();
  const updateDiscoverySourceMutation = useUpdateOnlineDiscoverySource();
  const deleteDiscoverySourceMutation = useDeleteOnlineDiscoverySource();

  useEffect(() => {
    if (discoveryQ.data?.minimumMatchScore != null) {
      setDiscoveryMinScore(discoveryQ.data.minimumMatchScore);
    }
  }, [discoveryQ.data?.minimumMatchScore]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreatePostingBody>({
    defaultValues: { title: "", company: "", fullDescription: "", source: "manual" },
  });

  const summary = dashboardQ.data;
  const rawPostings = postingsQ.data ?? [];
  const duplicateReviewIds = rawPostings.map(item => item.posting.id).join(",");
  const gmailStatus = gmailStatusQ.data;
  const gmailSyncing = gmailProcessing || syncMutation.isPending || gmailStatus?.syncing === true;
  const gmailProgress = gmailStatus?.syncing ? gmailStatus.progress : null;
  const gmailProgressText = gmailProgress
    ? `${gmailProgress.phase === "fetching"
      ? "Fetching emails…"
      : gmailProgress.phase === "finalizing"
        ? "Finishing sync…"
        : "Processing emails…"}${gmailProgress.emailsTotal !== null
      ? ` ${gmailProgress.emailsProcessed}/${gmailProgress.emailsTotal} emails processed ·`
      : ""} ${gmailProgress.jobsImported} job${gmailProgress.jobsImported === 1 ? "" : "s"} imported`
    : "Starting Gmail sync…";
  const previousGmailStatus = useRef<{ connected: boolean; syncing: boolean; lastSyncedAt?: string | null } | null>(null);
  useEffect(() => {
    if (!gmailStatus) return;
    const previous = previousGmailStatus.current;
    if (gmailStatus.connected) {
      setGmailReconnectRequired(false);
    } else if (previous?.connected) {
      setGmailReconnectRequired(true);
    }
    const finished = previous && (
      (previous.syncing && !gmailStatus.syncing)
      || previous.lastSyncedAt !== gmailStatus.lastSyncedAt
    );
    previousGmailStatus.current = {
      connected: gmailStatus.connected,
      syncing: gmailStatus.syncing,
      lastSyncedAt: gmailStatus.lastSyncedAt,
    };
    if (finished) {
      qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
      qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    }
  }, [gmailStatus, qc]);
  const discoveryStatus = discoveryQ.data;
  const discoverySources = discoverySourcesQ.data?.sources ?? [];
  const availableDiscoverySources = discoverySourcesQ.data?.availableSources ?? [];

  function refreshDiscoverySources() {
    qc.invalidateQueries({ queryKey: getGetOnlineDiscoverySourcesQueryKey() });
  }

  function addBuiltInDiscoverySource(provider: string) {
    createDiscoverySourceMutation.mutate({ data: { provider } }, {
      onSuccess: () => {
        refreshDiscoverySources();
        toast({ title: "Source added" });
      },
      onError: () => toast({ title: "Could not add source", variant: "destructive" }),
    });
  }

  function addCustomDiscoverySource() {
    const url = customSourceUrl.trim();
    if (!url) {
      toast({ title: "Add a public HTTPS feed URL", variant: "destructive" });
      return;
    }
    createDiscoverySourceMutation.mutate(
      { data: { name: customSourceName.trim() || null, url } },
      {
        onSuccess: () => {
          setCustomSourceName("");
          setCustomSourceUrl("");
          refreshDiscoverySources();
          toast({ title: "Custom source added" });
        },
        onError: (error: Error) => toast({ title: "Could not add source", description: error.message, variant: "destructive" }),
      },
    );
  }

  function toggleDiscoverySource(source: OnlineDiscoverySource) {
    updateDiscoverySourceMutation.mutate({ id: source.id, data: { suppressed: !source.isSuppressed } }, {
      onSuccess: () => {
        refreshDiscoverySources();
        toast({
          title: source.isSuppressed ? "Source restored" : "Source suppressed",
          description: source.isSuppressed ? "It will be included in future searches." : "It will be skipped in future searches.",
        });
      },
      onError: () => toast({ title: "Could not update source", variant: "destructive" }),
    });
  }

  function startEditingDiscoverySource(source: OnlineDiscoverySource) {
    setEditingDiscoverySourceId(source.id);
    setEditingSourceName(source.name);
    setEditingSourceUrl(source.url);
    setSourceEditError(null);
  }

  function cancelEditingDiscoverySource() {
    setEditingDiscoverySourceId(null);
    setEditingSourceName("");
    setEditingSourceUrl("");
    setSourceEditError(null);
  }

  function saveDiscoverySource(source: OnlineDiscoverySource) {
    const name = editingSourceName.trim();
    const url = editingSourceUrl.trim();
    if (!name) {
      setSourceEditError("Source name cannot be blank.");
      return;
    }
    if (source.kind !== "builtin" && !url) {
      setSourceEditError("Source URL cannot be blank.");
      return;
    }

    const data = source.kind === "builtin"
      ? { name }
      : { name, url };
    setSourceEditError(null);
    updateDiscoverySourceMutation.mutate({ id: source.id, data }, {
      onSuccess: () => {
        cancelEditingDiscoverySource();
        refreshDiscoverySources();
        toast({ title: "Source updated" });
      },
      onError: (error) => {
        const message = error.data?.error ?? error.message;
        setSourceEditError(message || "Could not update source.");
      },
    });
  }

  function removeDiscoverySource(source: OnlineDiscoverySource) {
    deleteDiscoverySourceMutation.mutate({ id: source.id }, {
      onSuccess: () => {
        refreshDiscoverySources();
        toast({ title: "Source removed", description: "Previously imported jobs were kept." });
      },
      onError: () => toast({ title: "Could not remove source", variant: "destructive" }),
    });
  }

  function saveDiscoverySettings(
    scheduleHours: number | null,
    minimumMatchScore = discoveryMinScore,
    freshnessWindow: OnlineDiscoverySettingsFreshnessWindow = discoveryStatus?.freshnessWindow ?? "past_month",
  ) {
    updateDiscoveryMutation.mutate(
      { data: { scheduleHours, minimumMatchScore, freshnessWindow } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetOnlineDiscoveryStatusQueryKey() });
          toast({ title: "Discovery preferences saved" });
        },
        onError: () => toast({ title: "Could not save discovery preferences", variant: "destructive" }),
      },
    );
  }

  function onDiscoverOnline() {
    setOnlineProcessing(true);
    runDiscoveryMutation.mutate(undefined, {
      onSuccess: async (result) => {
        setLatestAvailabilityChecks((result.availabilityChecks ?? [])
          .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())
          .slice(0, 5));
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetOnlineDiscoveryStatusQueryKey() }),
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
        ]);
        setOnlineProcessing(false);
        const resultSummary = result.report
          ? `${result.report.imported} new jobs added from ${result.report.retrieved} results. ${result.report.alreadySaved} already saved; ${result.report.repeated} repeated results; ${result.report.excluded} excluded by matching or availability checks; ${result.report.recentlyChecked} recently checked.`
            + (result.report.deferred ? ` ${result.report.deferred} deferred because this run reached its limit.` : "")
          : `${result.imported} new jobs added; ${result.matchedExisting} matching jobs already saved.`;
        toast({
          title: result.lastError ? "Online search completed with warnings" : "Online search complete",
          description: result.lastError ? `${resultSummary} ${result.lastError}` : resultSummary,
        });
      },
      onError: (error: Error) => {
        setOnlineProcessing(false);
        toast({ title: "Discovery failed", description: error.message, variant: "destructive" });
      },
    });
  }

  const tabStats = useMemo(() => {
    const items: Array<{ report?: { fitScore?: number | null } | null }> =
      postingsQ.data ?? [];
    const total = activeTab === "active" ? summary?.totalPostings ?? items.length
      : activeTab === "applied" ? summary?.appliedPostings ?? items.length
      : summary?.archivedPostings ?? items.length;
    const scored = items.filter((item) => item.report?.fitScore != null);
    const avgFit =
      scored.length > 0
        ? scored.reduce((s, item) => s + (item.report!.fitScore ?? 0), 0) / scored.length
        : null;
    const strong = scored.filter((item) => (item.report?.fitScore ?? 0) >= 85).length;
    return { total, avgFit, strong };
  }, [activeTab, postingsQ.data, summary]);

  const allPostingsById = useMemo(() => {
    const map = new Map<number, { posting: { id: number; title: string; company: string }; report: { fitScore?: number | null } | null }>();
    for (const item of (postingsQ.data ?? [])) map.set(item.posting.id, item);
    return map;
  }, [postingsQ.data]);

  useEffect(() => {
    if (!rawPostings.length) {
      setNearDupMap((previous) => previous.size ? new Map() : previous);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    getToken().then((token) => {
      if (controller.signal.aborted) throw new Error("Duplicate review cancelled");
      return fetch("/api/postings/near-duplicates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
    }).then((r) => { if (!r.ok) throw new Error("Duplicate review unavailable"); return r.json(); })
      .then((pairs: NearDupPair[]) => {
        const map = new Map<number, NearDupPair & { isId1: boolean }>();
        for (const pair of pairs) {
          map.set(pair.id1, { ...pair, isId1: true });
          map.set(pair.id2, { ...pair, isId1: false });
        }
        if (!cancelled) setNearDupMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateReviewIds, nearDupRevision, userId, getToken]);

  const postings = useMemo(() => {
    let items = [...rawPostings];
    switch (sortKey) {
      case "recommended":
        return items.sort((a, b) =>
          ((b.report?.fitScore ?? 0) + (b.posting.preferenceAdjustment ?? 0))
          - ((a.report?.fitScore ?? 0) + (a.posting.preferenceAdjustment ?? 0))
          || new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime());
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

  const deletedPostings = useMemo(() => {
    let items = [...(deletedQ.data ?? [])];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((p) =>
        p.posting.title.toLowerCase().includes(q) || p.posting.company.toLowerCase().includes(q)
      );
    }
    if (minFitScore != null) {
      items = items.filter((p) => (p.report?.fitScore ?? 0) >= minFitScore);
    }
    switch (sortKey) {
      case "recommended": return items.sort((a, b) =>
        ((b.report?.fitScore ?? 0) + (b.posting.preferenceAdjustment ?? 0))
        - ((a.report?.fitScore ?? 0) + (a.posting.preferenceAdjustment ?? 0)));
      case "date-desc": return items.sort((a, b) => new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime());
      case "date-asc":  return items.sort((a, b) => new Date(a.posting.createdAt).getTime() - new Date(b.posting.createdAt).getTime());
      case "score-desc": return items.sort((a, b) => (b.report?.fitScore ?? -1) - (a.report?.fitScore ?? -1));
      case "score-asc":  return items.sort((a, b) => (a.report?.fitScore ?? 101) - (b.report?.fitScore ?? 101));
      case "title-asc":   return items.sort((a, b) => a.posting.title.localeCompare(b.posting.title));
      case "title-desc":  return items.sort((a, b) => b.posting.title.localeCompare(a.posting.title));
      case "company-asc": return items.sort((a, b) => a.posting.company.localeCompare(b.posting.company));
      case "company-desc":return items.sort((a, b) => b.posting.company.localeCompare(a.posting.company));
      default: return items;
    }
  }, [deletedQ.data, search, minFitScore, sortKey]);

  async function handleConnectGmail() {
    try {
      const token = await getToken();
      const res = await fetch("/api/gmail/auth-url", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to get auth URL");
      const { url } = await res.json() as { url: string };

      // Open in a popup to avoid X-Frame-Options issues inside Replit's iframe preview
      const popup = window.open(url, "gmail_oauth", "width=520,height=640,left=200,top=100");
      if (!popup) {
        // Popup blocked — fall back to same-window navigation
        window.location.href = url;
        return;
      }

      function onMessage(event: MessageEvent) {
        if (event.data?.type === "gmail_connected") {
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          toast({ title: "Gmail connected", description: "Your Gmail account is now linked to Career Scout." });
          cleanup();
        } else if (event.data?.type === "gmail_error") {
          toast({ title: "Gmail connection failed", description: "Could not connect your Gmail account. Please try again.", variant: "destructive" });
          cleanup();
        }
      }

      const pollTimer = setInterval(() => {
        if (popup.closed) {
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          cleanup();
        }
      }, 800);

      function cleanup() {
        window.removeEventListener("message", onMessage);
        clearInterval(pollTimer);
      }

      window.addEventListener("message", onMessage);
    } catch {
      toast({ title: "Error", description: "Could not start Gmail connection. Try again.", variant: "destructive" });
    }
  }

  function onSyncGmail() {
    if (gmailSyncing) return;
    setGmailProcessing(true);
    syncMutation.mutate(
      undefined,
      {
        onSuccess: async (data) => {
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListPostingsQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() }),
          ]);
          setGmailProcessing(false);
          toast({
            title: "Gmail synced",
            description: data.synced > 0
              ? `Imported ${data.synced} new job${data.synced === 1 ? "" : "s"} from Gmail.`
              : "No new jobs added from Gmail.",
          });
        },
        onError: async (error) => {
          setGmailProcessing(false);
          const expired = error.data?.error === "gmail_token_expired";
          const message = error.data?.error ?? error.message;
          const reconnect = expired || (error.status === 502 && /Reconnect Gmail/.test(message));
          if (reconnect) setGmailReconnectRequired(true);
          // A label update can fail after jobs were safely imported.
          await Promise.all([
            qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() }),
            qc.invalidateQueries({ queryKey: getListPostingsQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
          ]);
          toast({
            title: reconnect ? "Reconnect Gmail" : "Sync incomplete",
            description: expired
              ? "Gmail access has expired. Use Reconnect Gmail below to resume importing jobs."
              : message,
            variant: "destructive",
          });
        },
      }
    );
  }

  async function onReanalyzeAll() {
    setReanalyzing(true);
    try {
      const token = await getToken();
      const response = await fetch("/api/postings/rescore-all", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Could not queue re-analysis");
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

  async function onSweepDuplicates() {
    setSweepingDuplicates(true);
    try {
      const token = await getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const preview = await fetch("/api/postings/dedup-preview", { headers });
      if (!preview.ok) throw new Error("Preview failed");
      const result = await preview.json() as NonNullable<typeof cleanupPreview>;
      if (!result.ids.length) {
        toast({ title: "No duplicates found", description: "No confirmed copies are eligible for cleanup." });
        return;
      }
      setCleanupPreview(result);
    } catch {
      toast({ title: "Cleanup preview failed", description: "Could not load jobs eligible for cleanup.", variant: "destructive" });
    } finally {
      setSweepingDuplicates(false);
    }
  }

  async function confirmSweepDuplicates() {
    if (!cleanupPreview) return;
    setSweepingDuplicates(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/postings/dedup-sweep", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds: cleanupPreview.ids }),
      });
      if (!res.ok) throw new Error("Sweep failed");
      const { removed } = await res.json() as { removed: number };
      setCleanupPreview(null);
      qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
      qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({
        title: removed > 0 ? `Removed ${removed} duplicate job${removed === 1 ? "" : "s"}` : "No duplicates found",
        description: removed > 0
          ? `${removed} active job${removed === 1 ? "" : "s"} matched something you already deleted or applied to.`
          : "All active jobs look unique compared to your deleted and applied lists.",
      });
    } catch {
      toast({ title: "Error", description: "Could not run duplicate cleanup.", variant: "destructive" });
    } finally {
      setSweepingDuplicates(false);
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

  async function onExportCsv() {
    setExportingCsv(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/postings/export.csv", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "career-scout-jobs.csv";
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", description: "Could not export jobs to CSV.", variant: "destructive" });
    } finally {
      setExportingCsv(false);
    }
  }

  async function onImportCsv(file: File) {
    setImportingCsv(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/postings/import", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error ?? "Unknown error");
      }
      const { imported, skipped, invalid } = await res.json() as { imported: number; skipped: number; invalid: number };
      const parts: string[] = [];
      if (imported > 0) parts.push(`${imported} job${imported === 1 ? "" : "s"} imported`);
      if (skipped > 0) parts.push(`${skipped} skipped as duplicate${skipped === 1 ? "" : "s"}`);
      if (invalid > 0) parts.push(`${invalid} invalid row${invalid === 1 ? "" : "s"} skipped`);
      toast({
        title: imported > 0 ? "Import complete" : "Nothing imported",
        description: parts.length > 0 ? parts.join(", ") + "." : "No valid jobs found in file.",
      });
      if (imported > 0) {
        qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImportingCsv(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function onRetryLink(postingId: number) {
    setRetryingLinks((prev) => new Set(prev).add(postingId));
    try {
      const token = await getToken();
      const res = await fetch(`/api/postings/${postingId}/retry-link`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error ?? "Unknown error");
      }
      const { link } = await res.json() as { link: string };
      toast({ title: "Link found", description: link });
      qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Couldn't find link",
        description: msg === "No URL found in email" ? "No job URL was found in the original email." : msg,
        variant: "destructive",
      });
    } finally {
      setRetryingLinks((prev) => {
        const next = new Set(prev);
        next.delete(postingId);
        return next;
      });
    }
  }

  async function onDisconnectGmail() {
    await disconnectMutation.mutateAsync(
      undefined,
      {
        onSuccess: () => {
          previousGmailStatus.current = null;
          setGmailReconnectRequired(false);
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
        onError: (error) => toast({ title: "Job not added", description: error.data?.error ?? error.message, variant: "destructive" }),
      }
    );
  }

  async function onDelete(id: number) {
    await deleteMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Deleted", description: "Job posting moved to Deleted." });
        },
        onError: () => toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }),
      }
    );
  }

  async function onRestore(id: number) {
    await restoreMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Restored to Active", description: "This job is back in your Active list." });
        },
        onError: () => toast({ title: "Could not restore", description: "The job is still in Deleted. Please try again.", variant: "destructive" }),
      }
    );
  }

  async function onReopen(id: number) {
    await reopenMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Reopened", description: "Job posting moved back to Active." });
        },
        onError: () => toast({ title: "Error", description: "Failed to reopen posting.", variant: "destructive" }),
      }
    );
  }

  function onToggleApplied(id: number, title: string, alreadyLiked: boolean) {
    markAppliedMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPostingQueryKey(id) });
          if (result.appliedAt && !alreadyLiked) {
            setAppliedPreferenceJob({ id, title });
          } else {
            toast({
              title: result.appliedAt ? "Marked as applied" : "Moved back to Active",
              description: result.appliedAt
                ? "Job moved to your Applied tab."
                : "Job moved back to your active list.",
            });
          }
        },
        onError: () => toast({ title: "Error", description: "Failed to update status.", variant: "destructive" }),
      }
    );
  }

  return (
    <Layout>
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

        {/* View tabs + Filters — single row */}
        <div className="flex items-center border-b border-border mb-5">
          {/* Filters on left — icon-only on mobile */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            aria-label={showFilters ? "Hide filters" : "Show filters"}
            aria-expanded={showFilters}
            className={`gap-1.5 shrink-0 mr-3 h-8 px-2 ${showFilters ? "border-indigo-500 text-indigo-400" : ""}`}
            data-testid="filter-button"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-xs">Filters</span>
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Tabs */}
          <button
            type="button"
            aria-current={activeTab === "active" ? "true" : undefined}
            aria-pressed={activeTab === "active"}
            onClick={() => setActiveTab("active")}
            data-testid="tab-active"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "active"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
            {summary != null && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "active" ? "bg-indigo-500/20 text-indigo-300" : "bg-muted text-muted-foreground"
              }`}>
                {summary.totalPostings}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-current={activeTab === "applied" ? "true" : undefined}
            aria-pressed={activeTab === "applied"}
            onClick={() => setActiveTab("applied")}
            data-testid="tab-applied"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "applied"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Applied
            {summary != null && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "applied" ? "bg-indigo-500/20 text-indigo-300" : "bg-muted text-muted-foreground"
              }`}>
                {summary.appliedPostings ?? 0}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-current={activeTab === "deleted" ? "true" : undefined}
            aria-pressed={activeTab === "deleted"}
            onClick={() => setActiveTab("deleted")}
            data-testid="tab-deleted"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "deleted"
                ? "border-red-500 text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Deleted
            {summary != null && (summary.archivedPostings ?? 0) > 0 && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "deleted" ? "bg-red-500/20 text-red-300" : "bg-muted text-muted-foreground"
              }`}>
                {summary.archivedPostings}
              </span>
            )}
          </button>
        </div>

        {/* Filters panel */}
        <>

            {showFilters && (
              <div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-card border border-border rounded-lg">
                <div className="basis-full space-y-1 border-b border-border pb-3">
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={companyFilterQ.data?.bayAreaNonRemoteOnly !== false}
                      disabled={companyFilterQ.isLoading || companyFilterQ.isError || updateCompanyFilterMutation.isPending}
                      data-testid="bay-area-only-toggle"
                      onChange={(event) => {
                        const bayAreaNonRemoteOnly = event.target.checked;
                        const settings = { ...(companyFilterQ.data ?? { mode: "off" as const, companies: [] }), bayAreaNonRemoteOnly };
                        updateCompanyFilterMutation.mutate({ data: settings }, {
                          onSuccess: (saved) => {
                            qc.setQueryData(getGetCompanyFilterSettingsQueryKey(), saved);
                            qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
                            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                            toast({ title: bayAreaNonRemoteOnly ? "Bay Area or remote filter enabled" : "Location filter disabled", description: "No job postings were deleted." });
                          },
                          onError: () => toast({ title: "Filter not saved", description: "Please try again.", variant: "destructive" }),
                        });
                      }}
                    />
                    SF Bay Area or fully remote
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Allow any SF Bay Area role, fully remote roles anywhere, and unknown locations. Known non-local jobs need explicit remote eligibility; a blank work arrangement does not qualify.
                    {" "}<Link href="/filtered" className="underline underline-offset-2">Review hidden jobs in Filtered</Link>; turn this off to include them again.
                  </p>
                </div>
                <div className="basis-full space-y-1 border-b border-border pb-3">
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={companyFilterQ.data?.excludeWorkday !== false}
                      disabled={companyFilterQ.isLoading || companyFilterQ.isError || updateCompanyFilterMutation.isPending}
                      data-testid="exclude-workday-toggle"
                      onChange={(event) => {
                        const excludeWorkday = event.target.checked;
                        const settings = { ...(companyFilterQ.data ?? { mode: "off" as const, companies: [] }), excludeWorkday };
                        updateCompanyFilterMutation.mutate({ data: settings }, {
                          onSuccess: (saved) => {
                            qc.setQueryData(getGetCompanyFilterSettingsQueryKey(), saved);
                            qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
                            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                            toast({ title: excludeWorkday ? "Workday jobs hidden" : "Workday jobs included", description: "No job postings were deleted." });
                          },
                          onError: () => toast({ title: "Filter not saved", description: "Please try again.", variant: "destructive" }),
                        });
                      }}
                    />
                    Hide Workday ATS
                    {updateCompanyFilterMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Excludes known Workday application links, not roles that simply mention Workday.
                    {" "}<Link href="/filtered" className="underline underline-offset-2">Hidden jobs stay in Filtered</Link>; turn this off to show them again.
                  </p>
                </div>
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
                  <Label htmlFor="dashboard-sort" className="text-xs text-muted-foreground">
                    Sort {activeTab === "active" ? "Active" : activeTab === "applied" ? "Applied" : "Deleted"}
                  </Label>
                  <div className="relative">
                    <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <select
                      id="dashboard-sort"
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value)}
                      data-testid="sort-select"
                      className="h-9 pl-8 pr-3 text-sm rounded-md border border-input bg-background text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                    >
                      <option value="recommended">Recommended: Fit + your choices</option>
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
                <div className="w-full space-y-1.5 pt-1 border-t border-border/50">
                  <Label className="text-xs text-muted-foreground">Blocked title keywords</Label>
                  {(titleExcludeQ.data?.keywords ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(titleExcludeQ.data?.keywords ?? []).map((kw) => (
                        <span
                          key={kw}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-red-950/40 text-red-300 border-red-800/30"
                        >
                          {kw}
                          <button
                            type="button"
                            aria-label={`Remove blocked title keyword ${kw}`}
                            onClick={() => removeTitleExcludeKeyword(kw)}
                            disabled={updateTitleExcludeMutation.isPending}
                            className="ml-0.5 text-red-400 hover:text-red-200 disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="e.g. Engineering Manager"
                      value={titleExcludeInput}
                      onChange={(e) => setTitleExcludeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitleExcludeKeyword(titleExcludeInput); } }}
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => addTitleExcludeKeyword(titleExcludeInput)}
                      disabled={!titleExcludeInput.trim() || updateTitleExcludeMutation.isPending}
                    >
                      {updateTitleExcludeMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                {(search || minFitScore != null || sortKey !== "recommended") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSearch(""); setMinFitScore(undefined); setSortKey("recommended"); }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            )}
        </>

        {/* Deleted tab info bar */}
        {activeTab === "deleted" && (
          <p className="text-xs text-muted-foreground mb-4">
            Deleted jobs are listed below. Closed jobs (position no longer open) are also shown here — they can re-import if the role reopens.
          </p>
        )}

        {/* Postings list */}
        {activeTab === "deleted" ? (
          deletedQ.isLoading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : deletedQ.isError && !deletedQ.data ? (
            <QueryError retry={() => { void deletedQ.refetch(); }} />
          ) : deletedPostings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Trash2 className="w-10 h-10 text-muted-foreground mb-4" />
              <p className="text-foreground font-medium">
                {deletedQ.data && deletedQ.data.length > 0 ? "No matching archived jobs" : "No archived jobs"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {deletedQ.data && deletedQ.data.length > 0
                  ? "Try adjusting your search or filters."
                  : "Jobs you delete or close will appear here."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {deletedPostings.map((item) => {
                const { posting, report } = item;
                const score = report?.fitScore ?? null;
                const isClosed = !!posting.closedAt && !posting.deletedAt;
                return (
                  <div
                    key={posting.id}
                    className="flex items-center gap-4 bg-card border border-border rounded-xl px-5 py-4 opacity-60"
                    data-testid={`deleted-posting-card-${posting.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FitScoreBadge score={score} status={item.analysisState === "failed" && score == null ? "failed" : item.scoreStatus} />
                        {item.onlineMatchScore != null && (
                          <StatusBadge tone="neutral" title="Search match: discovery heuristic, separate from Profile fit">
                            Search match {item.onlineMatchScore}
                          </StatusBadge>
                        )}
                        <span className="font-semibold text-foreground line-through">{posting.title}</span>
                        <StatusBadge tone="neutral">{posting.senderName ?? item.sourceName ?? posting.source}</StatusBadge>
                        {posting.deletedBy === "sweep" && (
                          <StatusBadge tone="destructive">
                            <Layers className="w-3 h-3" aria-hidden="true" />
                            Removed automatically
                          </StatusBadge>
                        )}
                        {posting.deletedBy === "duplicate" && (
                          <StatusBadge tone="destructive">Reported duplicate</StatusBadge>
                        )}
                        {item.feedback && item.feedback.kind !== "more_like_this" && (
                          <span className="text-[11px] text-muted-foreground" data-testid={`deleted-reason-${posting.id}`}>
                            Reason: {reasonLabel(item.feedback.kind)}
                          </span>
                        )}
                        {isClosed && (
                          <StatusBadge tone="hidden">
                            <Archive className="w-3 h-3" aria-hidden="true" />
                            Closed
                          </StatusBadge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span>{posting.company}</span>
                        {posting.location && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground/80">
                            <MapPin className="w-3 h-3" />
                            {posting.location}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {posting.sourcePostedAt && `Posted ${formatDate(posting.sourcePostedAt)} · `}
                          Discovered {formatAdded(posting.createdAt)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isClosed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => onReopen(posting.id)}
                          disabled={reopenMutation.isPending}
                          data-testid={`posting-reopen-${posting.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reopen
                        </Button>
                      ) : posting.dismissalUndoToken ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => void decision.undoDismissal(posting.id, posting.dismissalUndoToken!)}
                          disabled={decision.pending}
                          data-testid={`posting-undo-dismissal-${posting.id}`}
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          Undo
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => onRestore(posting.id)}
                          disabled={restoreMutation.isPending}
                          aria-busy={restoreMutation.isPending && restoreMutation.variables?.id === posting.id}
                          data-testid={`posting-restore-${posting.id}`}
                        >
                          {restoreMutation.isPending && restoreMutation.variables?.id === posting.id
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />Restoring...</>
                            : <><RotateCcw className="w-3.5 h-3.5" />Restore</>}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : postingsQ.isLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : postingsQ.isError && !postingsQ.data ? (
          <QueryError retry={() => { void postingsQ.refetch(); }} />
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
              const availability = posting;
              return (
                <div key={posting.id} className="flex flex-col">
                <div
                  className={`flex flex-col sm:flex-row sm:items-center gap-0 bg-card border border-border rounded-xl overflow-hidden transition-colors ${posting.link ? "hover:border-indigo-800/50 cursor-pointer" : "cursor-default"}`}
                  data-testid={`posting-card-${posting.id}`}
                  role={posting.link ? "link" : undefined}
                  tabIndex={posting.link ? 0 : undefined}
                  aria-label={posting.link ? `Open ${posting.title} at ${posting.company} in a new tab` : undefined}
                  onClick={() => { if (posting.link) window.open(posting.link, "_blank", "noopener,noreferrer"); }}
                  onKeyDown={(event) => {
                    if (posting.link && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      window.open(posting.link, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  {/* Info row — text content */}
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 px-4 pt-3 pb-2 sm:px-5 sm:py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FitScoreBadge score={score} status={item.analysisState === "failed" && score == null ? "failed" : item.scoreStatus} />
                        <PreferenceBadge posting={posting} />
                        {item.onlineMatchScore != null && (
                          <StatusBadge tone="neutral" title="Search match: discovery heuristic, separate from Profile fit">
                            Search match {item.onlineMatchScore}
                          </StatusBadge>
                        )}
                        <span
                          className="font-semibold text-foreground"
                          data-testid={`posting-title-${posting.id}`}
                        >
                          {posting.title}
                        </span>
                        <StatusBadge tone="neutral">
                          {posting.senderName ?? item.sourceName ?? posting.source}
                        </StatusBadge>
                        {posting.appliedAt && (
                          <StatusBadge tone="success">
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                            Applied
                          </StatusBadge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span>{posting.company}</span>
                        {posting.location && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground/80">
                            <MapPin className="w-3 h-3" />
                            {posting.location}
                          </span>
                        )}
                        {(posting.salaryMin || posting.salaryMax) && (
                          <span className="text-xs text-sky-400 font-medium">
                            {posting.salaryMin && posting.salaryMax
                              ? `$${(posting.salaryMin / 1000).toFixed(0)}k–$${(posting.salaryMax / 1000).toFixed(0)}k`
                              : posting.salaryMin
                              ? `$${(posting.salaryMin / 1000).toFixed(0)}k+`
                              : `up to $${(posting.salaryMax! / 1000).toFixed(0)}k`}
                          </span>
                        )}
                        {posting.sourcePostedAt && (
                          <span className="text-xs text-muted-foreground" title="Date listed by the original source">
                            Posted {formatDate(posting.sourcePostedAt)}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground" title="Date discovered and added to Career Scout">
                          Discovered {formatAdded(posting.createdAt)}
                        </span>
                      </p>
                      {availabilityLabel(availability) && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid={`availability-${posting.id}`}>
                          <StatusBadge tone={availability.availabilityStatus === "open" ? "success" : availability.availabilityStatus == null ? "neutral" : "warning"}>
                            {availabilityLabel(availability)}
                          </StatusBadge>
                          {availability.availabilityReason && (
                            <span className="text-muted-foreground">{humanizeAvailabilityReason(availability.availabilityReason)}</span>
                          )}
                          {availability.availabilityCheckedAt && (
                            <span className="text-muted-foreground">
                              Checked {formatAdded(availability.availabilityCheckedAt)}
                            </span>
                          )}
                        </div>
                      )}
                      {report?.matchedSkills && report.matchedSkills.length > 0 && (
                        <div className="hidden sm:flex flex-wrap gap-1 mt-2">
                          {report.matchedSkills.slice(0, 4).map((skill) => (
                            <span key={skill} className="text-xs px-2 py-0.5 rounded-full bg-sky-950/40 text-sky-400 border border-sky-800/30">
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Action buttons — spread full-width on mobile, compact row on desktop */}
                  <div
                    className="flex items-center justify-around sm:justify-start sm:gap-1 sm:shrink-0 sm:pr-2 border-t sm:border-t-0 border-border/40 px-1 py-1 sm:px-0 sm:py-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={posting.appliedAt ? `Undo applied status for ${posting.title}` : `Mark ${posting.title} as applied`}
                      onClick={() => onToggleApplied(posting.id, posting.title, item.feedback?.kind === "more_like_this")}
                      disabled={markAppliedMutation.isPending}
                      aria-busy={markAppliedMutation.isPending && markAppliedMutation.variables?.id === posting.id}
                      data-testid={`posting-apply-${posting.id}`}
                      title={posting.appliedAt ? "Undo applied" : "Mark as applied"}
                      className={`w-9 h-9 sm:w-8 sm:h-8 ${posting.appliedAt ? "text-success hover:text-success/80" : "text-muted-foreground hover:text-success"}`}
                    >
                      {markAppliedMutation.isPending && markAppliedMutation.variables?.id === posting.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        : posting.appliedAt ? <Undo2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <PostingDecisionControls postingId={posting.id} feedback={item.feedback} primaryAction="duplicate" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground" aria-label="More actions" data-testid={`posting-more-actions-${posting.id}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger data-testid={`posting-dismiss-with-reason-${posting.id}`}>Dismiss</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DismissReasonItems
                              onSelect={(kind) => kind === "duplicate" ? flagAsDuplicate(posting.id) : decision.dismiss(posting.id, kind)}
                              disabled={decision.pending}
                              testId={(kind) => kind === "duplicate" ? `posting-flag-dupe-${posting.id}` : kind === "already_closed" ? `posting-close-${posting.id}` : `posting-dismiss-reason-${kind}-${posting.id}`}
                            />
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem asChild>
                          <Link href={`/postings/${posting.id}`} data-testid={`posting-details-${posting.id}`}>
                            <ExternalLink className="w-3.5 h-3.5 mr-2" />View details
                          </Link>
                        </DropdownMenuItem>
                        {!posting.link && posting.source === "gmail" && (
                          <DropdownMenuItem onSelect={() => onRetryLink(posting.id)} disabled={retryingLinks.has(posting.id)} data-testid={`posting-retry-link-${posting.id}`}>
                            <SearchCode className="w-3.5 h-3.5 mr-2" />Find link from email
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => blockCompany(posting.company)} disabled={updateCompanyFilterMutation.isPending} data-testid={`posting-block-company-${posting.id}`}>
                          <Ban className="w-3.5 h-3.5 mr-2" />Block {posting.company}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {nearDupMap.has(posting.id) && !dismissedNearDups.has([nearDupMap.get(posting.id)!.id1, nearDupMap.get(posting.id)!.id2].sort((a, b) => a - b).join(":")) && (() => {
                  const entry = nearDupMap.get(posting.id)!;
                  const isId1 = entry.isId1;
                  const pairedId    = isId1 ? entry.id2 : entry.id1;
                  const pairedTitle   = isId1 ? entry.title2   : entry.title1;
                  const pairedCompany = isId1 ? entry.company2  : entry.company1;
                  const pairedAppliedAt = isId1 ? entry.applied_at2 : entry.applied_at1;
                  const pairedDeletedAt = isId1 ? entry.deleted_at2 : entry.deleted_at1;
                  const pairedLocation  = isId1 ? entry.location2  : entry.location1;
                  const pairedUrl       = isId1 ? entry.url2       : entry.url1;
                  const pairedSalMin    = isId1 ? entry.salary_min2 : entry.salary_min1;
                  const pairedSalMax    = isId1 ? entry.salary_max2 : entry.salary_max1;
                  const pairedCreatedAt = isId1 ? entry.created_at2 : entry.created_at1;
                  const selfLocation    = isId1 ? entry.location1  : entry.location2;
                  const selfUrl         = isId1 ? entry.url1       : entry.url2;
                  const selfSalMin      = isId1 ? entry.salary_min1 : entry.salary_min2;
                  const selfSalMax      = isId1 ? entry.salary_max1 : entry.salary_max2;
                  const selfAppliedAt   = isId1 ? entry.applied_at1 : entry.applied_at2;

                  const cfSettings = companyFilterQ.data as { mode: string; companies: string[] } | undefined;
                  function isBlocked(company: string) {
                    if (!cfSettings || cfSettings.mode !== "exclude" || cfSettings.companies.length === 0) return false;
                    const c = company.toLowerCase();
                    return cfSettings.companies.some((e: string) => { const en = e.toLowerCase(); return c.includes(en) || en.includes(c); });
                  }

                  function StatusPill({ appliedAt, deletedAt, company }: { appliedAt: string | null; deletedAt: string | null; company: string }) {
                    if (deletedAt) return (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-red-950/50 text-red-400 border border-red-800/40">
                        Deleted
                      </span>
                    );
                    if (appliedAt) return (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-sky-950/50 text-sky-400 border border-sky-800/40">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Applied
                      </span>
                    );
                    if (isBlocked(company)) return (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-orange-950/50 text-orange-400 border border-orange-800/40">
                        Blocked
                      </span>
                    );
                    return (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">
                        Active
                      </span>
                    );
                  }
                  const pairedScore     = allPostingsById.get(pairedId)?.report?.fitScore ?? null;
                  const selfScore       = allPostingsById.get(posting.id)?.report?.fitScore ?? null;
                  const isReviewing = reviewingNearDups.has(posting.id);

                  function fmtSalary(min: number | null, max: number | null) {
                    if (!min && !max) return null;
                    if (min && max) return `$${(min/1000).toFixed(0)}k–$${(max/1000).toFixed(0)}k`;
                    if (min) return `$${(min/1000).toFixed(0)}k+`;
                    return `up to $${(max!/1000).toFixed(0)}k`;
                  }

                  const isAppliedPair = !!pairedAppliedAt;

                  return (
                    <div
                      className={`rounded-b-xl border-x border-b ${isAppliedPair ? "border-orange-700/40 bg-orange-950/25 text-orange-400" : "border-amber-800/30 bg-amber-950/20 text-amber-400"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Banner row */}
                      <div className="flex items-center gap-2 text-xs px-4 py-1.5">
                        <Copy className="w-3 h-3 shrink-0" />
                        <span className="flex-1 flex items-center gap-1.5 flex-wrap">
                          {isAppliedPair ? (
                            <>
                              Possible duplicate of an applied listing at{" "}
                              <span className="font-semibold">{pairedCompany}</span>
                              <StatusPill appliedAt={pairedAppliedAt} deletedAt={pairedDeletedAt} company={pairedCompany} />
                            </>
                          ) : (
                            <>
                              Possible duplicate of{" "}
                              <span className="font-semibold">{pairedTitle} at {pairedCompany}</span>
                              <StatusPill appliedAt={pairedAppliedAt} deletedAt={pairedDeletedAt} company={pairedCompany} />
                            </>
                          )}
                        </span>
                        <button
                          type="button"
                          aria-expanded={isReviewing}
                          className={`flex items-center gap-0.5 hover:text-white ${isAppliedPair ? "text-orange-400" : "text-amber-400"}`}
                          onClick={() => toggleReviewNearDup(posting.id)}
                          title={isReviewing ? "Hide comparison" : "Review both roles"}
                        >
                          {isReviewing ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span className="font-medium">Review</span>
                        </button>
                        <span className={`select-none ${isAppliedPair ? "text-orange-800/60" : "text-amber-800/60"}`}>·</span>
                        <button
                          type="button"
                          className={`font-medium underline underline-offset-2 ${isAppliedPair ? "text-orange-300 hover:text-orange-100" : "hover:text-amber-200"}`}
                          onClick={() => flagAsDuplicate(posting.id)}
                          disabled={decision.pending}
                        >
                          Flag as duplicate
                        </button>
                        <span className={`select-none ${isAppliedPair ? "text-orange-800/60" : "text-amber-800/60"}`}>·</span>
                        <button
                          type="button"
                          className={`${isAppliedPair ? "text-orange-700 hover:text-orange-500" : "text-amber-600 hover:text-amber-400"}`}
                          onClick={() => dismissNearDup(posting.id)}
                          disabled={savingDistinctPair !== null}
                          aria-busy={savingDistinctPair === [entry.id1, entry.id2].sort((a, b) => a - b).join(":")}
                        >
                          Not a dup
                        </button>
                      </div>

                      {/* Expandable side-by-side comparison */}
                      {isReviewing && (
                        <p className="px-4 pb-2 text-xs text-muted-foreground" data-testid={`duplicate-evidence-${posting.id}`}>
                          <strong>Why this comparison:</strong> {entry.evidence?.join(" · ") ?? "Listing identity needs review."}
                        </p>
                      )}
                      {isReviewing && (
                        <div className="grid grid-cols-2 gap-px mx-4 mb-3 rounded-lg overflow-hidden border border-amber-800/20 text-xs">
                          {/* Self (this card) */}
                          <div className="bg-zinc-900/60 px-3 py-2.5 flex flex-col gap-1">
                            <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-0.5">This posting</p>
                            <p className="font-semibold text-zinc-200 leading-tight">{posting.title}</p>
                            <p className="text-zinc-400">{posting.company}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <StatusPill appliedAt={selfAppliedAt} deletedAt={null} company={posting.company} />
                              {selfScore != null && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${fitTier(selfScore).cls}`}>
                                  {selfScore}% fit
                                </span>
                              )}
                            </div>
                            {selfLocation && <p className="flex items-center gap-0.5 text-zinc-500"><MapPin className="w-2.5 h-2.5" />{selfLocation}</p>}
                            {fmtSalary(selfSalMin, selfSalMax) && <p className="text-sky-400">{fmtSalary(selfSalMin, selfSalMax)}</p>}
                            {posting.createdAt && <p className="text-zinc-600">{formatAdded(posting.createdAt)}</p>}
                            {selfUrl && (
                              <a href={selfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-amber-600 hover:text-amber-400 mt-0.5">
                                <ExternalLink className="w-2.5 h-2.5" /> View posting
                              </a>
                            )}
                          </div>
                          {/* Paired posting */}
                          <div className="bg-zinc-900/40 px-3 py-2.5 flex flex-col gap-1">
                            <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-0.5">Similar posting</p>
                            <p className="font-semibold text-zinc-200 leading-tight">{pairedTitle}</p>
                            <p className="text-zinc-400">{pairedCompany}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <StatusPill appliedAt={pairedAppliedAt} deletedAt={pairedDeletedAt} company={pairedCompany} />
                              {pairedScore != null && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${fitTier(pairedScore).cls}`}>
                                  {pairedScore}% fit
                                </span>
                              )}
                            </div>
                            {pairedLocation && <p className="flex items-center gap-0.5 text-zinc-500"><MapPin className="w-2.5 h-2.5" />{pairedLocation}</p>}
                            {fmtSalary(pairedSalMin, pairedSalMax) && <p className="text-sky-400">{fmtSalary(pairedSalMin, pairedSalMax)}</p>}
                            {pairedCreatedAt && <p className="text-zinc-600">{formatAdded(pairedCreatedAt)}</p>}
                            {pairedUrl && (
                              <a href={pairedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-amber-600 hover:text-amber-400 mt-0.5">
                                <ExternalLink className="w-2.5 h-2.5" /> View posting
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                </div>
              );
            })}
          </div>
        )}
        <JobPagination page={page} totalPages={totalPages} loading={postingsQ.isFetching} onPageChange={setPage} />
      </div>

      <Dialog open={cleanupPreview !== null} onOpenChange={(open) => { if (!open && !sweepingDuplicates) setCleanupPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Review confirmed copies</DialogTitle>
            <DialogDescription>
              These active jobs match a listing you already applied to or archived by individual-job identity.
              Cleanup moves them to Deleted; descriptions and feedback are preserved and jobs can be restored.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 overflow-y-auto space-y-2 text-sm" aria-label="Jobs to move to Deleted">
            {cleanupPreview?.jobs.map((job) => (
              <li key={job.id} className="rounded border border-border px-3 py-2">
                <span className="font-medium text-foreground">{job.title}</span>
                <span className="block text-muted-foreground">{job.company}</span>
              </li>
            ))}
          </ul>
          {(cleanupPreview?.total ?? 0) > (cleanupPreview?.jobs.length ?? 0) && (
            <p className="text-xs text-muted-foreground">Showing the first 200. Review the remaining jobs in another cleanup pass.</p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={sweepingDuplicates} onClick={() => setCleanupPreview(null)}>Cancel</Button>
            <Button disabled={sweepingDuplicates} onClick={confirmSweepDuplicates}>
              {sweepingDuplicates ? "Moving…" : `Move ${cleanupPreview?.ids.length ?? 0} to Deleted`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {appliedPreferenceJob && (
        <AppliedPreferenceDialog
          key={appliedPreferenceJob.id}
          job={appliedPreferenceJob}
          onClose={() => setAppliedPreferenceJob(null)}
        />
      )}
    </Layout>
  );
}
