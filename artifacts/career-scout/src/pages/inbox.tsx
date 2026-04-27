import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import {
  useGetGmailStatus,
  getGetGmailStatusQueryKey,
  useDisconnectGmail,
  useSyncGmail,
  useGetProfile,
  getGetProfileQueryKey,
  useUpsertProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Mail, CheckCircle2, RefreshCw, Unlink, Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout";

export default function InboxPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const search = useSearch();

  const { data: gmailStatus, isLoading: gmailLoading } = useGetGmailStatus();
  const profileQ = useGetProfile({ query: { queryKey: getGetProfileQueryKey() } });
  const upsertMutation = useUpsertProfile();

  const [syncScheduleHours, setSyncScheduleHours] = useState<number | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  useEffect(() => {
    if (profileQ.data) {
      setSyncScheduleHours(profileQ.data.syncScheduleHours ?? null);
    }
  }, [profileQ.data]);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const gmail = params.get("gmail");
    if (gmail === "connected") {
      qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
      toast({ title: "Gmail connected", description: "Your Gmail account is now linked to Career Scout." });
    } else if (gmail === "error") {
      toast({ title: "Gmail connection failed", description: "Could not connect your Gmail account. Please try again.", variant: "destructive" });
    }
  }, []);

  const disconnectMutation = useDisconnectGmail({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        toast({ title: "Gmail disconnected", description: "Your Gmail account has been unlinked." });
      },
      onError: () => toast({ title: "Error", description: "Failed to disconnect Gmail.", variant: "destructive" }),
    },
  });

  const syncMutation = useSyncGmail({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        toast({ title: "Inbox synced", description: `Found ${data.synced} new job email${data.synced === 1 ? "" : "s"}.` });
      },
      onError: () => toast({ title: "Sync failed", description: "Could not sync Gmail inbox. Please try again.", variant: "destructive" }),
    },
  });

  async function handleConnectGmail() {
    try {
      const token = await getToken();
      const res = await fetch("/api/gmail/auth-url", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to get auth URL");
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch {
      toast({ title: "Error", description: "Could not start Gmail connection. Try again.", variant: "destructive" });
    }
  }

  async function saveSyncSchedule(hours: number | null) {
    setSyncScheduleHours(hours);
    setIsSavingSchedule(true);
    try {
      await upsertMutation.mutateAsync(
        { data: { syncScheduleHours: hours ?? undefined } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetProfileQueryKey() });
            toast({
              title: "Sync schedule saved",
              description: hours
                ? `Gmail will sync automatically every ${hours} hour${hours === 1 ? "" : "s"}.`
                : "Automatic sync disabled — use manual sync.",
            });
          },
          onError: () =>
            toast({ title: "Error", description: "Failed to save sync schedule.", variant: "destructive" }),
        }
      );
    } finally {
      setIsSavingSchedule(false);
    }
  }

  return (
    <Layout>
      <div className="px-6 py-8 max-w-2xl mx-auto" data-testid="inbox-page">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Gmail</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your inbox so Career Scout can automatically detect job-related emails
          </p>
        </div>

        <section className="bg-card border border-border rounded-xl p-6" data-testid="gmail-section">
          <div className="flex items-center gap-2 mb-5">
            <Mail className="w-4 h-4 text-indigo-400" />
            <h2 className="font-semibold text-foreground">Gmail integration</h2>
          </div>

          {gmailLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : gmailStatus?.connected ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm text-foreground">
                  Connected as{" "}
                  <span className="font-medium">{gmailStatus.email ?? "your Gmail account"}</span>
                </span>
              </div>

              {gmailStatus.lastSyncedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last synced: {new Date(gmailStatus.lastSyncedAt).toLocaleString()} &middot;{" "}
                  {gmailStatus.postingCount} job email{gmailStatus.postingCount === 1 ? "" : "s"} found
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Never synced yet — click Sync now to start.
                </p>
              )}

              {/* Auto-sync schedule */}
              <div className="space-y-2 pt-1 border-t border-border">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5 pt-3">
                  <RefreshCw className="w-3 h-3" />
                  Auto-sync schedule
                  {isSavingSchedule && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
                </Label>
                <Select
                  value={syncScheduleHours === null ? "manual" : String(syncScheduleHours)}
                  onValueChange={(v) => saveSyncSchedule(v === "manual" ? null : Number(v))}
                  disabled={isSavingSchedule}
                  data-testid="sync-schedule-select"
                >
                  <SelectTrigger className="w-52 h-8 text-xs" data-testid="sync-schedule-trigger">
                    <SelectValue placeholder="Choose frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual only</SelectItem>
                    <SelectItem value="1">Every 1 hour</SelectItem>
                    <SelectItem value="6">Every 6 hours</SelectItem>
                    <SelectItem value="12">Every 12 hours</SelectItem>
                    <SelectItem value="24">Every 24 hours</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {syncScheduleHours
                    ? `Career Scout checks your inbox every ${syncScheduleHours} hour${syncScheduleHours === 1 ? "" : "s"} automatically.`
                    : 'Sync only runs when you click "Sync now".'}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  data-testid="gmail-sync-button"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {syncMutation.isPending ? "Syncing…" : "Sync now"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  data-testid="gmail-disconnect-button"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your Gmail account so Career Scout can automatically detect job-related emails in your inbox.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                data-testid="gmail-connect-button"
                onClick={handleConnectGmail}
              >
                <Mail className="w-3.5 h-3.5" />
                Connect Gmail
              </Button>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
