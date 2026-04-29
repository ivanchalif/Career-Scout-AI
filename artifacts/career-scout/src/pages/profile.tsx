import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import {
  useGetProfile,
  useUpsertProfile,
  getGetProfileQueryKey,
  type UpsertProfileBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, Save, User, Briefcase, GraduationCap,
  DollarSign, Wifi, CheckCircle2, Upload, FileText, Loader2,
  Sparkles, MapPin, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
  remotePreferences: z.array(z.enum(["remote", "hybrid", "onsite"])).default([]),
  locationPreferences: z.array(z.string()).default([]),
  resumeUrl: z.string().optional().or(z.literal("")),
  resumeText: z.string().optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

function CollapsibleSection({
  icon: Icon,
  title,
  badge,
  isOpen,
  onToggle,
  headerActions,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left hover:opacity-80 transition-opacity"
          onClick={onToggle}
        >
          <Icon className="w-4 h-4 text-indigo-400" />
          <h2 className="font-semibold text-foreground text-sm">{title}</h2>
          {badge !== undefined && badge > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {headerActions}
          <button
            type="button"
            className="p-1 rounded hover:bg-muted/40 transition-colors"
            onClick={onToggle}
          >
            {isOpen ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="px-5 pb-5 pt-4 border-t border-border space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();

  const [skillInput, setSkillInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [resumeMode, setResumeMode] = useState<"upload" | "paste">("upload");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      const token = await getToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

      const uploadRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
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
        headers: { "Content-Type": "application/json", ...authHeader },
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
      const token = await getToken();
      const res = await fetch("/api/profile/parse-resume", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
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
  const remotePreferences = watch("remotePreferences") ?? [];
  const locationPreferences = watch("locationPreferences") ?? [];

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
      remotePreferences: ((p.remotePreferences ?? []) as Array<"remote" | "hybrid" | "onsite">),
      locationPreferences: p.locationPreferences ?? [],
      resumeUrl: p.resumeUrl ?? "",
      resumeText: p.resumeText ?? "",
    });
    if (p.resumeText && p.resumeText.length > 0) {
      setResumeMode("paste");
    }
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

  function addLocation() {
    const newLocs = locationInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !locationPreferences.includes(s));
    if (newLocs.length > 0) {
      setValue("locationPreferences", [...locationPreferences, ...newLocs]);
    }
    setLocationInput("");
  }

  function removeLocation(loc: string) {
    setValue("locationPreferences", locationPreferences.filter((l) => l !== loc));
  }

  function toggleRemotePreference(val: "remote" | "hybrid" | "onsite") {
    if (remotePreferences.includes(val)) {
      setValue("remotePreferences", remotePreferences.filter((v) => v !== val));
    } else {
      setValue("remotePreferences", [...remotePreferences, val]);
    }
  }

  async function onSubmit(data: ProfileFormData) {
    const payload: UpsertProfileBody = {
      ...data,
      targetSalary: data.targetSalary || undefined,
      resumeUrl: data.resumeUrl || undefined,
      resumeText: resumeMode === "paste" ? (data.resumeText || undefined) : undefined,
      remotePreferences: data.remotePreferences,
      locationPreferences: data.locationPreferences,
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
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Skills */}
            <CollapsibleSection
              icon={User}
              title="Skills"
              badge={skills.length}
              isOpen={openSections.has("skills")}
              onToggle={() => toggleSection("skills")}
            >
              <div className="flex gap-2">
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
            </CollapsibleSection>

            {/* Experience */}
            <CollapsibleSection
              icon={Briefcase}
              title="Experience"
              badge={expFields.length}
              isOpen={openSections.has("experience")}
              onToggle={() => toggleSection("experience")}
              headerActions={
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-indigo-400 border-indigo-800/50 hover:bg-indigo-950/30 hover:text-indigo-300 h-7 text-xs"
                    onClick={() => {
                      parseResumeExperience();
                      if (!openSections.has("experience")) toggleSection("experience");
                    }}
                    disabled={isParsingResume}
                    data-testid="parse-resume-button"
                  >
                    {isParsingResume ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {isParsingResume ? "Parsing…" : "Import"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => {
                      appendExp({ title: "", company: "", startYear: new Date().getFullYear(), endYear: null, description: "" });
                      if (!openSections.has("experience")) toggleSection("experience");
                    }}
                    data-testid="add-experience-button"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </Button>
                </div>
              }
            >
              {expFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No experience entries yet</p>
              ) : (
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
              )}
            </CollapsibleSection>

            {/* Preferences (Education + Salary + Work type + Location) */}
            <CollapsibleSection
              icon={GraduationCap}
              title="Preferences"
              isOpen={openSections.has("preferences")}
              onToggle={() => toggleSection("preferences")}
            >
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
                    Work type (select all that apply)
                  </Label>
                  <div className="flex gap-2 pt-1">
                    {(["remote", "hybrid", "onsite"] as const).map((type) => {
                      const labels = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
                      const active = remotePreferences.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleRemotePreference(type)}
                          data-testid={`remote-pref-${type}`}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                              : "border-border text-muted-foreground hover:border-muted-foreground"
                          }`}
                        >
                          {labels[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Location preferences */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Location preferences
                </Label>
                <p className="text-xs text-muted-foreground">
                  Add cities, states, countries, or metro areas you'd consider (e.g. "New York", "SF Bay Area", "Texas").
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. New York, SF Bay Area"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addLocation(); }
                    }}
                    data-testid="location-input"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addLocation} className="shrink-0">
                    Add
                  </Button>
                </div>
                {locationPreferences.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {locationPreferences.map((loc) => (
                      <Badge
                        key={loc}
                        variant="secondary"
                        className="flex items-center gap-1 pr-1 text-xs"
                      >
                        {loc}
                        <button
                          type="button"
                          onClick={() => removeLocation(loc)}
                          className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* Resume */}
            <CollapsibleSection
              icon={FileText}
              title="Resume"
              isOpen={openSections.has("resume")}
              onToggle={() => toggleSection("resume")}
            >
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
            </CollapsibleSection>

            {/* Save button */}
            <div className="flex justify-end pt-2">
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
        )}
      </div>
    </Layout>
  );
}
