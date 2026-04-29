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
  useGetImapStatus,
  getGetImapStatusQueryKey,
  useConnectImap,
  useDisconnectImap,
  useSyncImap,
  useGetFilterSettings,
  useUpdateFilterSettings,
  getGetFilterSettingsQueryKey,
  type EmailFilterSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Mail, CheckCircle2, RefreshCw, Unlink, Loader2, Server, Eye, EyeOff,
  SlidersHorizontal, Plus, X,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout";

type Tab = "google" | "imap" | "filters";

export default function InboxPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const search = useSearch();

  const [activeTab, setActiveTab] = useState<Tab>("google");
  const [showPassword, setShowPassword] = useState(false);
  const [imapForm, setImapForm] = useState({
    host: "",
    port: 993,
    username: "",
    password: "",
    tls: true,
  });

  const { data: gmailStatus, isLoading: gmailLoading } = useGetGmailStatus();
  const { data: imapStatus, isLoading: imapLoading } = useGetImapStatus();
  const profileQ = useGetProfile({ query: { queryKey: getGetProfileQueryKey() } });
  const upsertMutation = useUpsertProfile();

  const [syncScheduleHours, setSyncScheduleHours] = useState<number | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  useEffect(() => {
    if (profileQ.data) setSyncScheduleHours(profileQ.data.syncScheduleHours ?? null);
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

  useEffect(() => {
    if (imapStatus?.connected) {
      setImapForm((f) => ({
        ...f,
        host: imapStatus.host,
        port: imapStatus.port,
        username: imapStatus.username,
        tls: imapStatus.tls,
      }));
    }
  }, [imapStatus]);

  const disconnectGmailMutation = useDisconnectGmail({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        toast({ title: "Gmail disconnected", description: "Your Gmail account has been unlinked." });
      },
      onError: () => toast({ title: "Error", description: "Failed to disconnect Gmail.", variant: "destructive" }),
    },
  });

  const syncGmailMutation = useSyncGmail({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        toast({ title: "Inbox synced", description: `Found ${data.synced} new job email${data.synced === 1 ? "" : "s"}.` });
      },
      onError: () => toast({ title: "Sync failed", description: "Could not sync Gmail inbox. Please try again.", variant: "destructive" }),
    },
  });

  const connectImapMutation = useConnectImap({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetImapStatusQueryKey() });
        toast({ title: "IMAP connected", description: "Your email account is now linked. Starting sync…" });
        syncImapMutation.mutate();
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Could not connect. Check your credentials and try again.";
        toast({ title: "Connection failed", description: msg, variant: "destructive" });
      },
    },
  });

  const disconnectImapMutation = useDisconnectImap({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetImapStatusQueryKey() });
        setImapForm({ host: "", port: 993, username: "", password: "", tls: true });
        toast({ title: "IMAP disconnected", description: "Your email account has been unlinked." });
      },
      onError: () => toast({ title: "Error", description: "Failed to disconnect.", variant: "destructive" }),
    },
  });

  const syncImapMutation = useSyncImap({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetImapStatusQueryKey() });
        toast({ title: "Inbox synced", description: `Found ${data.synced} new job email${data.synced === 1 ? "" : "s"}.` });
      },
      onError: () => toast({ title: "Sync failed", description: "Could not sync inbox. Check your IMAP settings.", variant: "destructive" }),
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

  function handleImapConnect() {
    connectImapMutation.mutate({
      host: imapForm.host.trim(),
      port: Number(imapForm.port),
      username: imapForm.username.trim(),
      password: imapForm.password,
      tls: imapForm.tls,
    });
  }

  return (
    <Layout>
      <div className="px-6 py-8 max-w-2xl mx-auto" data-testid="inbox-page">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Email integration</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your inbox so Career Scout can automatically detect job-related emails
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted/40 rounded-xl w-fit mb-6 border border-border">
          <button
            type="button"
            onClick={() => setActiveTab("google")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "google"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mail className="w-4 h-4" />
            Google (Gmail)
            {gmailStatus?.connected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("imap")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "imap"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Server className="w-4 h-4" />
            IMAP / SMTP
            {imapStatus?.connected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("filters")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "filters"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filter Criteria
          </button>
        </div>

        {/* Google (Gmail) tab */}
        {activeTab === "google" && (
          <section className="bg-card border border-border rounded-xl p-6" data-testid="gmail-section">
            <div className="flex items-center gap-2 mb-5">
              <Mail className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-foreground">Google (Gmail)</h2>
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
                    onClick={() => syncGmailMutation.mutate()}
                    disabled={syncGmailMutation.isPending}
                    data-testid="gmail-sync-button"
                  >
                    {syncGmailMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {syncGmailMutation.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => disconnectGmailMutation.mutate()}
                    disabled={disconnectGmailMutation.isPending}
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
                  Connect your Gmail account so Career Scout can automatically detect job-related emails.
                  Uses secure OAuth — Career Scout never sees your Google password.
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
        )}

        {/* Filter Criteria tab */}
        {activeTab === "filters" && <FilterSettingsTab />}

        {/* IMAP tab */}
        {activeTab === "imap" && (
          <section className="bg-card border border-border rounded-xl p-6" data-testid="imap-section">
            <div className="flex items-center gap-2 mb-5">
              <Server className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-foreground">IMAP / SMTP</h2>
            </div>

            {imapLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : imapStatus?.connected ? (
              /* Connected state */
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm text-foreground">
                    Connected as{" "}
                    <span className="font-medium">{imapStatus.username}</span>
                    <span className="text-muted-foreground ml-1">({imapStatus.host}:{imapStatus.port})</span>
                  </span>
                </div>

                {imapStatus.lastSyncedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {new Date(imapStatus.lastSyncedAt).toLocaleString()} &middot;{" "}
                    {imapStatus.postingCount} job email{imapStatus.postingCount === 1 ? "" : "s"} found
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Never synced yet — click Sync now to start.</p>
                )}

                {/* Update credentials */}
                <div className="pt-1 border-t border-border space-y-3">
                  <p className="text-xs text-muted-foreground pt-2">Update credentials</p>
                  <ImapForm
                    form={imapForm}
                    onChange={setImapForm}
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword((v) => !v)}
                    passwordPlaceholder="Leave blank to keep current password"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => syncImapMutation.mutate()}
                    disabled={syncImapMutation.isPending}
                    data-testid="imap-sync-button"
                  >
                    {syncImapMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {syncImapMutation.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleImapConnect}
                    disabled={connectImapMutation.isPending}
                    data-testid="imap-update-button"
                  >
                    {connectImapMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    Update
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => disconnectImapMutation.mutate()}
                    disabled={disconnectImapMutation.isPending}
                    data-testid="imap-disconnect-button"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              /* Not connected state */
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Connect any IMAP-compatible email account — works with Outlook, Yahoo, iCloud, Zoho, Fastmail, and more.
                  Career Scout will scan for job-related emails and add them to your dashboard.
                </p>

                <ImapForm
                  form={imapForm}
                  onChange={setImapForm}
                  showPassword={showPassword}
                  onTogglePassword={() => setShowPassword((v) => !v)}
                />

                <div className="pt-2">
                  <Button
                    size="sm"
                    className="gap-1.5 bg-indigo-600 hover:bg-indigo-500"
                    onClick={handleImapConnect}
                    disabled={connectImapMutation.isPending || !imapForm.host || !imapForm.username || !imapForm.password}
                    data-testid="imap-connect-button"
                  >
                    {connectImapMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Server className="w-3.5 h-3.5" />
                    )}
                    {connectImapMutation.isPending ? "Connecting…" : "Connect & sync"}
                  </Button>
                </div>

                <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Common IMAP settings</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium">Outlook / Hotmail</span><span>imap-mail.outlook.com · 993</span>
                    <span className="font-medium">Yahoo Mail</span><span>imap.mail.yahoo.com · 993</span>
                    <span className="font-medium">iCloud</span><span>imap.mail.me.com · 993</span>
                    <span className="font-medium">Zoho</span><span>imap.zoho.com · 993</span>
                    <span className="font-medium">Fastmail</span><span>imap.fastmail.com · 993</span>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}

function FilterSettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings, isLoading } = useGetFilterSettings();
  const updateMutation = useUpdateFilterSettings({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetFilterSettingsQueryKey(), data);
        toast({ title: "Filter criteria saved", description: "Your email filter settings have been updated." });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save filter settings.", variant: "destructive" });
      },
    },
  });

  const [subjectInput, setSubjectInput] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [bodyInput, setBodyInput] = useState("");

  const [localSettings, setLocalSettings] = useState<EmailFilterSettings>({
    subjectKeywords: [],
    fromAddresses: [],
    bodyKeywords: [],
  });

  useEffect(() => {
    if (settings) setLocalSettings(settings);
  }, [settings]);

  function addItem(field: keyof EmailFilterSettings, value: string, setInput: (v: string) => void) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return;
    if (localSettings[field].includes(trimmed)) return;
    setLocalSettings((prev) => ({ ...prev, [field]: [...prev[field], trimmed] }));
    setInput("");
  }

  function removeItem(field: keyof EmailFilterSettings, item: string) {
    setLocalSettings((prev) => ({ ...prev, [field]: prev[field].filter((v) => v !== item) }));
  }

  function handleSave() {
    updateMutation.mutate(localSettings);
  }

  if (isLoading) {
    return (
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-32 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-6" data-testid="filter-settings-section">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <h2 className="font-semibold text-foreground">Email Filter Criteria</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Control which emails are picked up as job postings. An email matches if it satisfies at least one keyword in <strong className="text-foreground">any</strong> of the groups — the groups are connected by OR.
        </p>
      </div>

      {/* Subject Keywords */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Subject line keywords</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Email subject must contain at least one of these.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {localSettings.subjectKeywords.map((kw) => (
            <span key={kw} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-indigo-950/40 text-indigo-300 border border-indigo-800/30">
              {kw}
              <button type="button" onClick={() => removeItem("subjectKeywords", kw)} className="text-indigo-400 hover:text-indigo-200 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. are hiring"
            value={subjectInput}
            onChange={(e) => setSubjectInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem("subjectKeywords", subjectInput, setSubjectInput)}
            className="h-8 text-sm max-w-xs"
            data-testid="subject-keyword-input"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => addItem("subjectKeywords", subjectInput, setSubjectInput)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* From Addresses */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">From address / domain</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Leave empty to match any sender. Matches substrings (e.g. <code className="text-xs bg-muted px-1 rounded">@greenhouse.io</code>).</p>
        </div>
        {localSettings.fromAddresses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {localSettings.fromAddresses.map((addr) => (
              <span key={addr} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-violet-950/40 text-violet-300 border border-violet-800/30">
                {addr}
                <button type="button" onClick={() => removeItem("fromAddresses", addr)} className="text-violet-400 hover:text-violet-200 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {localSettings.fromAddresses.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">Matching any sender — add addresses to restrict</p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. jobs@linkedin.com or @greenhouse.io"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem("fromAddresses", fromInput, setFromInput)}
            className="h-8 text-sm max-w-xs"
            data-testid="from-address-input"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => addItem("fromAddresses", fromInput, setFromInput)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Body Keywords */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Body text keywords</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Leave empty to skip body filtering. Useful for requiring specific phrases in the email body.</p>
        </div>
        {localSettings.bodyKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {localSettings.bodyKeywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-950/40 text-emerald-300 border border-emerald-800/30">
                {kw}
                <button type="button" onClick={() => removeItem("bodyKeywords", kw)} className="text-emerald-400 hover:text-emerald-200 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {localSettings.bodyKeywords.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">No body filter — add keywords to require them in the email body</p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. apply now"
            value={bodyInput}
            onChange={(e) => setBodyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem("bodyKeywords", bodyInput, setBodyInput)}
            className="h-8 text-sm max-w-xs"
            data-testid="body-keyword-input"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => addItem("bodyKeywords", bodyInput, setBodyInput)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="gap-2 bg-indigo-600 hover:bg-indigo-500"
          data-testid="save-filter-settings"
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save filter criteria
        </Button>
      </div>
    </section>
  );
}

function ImapForm({
  form,
  onChange,
  showPassword,
  onTogglePassword,
  passwordPlaceholder = "App password or email password",
}: {
  form: { host: string; port: number; username: string; password: string; tls: boolean };
  onChange: (f: typeof form) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  passwordPlaceholder?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">IMAP host</Label>
          <Input
            placeholder="imap.example.com"
            value={form.host}
            onChange={(e) => onChange({ ...form, host: e.target.value })}
            data-testid="imap-host"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Port</Label>
          <Input
            type="number"
            value={form.port}
            onChange={(e) => onChange({ ...form, port: Number(e.target.value) })}
            data-testid="imap-port"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Email address / username</Label>
        <Input
          type="email"
          placeholder="you@example.com"
          value={form.username}
          onChange={(e) => onChange({ ...form, username: e.target.value })}
          data-testid="imap-username"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Password</Label>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder={passwordPlaceholder}
            value={form.password}
            onChange={(e) => onChange({ ...form, password: e.target.value })}
            className="pr-10"
            data-testid="imap-password"
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={onTogglePassword}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          For Gmail, use an{" "}
          <a
            href="https://support.google.com/accounts/answer/185833"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:underline"
          >
            App Password
          </a>
          . For Outlook, enable IMAP in settings first.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={form.tls}
          onClick={() => onChange({ ...form, tls: !form.tls })}
          className={`w-9 h-5 rounded-full transition-colors ${form.tls ? "bg-indigo-600" : "bg-muted"} relative`}
          data-testid="imap-tls"
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.tls ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
        <Label className="text-xs cursor-pointer" onClick={() => onChange({ ...form, tls: !form.tls })}>
          Use TLS / SSL (recommended)
        </Label>
      </div>
    </div>
  );
}
