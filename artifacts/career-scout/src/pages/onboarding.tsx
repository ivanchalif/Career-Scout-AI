import { useState, useEffect } from "react";
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
  Plus, Trash2, ArrowRight, User, Briefcase,
  DollarSign, Wifi, FileText, Upload, Loader2, Rocket
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const onboardingSchema = z.object({
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
});

type OnboardingFormData = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [skillInput, setSkillInput] = useState("");
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);

  const profileQ = useGetProfile({ query: { queryKey: getGetProfileQueryKey() } });
  const upsertMutation = useUpsertProfile();

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } =
    useForm<OnboardingFormData>({
      resolver: zodResolver(onboardingSchema),
      defaultValues: {
        skills: [],
        experienceHistory: [],
        remotePreference: "hybrid",
      },
    });

  const { fields: expFields, append: appendExp, remove: removeExp } = useFieldArray({
    control,
    name: "experienceHistory",
  });

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
    });
  }, [profileQ.data, reset]);

  function addSkill() {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setValue("skills", [...skills, trimmed]);
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setValue("skills", skills.filter((s) => s !== skill));
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

      const servingUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;
      setValue("resumeUrl", servingUrl);
      toast({ title: "Resume uploaded", description: `${file.name} uploaded successfully.` });
    } catch {
      toast({ title: "Upload failed", description: "Failed to upload resume.", variant: "destructive" });
    } finally {
      setIsUploadingResume(false);
    }
  }

  async function onSubmit(data: OnboardingFormData) {
    const payload: UpsertProfileBody = {
      ...data,
      targetSalary: data.targetSalary || undefined,
      resumeUrl: data.resumeUrl || undefined,
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
          setLocation("/dashboard");
        },
        onError: () =>
          toast({ title: "Error", description: "Failed to save profile.", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
          <Rocket className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-foreground">Career Scout</span>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-2xl" data-testid="onboarding-page">
          {/* Welcome */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-950/50 border border-indigo-800/30 mb-4">
              <User className="w-7 h-7 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Set up your career profile</h1>
            <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
              Tell us about your skills and experience so we can score job opportunities against your profile.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Skills */}
            <section className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-indigo-400" />
                <h2 className="font-semibold text-foreground">Your skills</h2>
                <span className="text-xs text-muted-foreground ml-auto">Add at least a few to improve scoring</span>
              </div>
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="e.g. TypeScript, React, Python..."
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addSkill(); }
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
                  <h2 className="font-semibold text-foreground">Work experience</h2>
                </div>
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
              {expFields.length === 0 && (
                <p className="text-sm text-muted-foreground">No experience entries yet. Add your most recent roles.</p>
              )}
              <div className="space-y-4">
                {expFields.map((field, i) => (
                  <div key={field.id} className="p-4 bg-background border border-border rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Position {i + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeExp(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Job title</Label>
                        <Input placeholder="Software Engineer" {...register(`experienceHistory.${i}.title`)} />
                        {errors.experienceHistory?.[i]?.title && (
                          <p className="text-xs text-destructive">{errors.experienceHistory[i]?.title?.message}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Company</Label>
                        <Input placeholder="Acme Corp" {...register(`experienceHistory.${i}.company`)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Start year</Label>
                        <Input type="number" placeholder="2020" {...register(`experienceHistory.${i}.startYear`, { valueAsNumber: true })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End year (leave blank if current)</Label>
                        <Input
                          type="number"
                          placeholder="Present"
                          {...register(`experienceHistory.${i}.endYear`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (optional)</Label>
                      <Textarea placeholder="Brief description of your role..." rows={2} {...register(`experienceHistory.${i}.description`)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Preferences + Resume */}
            <section className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="font-semibold text-foreground">Preferences &amp; resume</h2>
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
                    defaultValue="hybrid"
                    onValueChange={(val) => setValue("remotePreference", val as "remote" | "hybrid" | "onsite")}
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

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Resume (PDF, optional)
                </Label>
                <div className="flex items-center gap-3">
                  <label
                    htmlFor="onboarding-resume-upload"
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium cursor-pointer hover:bg-muted/50 transition-colors ${isUploadingResume ? "opacity-60 pointer-events-none" : ""}`}
                    data-testid="resume-upload-label"
                  >
                    {isUploadingResume ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isUploadingResume ? "Uploading…" : "Upload PDF"}
                  </label>
                  <input
                    id="onboarding-resume-upload"
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={handleResumeFile}
                    data-testid="resume-file-input"
                  />
                  {resumeFileName && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{resumeFileName}</span>
                  )}
                </div>
                <input type="hidden" {...register("resumeUrl")} />
              </div>
            </section>

            <Button
              type="submit"
              className="w-full gap-2 bg-indigo-600 hover:bg-indigo-500 h-11"
              disabled={upsertMutation.isPending}
              data-testid="start-button"
            >
              {upsertMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Get started
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You can update your profile anytime from the settings page.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
