import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import {
  useGetProfile,
  useUpsertProfile,
  getGetProfileQueryKey,
  useGetGmailStatus,
  getGetGmailStatusQueryKey,
  useDisconnectGmail,
  useSyncGmail,
  type UpsertProfileBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, Save, User, Briefcase, GraduationCap,
  DollarSign, Wifi, CheckCircle2, Upload, FileText, Loader2,
  Mail, RefreshCw, Unlink, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout";

const profileSchema = z.object({
  skills: z.array(z.string()).default([]),
  experienceHistory: z
    .array(
      z.object({
        title: z.string().min(1, "Title required"),
        company: z.string().min(1, "Company required"),
        startYear: z.number().int().min(1970).max(2030),
        endYear: z.number().int().min(1970).max(2030).optional().nullable(),
        description: z.string().optional(),
      })
    )
    .default([]),
  education: z.string().optional(),
  targetSalary: z.number().int().min(0).optional().nullable(),
  remotePreference: z.enum(["remote", "hybrid", "onsite"]).default("hybrid"),
  resumeUrl: z.string().optional().or(z.literal("")),
  resumeText: z.string().optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();

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
  const search = useSearch();
  const [skillInput, setSkillInput] = useState("");
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [resumeMode, setResumeMode] = useState<"upload" | "paste">("upload");
  const [syncScheduleHours, setSyncScheduleHours] = useState<number | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  const { data: gmailStatus, isLoading: gmailLoading } = useGetGmailStatus();
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

  async function handleResumeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({ title: "Invalid file type", description: "Please upload a PDF file.", variant: "destructive" });
      return;
    }
    setResumeFileName(file.name);
    setIsUploadingResume(true);
    try {
      const uploadRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!uploadRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await uploadRes.json();

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) throw new Error("Upload failed");

      await fetch("/api/storage/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath }),
      });

      const servingUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;
      setValue("resumeUrl", servingUrl);
      toast({ title: "Resume uploaded", description: `${file.name} uploaded successfully.` });
    } catch {
      toast({ title: "Upload failed", description: "Failed to upload resume. Please try again.", variant: "destructive" });
    } finally {
      setIsUploadingResume(false);
    }
  }

  const profileQ = useGetProfile({ query: { queryKey: getGetProfileQueryKey() } });
  const upsertMutation = useUpsertProfile();

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } =
    useForm<ProfileFormData>({
      resolver: zodResolver(profileSchema),
      defaultValues: {
        skills: [],
        experienceHistory: [],
        remotePreference: "hybrid",
      },
    });

  const { fields: expFields, append: appendExp, remove: removeExp, replace: replaceExp } = useFieldArray({
    control,
    name: "experienceHistory",
  });

  async function parseResumeExperience() {
    const currentResumeUrl = watch("resumeUrl");
    if (!currentResumeUrl) {
      toast({ title: "No resume uploaded", description: "Upload a PDF resume first, then save your profile.", variant: "destructive" });
      return;
    }
    setIsParsingResume(true);
    try {
      const res = await fetch("/api/profile/parse-resume", { method: "POST" });
      const body = await res.json() as { experienceHistory?: Array<{ title: string; company: string; startYear: number; endYear?: number | null; description?: string }>; error?: string };
      if (!res.ok) {
        toast({ title: "Parsing failed", description: body.error ?? "Could not parse resume.", variant: "destructive" });
        return;
      }
      const entries = body.experienceHistory ?? [];
      replaceExp(entries.map((e) => ({
        title: e.title,
        company: e.company,
        startYear: e.startYear,
        endYear: e.endYear ?? null,
        description: e.description ?? "",
      })));
      toast({ title: "Work history imported", description: `${entries.length} position${entries.length === 1 ? "" : "s"} imported from your resume. Review and save.` });
    } catch {
      toast({ title: "Parsing failed", description: "An error occurred. Please try again.", variant: "destructive" });
    } finally {
      setIsParsingResume(false);
    }
  }

  const skills = watch("skills") ?? [];

  useEffect(() => {
    const p = profileQ.data;
    if (!p) return;
    reset({
      skills: p.skills ?? [],
      experienceHistory: (p.experienceHistory ?? []).map((e) => ({
        ...e,
        endYear: e.endYear ?? null,
        description: e.description ?? "",
      })),
      education: p.education ?? "",
      targetSalary: p.targetSalary ?? null,
      remotePreference: (p.remotePreference as "remote" | "hybrid" | "onsite") ?? "hybrid",
      resumeUrl: p.resumeUrl ?? "",
      resumeText: p.resumeText ?? "",
    });
    if (p.resumeText && p.resumeText.length > 0) {
      setResumeMode("paste");
    }
    setSyncScheduleHours(p.syncScheduleHours ?? null);
  }, [profileQ.data, reset]);

  function addSkill() {
    const newSkills = skillInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !skills.includes(s));
    if (newSkills.length > 0) {
      setValue("skills", [...skills, ...newSkills]);
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setValue("skills", skills.filter((s) => s !== skill));
  }

  async function onSubmit(data: ProfileFormData) {
    const payload: UpsertProfileBody = {
      ...data,
      targetSalary: data.targetSalary || undefined,
      resumeUrl: data.resumeUrl || undefined,
      // When in upload mode, clear any stored pasted text so PDF is used for scoring
      // When in paste mode, the pasted text takes priority in scoring
      resumeText: resumeMode === "paste" ? (data.resumeText || undefined) : undefined,
      experienceHistory: data.experienceHistory.map((e) => ({
        title: e.title,
        company: e.company,
        startYear: e.startYear,
        endYear: e.endYear || undefined,
        description: e.description || "",
      })),
    };
    await upsertMutation.mutateAsync(
      { data: payload },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetProfileQueryKey() });
          toast({ title: "Profile saved", description: "Your career profile has been updated." });
        },
        onError: () =>
          toast({ title: "Error", description: "Failed to save profile.", variant: "destructive" }),
      }
    );
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
              description: hours ? `Gmail will sync automatically every ${hours} hour${hours === 1 ? "" : "s"}.` : "Automatic sync disabled — use manual sync.",
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
      <div className="px-6 py-8 max-w-3xl mx-auto" data-testid="profile-page">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Career Profile</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your profile is used to score and rank job opportunities
            </p>
          </div>
          {!profileQ.data && !profileQ.isLoading && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/30 text-xs text-amber-400">
              Profile not set up yet
            </div>
          )}
        </div>

        {profileQ.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Skills */}
            <section className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-indigo-400" />
                <h2 className="font-semibold text-foreground">Skills</h2>
              </div>
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="Add a skill (e.g. TypeScript)"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(); }
                  }}
                  data-testid="skill-input"
                />
                <Button type="button" variant="outline" onClick={addSkill} data-testid="add-skill-button">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {skills.length > 0 ? (
                <div className="flex flex-wrap gap-2" data-testid="skills-list">
                  {skills.map((skill) => (
                    <Badge
                      key={skill}
                      variant="secondary"
                      className="gap-1.5 pr-1.5 cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors"
                      onClick={() => removeSkill(skill)}
                      data-testid={`skill-${skill}`}
                    >
                      {skill}
                      <Trash2 className="w-3 h-3" />
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No skills added yet</p>
              )}
            </section>

            {/* Experience */}
            <section className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-indigo-400" />
                  <h2 className="font-semibold text-foreground">Experience</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-indigo-400 border-indigo-800/50 hover:bg-indigo-950/30 hover:text-indigo-300"
                    onClick={parseResumeExperience}
                    disabled={isParsingResume}
                    data-testid="parse-resume-button"
                  >
                    {isParsingResume ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isParsingResume ? "Parsing…" : "Import from resume"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => appendExp({ title: "", company: "", startYear: new Date().getFullYear(), endYear: null, description: "" })}
                    data-testid="add-experience-button"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </Button>
                </div>
              </div>
              {expFields.length === 0 && (
                <p className="text-sm text-muted-foreground">No experience entries yet</p>
              )}
              <div className="space-y-4">
                {expFields.map((field, i) => (
                  <div key={field.id} className="p-4 bg-background border border-border rounded-lg space-y-3" data-testid={`experience-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Position {i + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeExp(i)}
                        data-testid={`remove-experience-${i}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Job title</Label>
                        <Input
                          placeholder="Software Engineer"
                          data-testid={`exp-title-${i}`}
                          {...register(`experienceHistory.${i}.title`)}
                        />
                        {errors.experienceHistory?.[i]?.title && (
                          <p className="text-xs text-destructive">{errors.experienceHistory[i]?.title?.message}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Company</Label>
                        <Input
                          placeholder="Acme Corp"
                          data-testid={`exp-company-${i}`}
                          {...register(`experienceHistory.${i}.company`)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Start year</Label>
                        <Input
                          type="number"
                          placeholder="2020"
                          data-testid={`exp-start-${i}`}
                          {...register(`experienceHistory.${i}.startYear`, { valueAsNumber: true })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End year (leave blank if current)</Label>
                        <Input
                          type="number"
                          placeholder="Present"
                          data-testid={`exp-end-${i}`}
                          {...register(`experienceHistory.${i}.endYear`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (optional)</Label>
                      <Textarea
                        placeholder="Brief description of your role..."
                        rows={2}
                        data-testid={`exp-description-${i}`}
                        {...register(`experienceHistory.${i}.description`)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Education + Target Salary + Remote */}
            <section className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap className="w-4 h-4 text-indigo-400" />
                <h2 className="font-semibold text-foreground">Preferences</h2>
              </div>
              <div className="space-y-1.5">
                <Label>Education</Label>
                <Input
                  placeholder="e.g. B.S. Computer Science, MIT 2018"
                  data-testid="education-input"
                  {...register("education")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Target salary (USD/year)
                  </Label>
                  <Input
                    type="number"
                    placeholder="e.g. 150000"
                    data-testid="salary-input"
                    {...register("targetSalary", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5" />
                    Work preference
                  </Label>
                  <Select
                    defaultValue={profileQ.data?.remotePreference ?? "hybrid"}
                    onValueChange={(val) =>
                      setValue("remotePreference", val as "remote" | "hybrid" | "onsite")
                    }
                  >
                    <SelectTrigger data-testid="remote-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remote">Remote</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="onsite">On-site</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Resume
                </Label>
                {/* Mode toggle */}
                <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() => setResumeMode("upload")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${resumeMode === "upload" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid="resume-mode-upload"
                  >
                    Upload PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setResumeMode("paste")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${resumeMode === "paste" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    data-testid="resume-mode-paste"
                  >
                    Paste text
                  </button>
                </div>

                {resumeMode === "upload" ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <label
                        htmlFor="resume-upload"
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium cursor-pointer hover:bg-muted/50 transition-colors ${isUploadingResume ? "opacity-60 pointer-events-none" : ""}`}
                        data-testid="resume-upload-label"
                      >
                        {isUploadingResume ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        {isUploadingResume ? "Uploading…" : "Choose PDF"}
                      </label>
                      <input
                        id="resume-upload"
                        type="file"
                        accept="application/pdf"
                        className="sr-only"
                        onChange={handleResumeFile}
                        data-testid="resume-file-input"
                      />
                      {(resumeFileName || watch("resumeUrl")) && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {resumeFileName ?? "Resume saved"}
                        </span>
                      )}
                    </div>
                    {watch("resumeUrl") && (
                      <a
                        href={watch("resumeUrl")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:underline"
                        data-testid="resume-view-link"
                      >
                        View current resume
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Textarea
                      placeholder="Paste your resume text here — include your work history, skills, education, and any other relevant details…"
                      rows={12}
                      className="text-sm font-mono resize-y"
                      data-testid="resume-text-input"
                      {...register("resumeText")}
                    />
                    <p className="text-xs text-muted-foreground">
                      Paste plain text from your resume. This will be used for scoring and "Import from resume" — no file upload needed.
                    </p>
                  </div>
                )}
                <input type="hidden" {...register("resumeUrl")} />
              </div>
            </section>

            {/* Save button */}
            <div className="flex justify-end">
              <Button
                type="submit"
                className="gap-2 bg-indigo-600 hover:bg-indigo-500 min-w-[120px]"
                disabled={upsertMutation.isPending}
                data-testid="save-profile-button"
              >
                {upsertMutation.isSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Saved
                  </>
                ) : upsertMutation.isPending ? (
                  <>
                    <Save className="w-4 h-4 animate-pulse" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save profile
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Gmail integration section */}
          <section className="bg-card border border-border rounded-xl p-5 mt-5" data-testid="gmail-section">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-foreground">Gmail integration</h2>
            </div>

            {gmailLoading ? (
              <div className="h-16 flex items-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : gmailStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm text-foreground">
                    Connected as <span className="font-medium">{gmailStatus.email ?? "your Gmail account"}</span>
                  </span>
                </div>
                {gmailStatus.lastSyncedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {new Date(gmailStatus.lastSyncedAt).toLocaleString()} &middot; {gmailStatus.postingCount} job email{gmailStatus.postingCount === 1 ? "" : "s"} found
                  </p>
                )}
                {!gmailStatus.lastSyncedAt && (
                  <p className="text-xs text-muted-foreground">Never synced yet — click Sync now to start.</p>
                )}
                {/* Auto-sync schedule */}
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
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
                    <SelectTrigger className="w-48 h-8 text-xs" data-testid="sync-schedule-trigger">
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
                      ? `Career Scout will check your inbox every ${syncScheduleHours} hour${syncScheduleHours === 1 ? "" : "s"} automatically.`
                      : "Sync only runs when you click \"Sync now\"."}
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
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect your Gmail account so Career Scout can automatically detect job-related emails.
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
          </>
        )}
      </div>
    </Layout>
  );
}
