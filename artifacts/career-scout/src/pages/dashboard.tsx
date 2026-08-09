import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import {
  Plus, Search, SlidersHorizontal, Mail, TrendingUp,
  BriefcaseBusiness, Star, Trash2, X,
  RefreshCw, Unplug, ArrowUpDown, Sparkles, Link2, CheckCircle2, Undo2, MapPin, Ban, RotateCcw, Layers, Copy, Archive,
  ChevronDown, ChevronUp, ExternalLink, SearchCode, Download, Upload,
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
  useGetCompanyFilterSettings,
  useUpdateCompanyFilterSettings,
  useGetTitleExcludeSettings,
  useUpdateTitleExcludeSettings,
  getGetTitleExcludeSettingsQueryKey,
  useListDeletedPostings,
  useRestorePosting,
  useClosePosting,
  useReopenPosting,
  getListPostingsQueryKey,
  getListDeletedPostingsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetGmailStatusQueryKey,
  getGetCompanyFilterSettingsQueryKey,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import Layout from "@/components/layout";

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground animate-pulse"
        data-testid="score-ring-pending"
        title="AI scoring in progress"
      >
        AI
      </span>
    );
  }
  const cls =
    score >= 80
      ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
      : score >= 60
      ? "bg-amber-950/60 text-amber-400 border border-amber-800/40"
      : "bg-red-950/60 text-red-400 border border-red-800/40";
  return (
    <span
      className={`inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded tabular-nums ${cls}`}
      data-testid="score-ring"
    >
      {score}
    </span>
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

let _dedupSweepInFlight = false;

export default function DashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const [search, setSearch] = useState("");
  const [minFitScore, setMinFitScore] = useState<number | undefined>(undefined);
  const [showAddModal, setShowAddModal] = useState(false);

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
  const [sweepingDuplicates, setSweepingDuplicates] = useState(false);
  const [retryingLinks, setRetryingLinks] = useState<Set<number>>(new Set());
  const [exportingCsv, setExportingCsv] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"active" | "applied" | "deleted">("active");
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
  };
  const [nearDupMap, setNearDupMap] = useState<Map<number, NearDupPair & { isId1: boolean }>>(new Map());
  const [dismissedNearDups, setDismissedNearDups] = useState<Set<number>>(new Set());
  const [reviewingNearDups, setReviewingNearDups] = useState<Set<number>>(new Set());
  const [autoSweepCount, setAutoSweepCount] = useState<number | null>(null);

  useEffect(() => {
    const SESSION_KEY = "dedup-sweep-done";
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (_dedupSweepInFlight) return;
    _dedupSweepInFlight = true;
    getToken().then((token) => {
      return fetch("/api/postings/dedup-sweep", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }).then(async (res) => {
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, "1");
        const { removed } = await res.json() as { removed: number };
        if (removed > 0) setAutoSweepCount(removed);
        qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
        qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      } else {
        _dedupSweepInFlight = false;
        console.warn("[dedup-sweep] sweep request failed with status", res.status);
      }
    }).catch((err) => {
      _dedupSweepInFlight = false;
      console.warn("[dedup-sweep] sweep request error", err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flagAsDuplicate(postingId: number) {
    const token = await getToken();
    const res = await fetch(`/api/postings/${postingId}/flag-duplicate`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      toast({ title: "Couldn't remove posting", description: `Server returned ${res.status}. Try refreshing the page.`, variant: "destructive" });
      return;
    }
    setNearDupMap((prev) => {
      const next = new Map(prev);
      const entry = next.get(postingId);
      const pairedId = entry ? (entry.isId1 ? entry.id2 : entry.id1) : undefined;
      next.delete(postingId);
      if (pairedId !== undefined) next.delete(pairedId);
      return next;
    });
    qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
    qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  function dismissNearDup(postingId: number) {
    const entry = nearDupMap.get(postingId);
    const pairedId = entry ? (entry.isId1 ? entry.id2 : entry.id1) : undefined;
    setDismissedNearDups((prev) => {
      const next = new Set(prev);
      next.add(postingId);
      if (pairedId !== undefined) next.add(pairedId);
      return next;
    });
    setReviewingNearDups((prev) => {
      const next = new Set(prev);
      next.delete(postingId);
      if (pairedId !== undefined) next.delete(pairedId);
      return next;
    });
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
  const postingsQ = useListPostings(
    {
      search: search || undefined,
      minFitScore,
      applied: activeTab === "applied" ? true : activeTab === "active" ? false : undefined,
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: {
        refetchInterval: (query: any) => {
          const data = query.state.data;
          if (!data) return false;
          const hasUnscored = data.some((p: any) => p.report?.fitScore == null);
          return hasUnscored ? 4000 : false;
        },
      } as any,
    },
  );
  const activeCountQ = useListPostings({ applied: false });
  const appliedCountQ = useListPostings({ applied: true });
  const deletedQ = useListDeletedPostings();
  const gmailStatusQ = useGetGmailStatus();
  const createMutation = useCreatePosting();
  const deleteMutation = useDeletePosting();
  const markAppliedMutation = useMarkApplied();
  const restoreMutation = useRestorePosting();
  const closeMutation = useClosePosting();
  const reopenMutation = useReopenPosting();
  const syncMutation = useSyncGmail();
  const disconnectMutation = useDisconnectGmail();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreatePostingBody>({
    defaultValues: { title: "", company: "", fullDescription: "", source: "manual" },
  });

  const summary = dashboardQ.data;
  const rawPostings = postingsQ.data ?? [];
  const gmailStatus = gmailStatusQ.data;

  const tabStats = useMemo(() => {
    const items: Array<{ report?: { fitScore?: number | null } | null }> =
      activeTab === "deleted"
        ? (deletedQ.data ?? [])
        : (postingsQ.data ?? []);
    const total = items.length;
    const scored = items.filter((item) => item.report?.fitScore != null);
    const avgFit =
      scored.length > 0
        ? scored.reduce((s, item) => s + (item.report!.fitScore ?? 0), 0) / scored.length
        : null;
    const strong = scored.filter((item) => (item.report?.fitScore ?? 0) >= 85).length;
    return { total, avgFit, strong };
  }, [activeTab, postingsQ.data, deletedQ.data]);

  const allPostingsById = useMemo(() => {
    const map = new Map<number, { posting: { id: number; title: string; company: string }; report: { fitScore?: number | null } | null }>();
    for (const item of (activeCountQ.data ?? [])) map.set(item.posting.id, item);
    for (const item of (appliedCountQ.data ?? [])) map.set(item.posting.id, item);
    return map;
  }, [activeCountQ.data, appliedCountQ.data]);

  useEffect(() => {
    if (rawPostings.length < 2) return;
    getToken().then((token) => {
      return fetch("/api/postings/near-duplicates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }).then((r) => r.ok ? r.json() : [])
      .then((pairs: NearDupPair[]) => {
        const map = new Map<number, NearDupPair & { isId1: boolean }>();
        for (const pair of pairs) {
          map.set(pair.id1, { ...pair, isId1: true });
          map.set(pair.id2, { ...pair, isId1: false });
        }
        setNearDupMap(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPostings]);

  const postings = useMemo(() => {
    let items = [...rawPostings];
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
          getToken().then((token) => {
            fetch("/api/postings/dedup-sweep", {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
              .then((res) => {
                if (res.ok) {
                  qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
                  qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
                  qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                }
              })
              .catch(() => {});
          }).catch(() => {});
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

  async function onSweepDuplicates() {
    setSweepingDuplicates(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/postings/dedup-sweep", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Sweep failed");
      const { removed } = await res.json() as { removed: number };
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
          toast({ title: "Restored", description: "Job posting moved back to Active." });
        },
        onError: () => toast({ title: "Error", description: "Failed to restore posting.", variant: "destructive" }),
      }
    );
  }

  async function onClose(id: number) {
    await closeMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getListDeletedPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Marked as closed", description: "Job posting archived. It can re-import if the role reopens." });
        },
        onError: () => toast({ title: "Error", description: "Failed to archive posting.", variant: "destructive" }),
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

  async function onToggleApplied(id: number, isCurrentlyApplied: boolean) {
    await markAppliedMutation.mutateAsync(
      { id },
      {
        onSuccess: (_result) => {
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
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
            {/* Utility buttons — icon-only on small screens, full label on sm+ */}
            <Button
              variant="outline"
              size="sm"
              onClick={onSweepDuplicates}
              disabled={sweepingDuplicates}
              className="gap-2 text-muted-foreground"
              data-testid="dedup-sweep-button"
              title="Find and remove active jobs that match ones you already deleted or applied to"
            >
              {sweepingDuplicates ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{sweepingDuplicates ? "Scanning..." : "Clean up"}</span>
            </Button>
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
              <span className="hidden sm:inline">{backfillingLinks ? "Finding..." : "Find links"}</span>
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
              <span className="hidden sm:inline">{reanalyzing ? "Analyzing..." : "Re-analyze"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExportCsv}
              disabled={exportingCsv}
              className="gap-2 text-muted-foreground"
              data-testid="export-csv-button"
              title="Download all your active job postings as a CSV file"
            >
              {exportingCsv ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{exportingCsv ? "Exporting..." : "Export CSV"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importFileRef.current?.click()}
              disabled={importingCsv}
              className="gap-2 text-muted-foreground"
              data-testid="import-csv-button"
              title="Import jobs from a CSV file"
            >
              {importingCsv ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{importingCsv ? "Importing..." : "Import CSV"}</span>
            </Button>
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
              className="bg-indigo-600 hover:bg-indigo-500 gap-2"
              data-testid="add-job-button"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add job</span>
            </Button>
          </div>
        </div>

        {/* Gmail banner */}
        {gmailStatus?.connected ? (
          <div className="flex flex-col bg-emerald-950/30 border border-emerald-800/30 rounded-xl px-5 pt-4 pb-3 mb-6 gap-3" data-testid="gmail-connected-banner">
            {/* Title row */}
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-300">Gmail connected</p>
                {gmailStatus.email && (
                  <p className="text-xs text-emerald-400/70 break-all mt-0.5">{gmailStatus.email}</p>
                )}
              </div>
            </div>
            {/* Actions + status */}
            <div className="flex flex-col gap-1.5 border-t border-emerald-800/20 pt-2.5">
              <div className="flex items-center gap-2">
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
              <p className="text-xs text-emerald-400/60">
                {gmailStatus.lastSyncedAt
                  ? `Last synced ${new Date(gmailStatus.lastSyncedAt).toLocaleString()}`
                  : "Not yet synced — click Sync to import job emails"}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl px-5 py-3.5 mb-6" data-testid="gmail-connect-banner">
            <Mail className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-300">Connect Gmail to auto-import jobs</p>
              <p className="text-xs text-indigo-400/70 mt-0.5">Automatically import job emails and score them against your profile</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-indigo-400 border-indigo-700 hover:bg-indigo-950/50 gap-1.5"
              data-testid="gmail-connect-button"
              onClick={handleConnectGmail}
            >
              <Mail className="w-3.5 h-3.5" />
              Connect Gmail
            </Button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={BriefcaseBusiness}
            label={activeTab === "active" ? "Active postings" : activeTab === "applied" ? "Applied postings" : "Deleted postings"}
            value={tabStats.total}
            loading={activeTab === "deleted" ? deletedQ.isLoading : postingsQ.isLoading}
          />
          <StatCard
            icon={TrendingUp}
            label="Avg fit score"
            value={tabStats.avgFit != null ? `${Math.round(tabStats.avgFit)}` : "—"}
            loading={activeTab === "deleted" ? deletedQ.isLoading : postingsQ.isLoading}
          />
          <StatCard
            icon={Star}
            label="Strong matches (85+)"
            value={tabStats.strong}
            loading={activeTab === "deleted" ? deletedQ.isLoading : postingsQ.isLoading}
          />
        </div>

        {/* Auto-sweep banner */}
        {autoSweepCount != null && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-amber-950/40 border border-amber-800/50 rounded-lg text-sm text-amber-300">
            <Layers className="w-4 h-4 shrink-0" />
            <span className="flex-1">
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

        {/* View tabs + Filters — single row */}
        <div className="flex items-center border-b border-border mb-5">
          {/* Filters on left — icon-only on mobile */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
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
            onClick={() => setActiveTab("active")}
            data-testid="tab-active"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "active"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
            {activeCountQ.data != null && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "active" ? "bg-indigo-500/20 text-indigo-300" : "bg-muted text-muted-foreground"
              }`}>
                {activeCountQ.data.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("applied")}
            data-testid="tab-applied"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "applied"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Applied
            {appliedCountQ.data != null && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "applied" ? "bg-indigo-500/20 text-indigo-300" : "bg-muted text-muted-foreground"
              }`}>
                {appliedCountQ.data.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("deleted")}
            data-testid="tab-deleted"
            className={`px-2 sm:px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 shrink-0 ${
              activeTab === "deleted"
                ? "border-red-500 text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Deleted
            {deletedQ.data != null && deletedQ.data.length > 0 && (
              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${
                activeTab === "deleted" ? "bg-red-500/20 text-red-300" : "bg-muted text-muted-foreground"
              }`}>
                {deletedQ.data.length}
              </span>
            )}
          </button>
        </div>

        {/* Filters panel */}
        <>

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
                        <ScoreBadge score={score} />
                        <span className="font-semibold text-foreground line-through">{posting.title}</span>
                        <Badge variant="secondary" className="text-xs">{posting.senderName ?? posting.source}</Badge>
                        {posting.deletedBy === "sweep" && (
                          <Badge variant="outline" className="text-xs text-amber-400 border-amber-800/50 gap-1">
                            <Layers className="w-3 h-3" />
                            Removed automatically
                          </Badge>
                        )}
                        {isClosed && (
                          <Badge variant="outline" className="text-xs text-orange-400 border-orange-800/50 gap-1">
                            <Archive className="w-3 h-3" />
                            Closed
                          </Badge>
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
                        <span className="text-xs text-muted-foreground/60">
                          Added {formatAdded(posting.createdAt)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isClosed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-sky-400 border-sky-800/50 hover:bg-sky-950/30 hover:text-sky-300"
                          onClick={() => onReopen(posting.id)}
                          disabled={reopenMutation.isPending}
                          data-testid={`posting-reopen-${posting.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reopen
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-sky-400 border-sky-800/50 hover:bg-sky-950/30 hover:text-sky-300"
                          onClick={() => onRestore(posting.id)}
                          disabled={restoreMutation.isPending}
                          data-testid={`posting-restore-${posting.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restore
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
                <div key={posting.id} className="flex flex-col">
                <div
                  className={`flex flex-col sm:flex-row sm:items-center gap-0 bg-card border border-border rounded-xl overflow-hidden transition-colors ${posting.link ? "hover:border-indigo-800/50 cursor-pointer" : "cursor-default"}`}
                  data-testid={`posting-card-${posting.id}`}
                  onClick={() => { if (posting.link) window.open(posting.link, "_blank", "noopener,noreferrer"); }}
                >
                  {/* Info row — text content */}
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 px-4 pt-3 pb-2 sm:px-5 sm:py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScoreBadge score={score} />
                        <span
                          className="font-semibold text-foreground"
                          data-testid={`posting-title-${posting.id}`}
                        >
                          {posting.title}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {posting.senderName ?? posting.source}
                        </Badge>
                        {posting.appliedAt && (
                          <span className="flex items-center gap-1 text-xs text-sky-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Applied
                          </span>
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
                        <span className="text-xs text-muted-foreground/60">
                          {formatAdded(posting.createdAt)}
                        </span>
                      </p>
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
                    {!posting.link && posting.source === "gmail" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-indigo-400 hover:bg-indigo-950/20"
                        onClick={() => onRetryLink(posting.id)}
                        disabled={retryingLinks.has(posting.id)}
                        title="Find link from original email"
                        data-testid={`posting-retry-link-${posting.id}`}
                      >
                        {retryingLinks.has(posting.id) ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <SearchCode className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onToggleApplied(posting.id, !!posting.appliedAt)}
                      disabled={markAppliedMutation.isPending}
                      data-testid={`posting-apply-${posting.id}`}
                      title={posting.appliedAt ? "Undo applied" : "Mark as applied"}
                      className={`w-9 h-9 sm:w-8 sm:h-8 ${posting.appliedAt ? "text-sky-400 hover:text-sky-300" : "text-muted-foreground hover:text-sky-400"}`}
                    >
                      {posting.appliedAt ? <Undo2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-amber-400 hover:bg-amber-950/20"
                      onClick={() => flagAsDuplicate(posting.id)}
                      title="Flag as duplicate"
                      data-testid={`posting-flag-dupe-${posting.id}`}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-red-400 hover:bg-red-950/20"
                      onClick={() => blockCompany(posting.company)}
                      disabled={updateCompanyFilterMutation.isPending}
                      title={`Block all jobs from ${posting.company}`}
                      data-testid={`posting-block-company-${posting.id}`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-9 h-9 sm:w-8 sm:h-8 text-muted-foreground hover:text-orange-400 hover:bg-orange-950/20"
                      onClick={() => onClose(posting.id)}
                      disabled={closeMutation.isPending}
                      title="Mark as closed"
                      data-testid={`posting-close-${posting.id}`}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-9 h-9 sm:w-8 sm:h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDelete(posting.id)}
                      data-testid={`posting-delete-${posting.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {nearDupMap.has(posting.id) && !dismissedNearDups.has(posting.id) && (() => {
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
                              Already applied to a similar role at{" "}
                              <span className="font-semibold">{pairedCompany}</span>
                              <StatusPill appliedAt={pairedAppliedAt} deletedAt={pairedDeletedAt} company={pairedCompany} />
                            </>
                          ) : (
                            <>
                              Looks like a duplicate of{" "}
                              <span className="font-semibold">{pairedTitle} at {pairedCompany}</span>
                              <StatusPill appliedAt={pairedAppliedAt} deletedAt={pairedDeletedAt} company={pairedCompany} />
                            </>
                          )}
                        </span>
                        <button
                          className={`flex items-center gap-0.5 hover:text-white ${isAppliedPair ? "text-orange-400" : "text-amber-400"}`}
                          onClick={() => toggleReviewNearDup(posting.id)}
                          title={isReviewing ? "Hide comparison" : "Review both roles"}
                        >
                          {isReviewing ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span className="font-medium">Review</span>
                        </button>
                        <span className={`select-none ${isAppliedPair ? "text-orange-800/60" : "text-amber-800/60"}`}>·</span>
                        <button
                          className={`font-medium underline underline-offset-2 ${isAppliedPair ? "text-orange-300 hover:text-orange-100" : "hover:text-amber-200"}`}
                          onClick={() => flagAsDuplicate(posting.id)}
                        >
                          Remove this
                        </button>
                        <span className={`select-none ${isAppliedPair ? "text-orange-800/60" : "text-amber-800/60"}`}>·</span>
                        <button
                          className={`${isAppliedPair ? "text-orange-700 hover:text-orange-500" : "text-amber-600 hover:text-amber-400"}`}
                          onClick={() => dismissNearDup(posting.id)}
                        >
                          Not a dup
                        </button>
                      </div>

                      {/* Expandable side-by-side comparison */}
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
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${selfScore >= 80 ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/40" : selfScore >= 60 ? "bg-amber-950/50 text-amber-400 border-amber-800/40" : "bg-red-950/50 text-red-400 border-red-800/40"}`}>
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
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${pairedScore >= 80 ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/40" : pairedScore >= 60 ? "bg-amber-950/50 text-amber-400 border-amber-800/40" : "bg-red-950/50 text-red-400 border-red-800/40"}`}>
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

    </Layout>
  );
}
