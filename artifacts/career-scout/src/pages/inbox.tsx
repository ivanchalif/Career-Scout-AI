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
  useGetCompanyFilterSettings,
  useUpdateCompanyFilterSettings,
  getGetCompanyFilterSettingsQueryKey,
  useGetTitleExcludeSettings,
  useUpdateTitleExcludeSettings,
  getGetTitleExcludeSettingsQueryKey,
  useGetFilterStats,
  type EmailFilterSettings,
  type CompanyFilterSettings,
  type TitleExcludeSettings,
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
      // If we're in an OAuth popup, notify the opener and close
      if (window.opener) {
        window.opener.postMessage({ type: "gmail_connected" }, "*");
        window.close();
        return;
      }
      qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
      toast({ title: "Gmail connected", description: "Your Gmail account is now linked to Career Scout." });
    } else if (gmail === "error") {
      if (window.opener) {
        window.opener.postMessage({ type: "gmail_error" }, "*");
        window.close();
        return;
      }
      toast({ title: "Gmail connection failed", description: "Could not connect your Gmail account. Please try again.", variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    if (imapStatus?.connected) {
      setImapForm((f) => ({
        ...f,
        host: imapStatus.host ?? f.host,
        port: imapStatus.port ?? f.port,
        username: imapStatus.username ?? f.username,
        tls: imapStatus.tls ?? f.tls,
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
      onError: (err) => {
        const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        if (code === "gmail_token_expired") {
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          toast({
            title: "Gmail reconnection required",
            description: "Your Gmail authorization has expired. Please reconnect your account.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Sync failed", description: "Could not sync Gmail inbox. Please try again.", variant: "destructive" });
        }
      },
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

      // Open Google OAuth in a popup to avoid X-Frame-Options issues
      // when the app itself is running inside an iframe (Replit preview pane).
      const popup = window.open(url, "gmail_oauth", "width=520,height=640,left=200,top=100");

      if (!popup) {
        // Popup blocked — fall back to same-window navigation
        window.location.href = url;
        return;
      }

      // Listen for the postMessage sent by the callback page when it loads
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

      // Also poll in case popup closes without sending a message (user cancelled)
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          // Refresh status in case auth completed but message was missed
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
                ? `Gmail will sync automatically ${hours === 0.5 ? "every 30 minutes" : `every ${hours} hour${hours === 1 ? "" : "s"}`}.`
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
      data: {
        host: imapForm.host.trim(),
        port: Number(imapForm.port),
        username: imapForm.username.trim(),
        password: imapForm.password,
        tls: imapForm.tls,
      },
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
                      <SelectItem value="0.5">Every 30 minutes</SelectItem>
                      <SelectItem value="1">Every 1 hour</SelectItem>
                      <SelectItem value="6">Every 6 hours</SelectItem>
                      <SelectItem value="12">Every 12 hours</SelectItem>
                      <SelectItem value="24">Every 24 hours</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {syncScheduleHours
                      ? `Career Scout checks your inbox ${syncScheduleHours === 0.5 ? "every 30 minutes" : `every ${syncScheduleHours} hour${syncScheduleHours === 1 ? "" : "s"}`} automatically.`
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
  const { data: companyFilter, isLoading: companyFilterLoading } = useGetCompanyFilterSettings();
  const { data: titleExcludeData, isLoading: titleExcludeLoading } = useGetTitleExcludeSettings();

  const updateMutation = useUpdateFilterSettings({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetFilterSettingsQueryKey(), data);
        toast({ title: "Email filter criteria saved", description: "Your email filter settings have been updated." });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save filter settings.", variant: "destructive" });
      },
    },
  });

  const updateCompanyMutation = useUpdateCompanyFilterSettings({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetCompanyFilterSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: ["/api/postings"] });
        toast({ title: "Company filter saved", description: "Your company filter has been updated." });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save company filter.", variant: "destructive" });
      },
    },
  });

  const updateTitleExcludeMutation = useUpdateTitleExcludeSettings({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetTitleExcludeSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: ["/api/postings"] });
        toast({ title: "Title filter saved", description: "Jobs with blocked title keywords will be hidden from the dashboard." });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save title filter.", variant: "destructive" });
      },
    },
  });

  const [subjectInput, setSubjectInput] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [bodyInput, setBodyInput] = useState("");
  const [blockedBodyInput, setBlockedBodyInput] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const [titleExcludeInput, setTitleExcludeInput] = useState("");

  const [localSettings, setLocalSettings] = useState<EmailFilterSettings>({
    subjectKeywords: [],
    fromAddresses: [],
    bodyKeywords: [],
    blockedBodyKeywords: [],
  });

  const [localCompanySettings, setLocalCompanySettings] = useState<CompanyFilterSettings>({
    mode: "off",
    companies: [],
  });

  const [localTitleExclude, setLocalTitleExclude] = useState<TitleExcludeSettings>({ keywords: [] });

  useEffect(() => {
    if (settings) setLocalSettings({ ...{ blockedBodyKeywords: [] }, ...settings });
  }, [settings]);

  useEffect(() => {
    if (companyFilter) setLocalCompanySettings(companyFilter);
  }, [companyFilter]);

  useEffect(() => {
    if (titleExcludeData) setLocalTitleExclude(titleExcludeData);
  }, [titleExcludeData]);

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

  function addCompany(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (localCompanySettings.companies.map((c) => c.toLowerCase()).includes(trimmed.toLowerCase())) return;
    setLocalCompanySettings((prev) => ({ ...prev, companies: [...prev.companies, trimmed] }));
    setCompanyInput("");
  }

  function removeCompany(company: string) {
    setLocalCompanySettings((prev) => ({ ...prev, companies: prev.companies.filter((c) => c !== company) }));
  }

  function handleSave() {
    updateMutation.mutate({ data: localSettings });
  }

  function handleSaveCompanyFilter() {
    updateCompanyMutation.mutate({ data: localCompanySettings });
  }

  function addTitleExcludeKeyword(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (localTitleExclude.keywords.map((k) => k.toLowerCase()).includes(trimmed.toLowerCase())) return;
    setLocalTitleExclude((prev) => ({ keywords: [...prev.keywords, trimmed] }));
    setTitleExcludeInput("");
  }

  function removeTitleExcludeKeyword(kw: string) {
    setLocalTitleExclude((prev) => ({ keywords: prev.keywords.filter((k) => k !== kw) }));
  }

  function handleSaveTitleExclude() {
    updateTitleExcludeMutation.mutate({ data: localTitleExclude });
  }

  if (isLoading || companyFilterLoading || titleExcludeLoading) {
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

      {/* Blocked Body Keywords */}
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Blocked body keywords</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Job listings whose description contains any of these are <strong className="text-foreground">skipped</strong>. Other jobs in the same email are still imported.</p>
        </div>
        {localSettings.blockedBodyKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {localSettings.blockedBodyKeywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-950/40 text-red-300 border border-red-800/30">
                {kw}
                <button type="button" onClick={() => removeItem("blockedBodyKeywords", kw)} className="text-red-400 hover:text-red-200 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {localSettings.blockedBodyKeywords.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">No blocked keywords — individual job listings matching these are skipped</p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. unsubscribe"
            value={blockedBodyInput}
            onChange={(e) => setBlockedBodyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem("blockedBodyKeywords", blockedBodyInput, setBlockedBodyInput)}
            className="h-8 text-sm max-w-xs"
            data-testid="blocked-body-keyword-input"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => addItem("blockedBodyKeywords", blockedBodyInput, setBlockedBodyInput)}>
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
          Save email filter criteria
        </Button>
      </div>

      {/* Company Filter */}
      <div className="pt-4 border-t-2 border-border space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-foreground">Company Filter</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Control which companies appear on your dashboard. Affects all job postings immediately.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Filter mode</Label>
          <div className="flex gap-2">
            {(["off", "include", "exclude"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLocalCompanySettings((prev) => ({ ...prev, mode }))}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  localCompanySettings.mode === mode
                    ? mode === "exclude"
                      ? "bg-red-950/50 border-red-700 text-red-300"
                      : mode === "include"
                      ? "bg-emerald-950/50 border-emerald-700 text-emerald-300"
                      : "bg-muted border-border text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
                data-testid={`company-filter-mode-${mode}`}
              >
                {mode === "off" ? "Off" : mode === "include" ? "Include only" : "Exclude"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70">
            {localCompanySettings.mode === "off" && "No company filter — all companies visible."}
            {localCompanySettings.mode === "include" && "Only show jobs from companies in the list below."}
            {localCompanySettings.mode === "exclude" && "Hide jobs from companies in the list below."}
          </p>
        </div>

        {localCompanySettings.mode !== "off" && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {localCompanySettings.mode === "include" ? "Allowed companies" : "Blocked companies"}
            </Label>
            {localCompanySettings.companies.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {localCompanySettings.companies.map((company) => (
                  <span
                    key={company}
                    className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                      localCompanySettings.mode === "include"
                        ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/30"
                        : "bg-red-950/40 text-red-300 border-red-800/30"
                    }`}
                  >
                    {company}
                    <button
                      type="button"
                      onClick={() => removeCompany(company)}
                      className={`ml-0.5 ${localCompanySettings.mode === "include" ? "text-emerald-400 hover:text-emerald-200" : "text-red-400 hover:text-red-200"}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {localCompanySettings.companies.length === 0 && (
              <p className="text-xs text-muted-foreground/60 italic">
                {localCompanySettings.mode === "include" ? "No companies added — add companies to show only their jobs" : "No companies blocked — add companies to hide their jobs"}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Acme Corp"
                value={companyInput}
                onChange={(e) => setCompanyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCompany(companyInput)}
                className="h-8 text-sm max-w-xs"
                data-testid="company-filter-input"
              />
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => addCompany(companyInput)}>
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
          </div>
        )}

        <div>
          <Button
            onClick={handleSaveCompanyFilter}
            disabled={updateCompanyMutation.isPending}
            className="gap-2 bg-amber-700 hover:bg-amber-600"
            data-testid="save-company-filter"
          >
            {updateCompanyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save company filter
          </Button>
        </div>
      </div>

      {/* Title Keyword Filter */}
      <div className="pt-4 border-t-2 border-border space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SlidersHorizontal className="w-4 h-4 text-rose-400" />
            <h2 className="font-semibold text-foreground">Title Keyword Filter</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Jobs whose title contains any of these keywords will be permanently hidden from your dashboard.
          </p>
        </div>

        <div className="space-y-3">
          {localTitleExclude.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {localTitleExclude.keywords.map((kw) => (
                <span
                  key={kw}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-red-950/40 text-red-300 border-red-800/30"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeTitleExcludeKeyword(kw)}
                    className="ml-0.5 text-red-400 hover:text-red-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {localTitleExclude.keywords.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">
              No keywords blocked — add keywords to hide matching job titles
            </p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Engineering Manager"
              value={titleExcludeInput}
              onChange={(e) => setTitleExcludeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTitleExcludeKeyword(titleExcludeInput)}
              className="h-8 text-sm max-w-xs"
              data-testid="title-exclude-input"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              onClick={() => addTitleExcludeKeyword(titleExcludeInput)}
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>
        </div>

        <div>
          <Button
            onClick={handleSaveTitleExclude}
            disabled={updateTitleExcludeMutation.isPending}
            className="gap-2 bg-rose-800 hover:bg-rose-700"
            data-testid="save-title-exclude"
          >
            {updateTitleExcludeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save title filter
          </Button>
        </div>
      </div>

      <FilterEffectivenessPanel />
    </section>
  );
}

function FilterEffectivenessPanel() {
  const { data, isLoading } = useGetFilterStats();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="pt-4 border-t-2 border-border space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <h2 className="font-semibold text-foreground">Filter Effectiveness</h2>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        How many jobs your current filters surface vs. suppress.
      </p>

      {data && (
        <div className="space-y-5">
          {/* Dashboard visibility breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label="Active emails"
              value={data.profileFilters.rawActive}
              sub="before filters"
              color="text-foreground"
            />
            <StatTile
              label="Shown on dashboard"
              value={data.profileFilters.shownOnDashboard}
              sub="after all filters"
              color="text-emerald-400"
            />
            <StatTile
              label="Hidden by company"
              value={data.profileFilters.hiddenByCompany}
              sub={
                data.profileFilters.companyFilterMode === "off"
                  ? "filter off"
                  : `${data.profileFilters.companyFilterMode} list · ${data.profileFilters.companyFilterCount} co.`
              }
              color="text-amber-400"
            />
            <StatTile
              label="Hidden by title kw"
              value={data.profileFilters.hiddenByTitleKeywords}
              sub={`${data.profileFilters.titleKeywordCount} keyword${data.profileFilters.titleKeywordCount === 1 ? "" : "s"}`}
              color="text-rose-400"
            />
          </div>

          {/* Visibility bar */}
          {data.profileFilters.rawActive > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Visibility</span>
                <span>{Math.round((data.profileFilters.shownOnDashboard / data.profileFilters.rawActive) * 100)}% shown</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${(data.profileFilters.shownOnDashboard / data.profileFilters.rawActive) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Sync totals */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sync history ({data.totalSyncs} syncs)</p>
              {data.syncHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="text-xs text-indigo-400 hover:underline"
                >
                  {showHistory ? "Hide log" : "Show log"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Emails fetched" value={data.totalEmailsFetched} sub="all time" color="text-foreground" />
              <StatTile label="Jobs extracted" value={data.totalJobsExtracted} sub="by AI" color="text-indigo-400" />
              <StatTile label="Jobs imported" value={data.totalJobsImported} sub="new to DB" color="text-emerald-400" />
              <StatTile label="Dedup skipped" value={data.totalJobsSkippedDedup} sub="duplicates" color="text-muted-foreground" />
            </div>
          </div>

          {/* Per-sync log */}
          {showHistory && data.syncHistory.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Time</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Fetched</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Extracted</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Imported</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.syncHistory.map((ev) => (
                    <tr key={ev.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(ev.syncedAt).toLocaleString(undefined, {
                          month: "short", day: "numeric",
                          hour: "numeric", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 text-right">{ev.emailsFetched}</td>
                      <td className="px-3 py-2 text-right text-indigo-400">{ev.jobsExtracted}</td>
                      <td className="px-3 py-2 text-right text-emerald-400">{ev.jobsImported}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{ev.jobsSkippedDedup}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.syncHistory.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">No syncs recorded yet — run a sync to start tracking.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-0.5">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</p>
      <p className="text-xs font-medium text-foreground leading-tight">{label}</p>
      <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>
    </div>
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
