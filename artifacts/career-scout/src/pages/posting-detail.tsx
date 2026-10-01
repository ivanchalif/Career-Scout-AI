import { Link, useLocation } from "wouter";
import {
  ArrowLeft, Zap, ExternalLink, RotateCcw,
  Building2, Calendar, DollarSign, CheckCircle, XCircle,
  Lightbulb, BookOpen, ClipboardList, MapPin, MoreHorizontal
} from "lucide-react";
import {
  useGetPosting,
  useAnalyzePosting,
  getGetPostingQueryKey,
  getListPostingsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/layout";
import { PostingDecisionControls } from "@/components/posting-decision-controls";
import { usePostingDecision, dismissReasons } from "@/hooks/use-posting-decision";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

function ScoreRingLarge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-center w-28 h-28 rounded-full border-3 border-muted bg-muted/10">
          <div className="text-center">
            <p className="text-3xl font-bold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-1">Not scored</p>
          </div>
        </div>
      </div>
    );
  }

  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Strong fit" : score >= 60 ? "Moderate fit" : "Weak fit";
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center w-28 h-28" data-testid="score-ring">
        <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
          <circle cx="56" cy="56" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${progress} ${circumference - progress}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute text-center">
          <p className="text-3xl font-bold" style={{ color }}>{score}</p>
        </div>
      </div>
      <span className="text-sm font-medium" style={{ color }}>{label}</span>
    </div>
  );
}

export default function PostingDetailPage({ id }: { id: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const postingQ = useGetPosting(id, {
    query: {
      queryKey: getGetPostingQueryKey(id),
      // A missing posting is a stable state (it may have been deleted,
      // deduplicated, or removed by another tab), so retrying only creates
      // repeated runtime errors while the user is looking at the page.
      retry: false,
    },
  });
  const analyzeMutation = useAnalyzePosting();
  const decision = usePostingDecision();
  const [, setLocation] = useLocation();

  const data = postingQ.data;

  async function handleAnalyze() {
    await analyzeMutation.mutateAsync(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPostingQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListPostingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Analysis complete", description: "Fit score updated." });
        },
        onError: () => toast({ title: "Error", description: "Analysis failed.", variant: "destructive" }),
      }
    );
  }

  if (postingQ.isLoading) {
    return (
      <Layout>
        <div className="px-6 py-8 max-w-4xl mx-auto">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (postingQ.isError) {
    const error = postingQ.error as { status?: number; message?: string } | null;
    const isMissing = error?.status === 404 || error?.message?.includes("Posting not found");
    return (
      <Layout>
        <div className="px-6 py-8 max-w-4xl mx-auto text-center py-20" data-testid="posting-detail-error">
          <p className="text-foreground font-medium">
            {isMissing ? "This job posting is no longer available." : "Could not load this job posting."}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {isMissing
              ? "It may have been deleted, closed, or removed as a duplicate."
              : "Please return to the dashboard and try again."}
          </p>
          <Link href="/dashboard">
            <Button variant="outline" className="mt-4">Back to dashboard</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <div className="px-6 py-8 max-w-4xl mx-auto text-center py-20">
          <p className="text-muted-foreground">Job posting not found.</p>
          <Link href="/dashboard">
            <Button variant="outline" className="mt-4">Back to dashboard</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const { posting, report, feedback } = data;
  const score = report?.fitScore ?? null;
  const availability = posting;
  const availabilityLabel = availability.availabilityStatus === "open"
    ? "Reported open"
    : availability.availabilityStatus === "closed"
      ? "Reported closed"
      : availability.availabilityStatus === "unverified"
        ? "Availability unverified"
        : availability.availabilityStatus === null
          ? "Availability not checked"
        : null;

  return (
    <Layout>
      <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto min-w-0" data-testid="posting-detail-page">
        {/* Back */}
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mb-6 gap-2 -ml-2 text-muted-foreground" data-testid="back-button">
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Button>
        </Link>

        {/* Header card */}
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Score ring */}
            <div className="shrink-0">
              <ScoreRingLarge score={score} />
            </div>

            {/* Job info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-foreground" data-testid="posting-title">
                    {posting.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{posting.company}</span>
                    {posting.location && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        {posting.location}
                      </span>
                    )}
                    <Badge variant="secondary" className="text-xs">{posting.senderName ?? data.sourceName ?? posting.source}</Badge>
                    {data.onlineMatchScore != null && (
                      <Badge variant="outline" className="text-xs text-violet-300 border-violet-800/50" title="Online discovery match score">
                        Match {data.onlineMatchScore}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0 min-w-0">
                  {posting.link && (
                    <a href={posting.link} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="gap-1.5" data-testid="posting-external-link">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </Button>
                    </a>
                  )}
                  <PostingDecisionControls postingId={id} feedback={feedback} onDismissed={() => setLocation("/dashboard")} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground" aria-label="More actions" data-testid="posting-more-actions">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {dismissReasons.map((r) => (
                        <DropdownMenuItem key={r.kind} onSelect={async () => { if (await decision.dismiss(id, r.kind)) setLocation("/dashboard"); }}>
                          Dismiss: {r.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    onClick={handleAnalyze}
                    size="sm"
                    className="gap-1.5 bg-indigo-600 hover:bg-indigo-500"
                    disabled={analyzeMutation.isPending}
                    data-testid="analyze-button"
                  >
                    {analyzeMutation.isPending ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        {score !== null ? "Re-analyze" : "Analyze"}
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Discovered {new Date(posting.createdAt).toLocaleDateString()}</span>
                </div>
                {posting.sourcePostedAt && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Posted {new Date(posting.sourcePostedAt).toLocaleDateString()} (source date)</span>
                  </div>
                )}
                {(posting.salaryMin || posting.salaryMax) && (
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>
                      {posting.salaryMin && posting.salaryMax
                        ? `$${posting.salaryMin.toLocaleString()} – $${posting.salaryMax.toLocaleString()}`
                        : posting.salaryMin
                        ? `From $${posting.salaryMin.toLocaleString()}`
                        : `Up to $${posting.salaryMax!.toLocaleString()}`}
                    </span>
                  </div>
                )}
              </div>

              {/* AI reasoning */}
              {report?.reasoning && (
                <div className="mt-4 p-3 bg-indigo-950/30 border border-indigo-800/30 rounded-lg">
                  <p className="text-xs font-medium text-indigo-400 mb-1">AI Analysis</p>
                  <p className="text-sm text-foreground/80" data-testid="ai-reasoning">{report.reasoning}</p>
                </div>
              )}

              {availabilityLabel && (
                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3" data-testid="posting-availability">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={availability.availabilityStatus === "open"
                        ? "text-emerald-400 border-emerald-800/50"
                        : availability.availabilityStatus === "closed"
                          ? "text-amber-400 border-amber-800/50"
                          : "text-muted-foreground"}
                    >
                      {availabilityLabel}
                    </Badge>
                    {availability.availabilityCheckedAt && (
                      <span className="text-xs text-muted-foreground">
                        Checked {new Date(availability.availabilityCheckedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(availability.availabilityReason && humanizeAvailabilityReason(availability.availabilityReason)) || (availability.availabilityStatus === "open"
                      ? "The latest availability check indicates this role is open."
                      : availability.availabilityStatus === "closed"
                        ? "The latest availability check indicates this role may no longer be open."
                        : availability.availabilityStatus === "unverified"
                          ? "We could not confirm whether this role is still open."
                          : "Availability has not been checked yet.")}
                  </p>
                  {posting.availabilityEvidence && posting.availabilityEvidence.length > 0 && (
                    <div className="mt-2 border-t border-border/70 pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Availability sources</p>
                      <ul className="space-y-1">
                        {posting.availabilityEvidence.map((evidence, index) => (
                          <li key={`${evidence}-${index}`} className="text-xs text-muted-foreground break-all">
                            {evidence.startsWith("https://") || evidence.startsWith("http://") ? (
                              <a href={evidence} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                                {evidence}
                              </a>
                            ) : evidence}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Compensation gap */}
              {report?.compensationGap != null && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">
                    Compensation gap:{" "}
                    <span
                      className={report.compensationGap >= 0 ? "text-emerald-400" : "text-red-400"}
                      data-testid="compensation-gap"
                    >
                      {report.compensationGap >= 0 ? "+" : ""}
                      {report.compensationGap.toLocaleString()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Matched skills */}
          {report?.matchedSkills && report.matchedSkills.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <h2 className="font-semibold text-foreground text-sm">Matched skills</h2>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="matched-skills">
                {report.matchedSkills.map((skill) => (
                  <span key={skill} className="text-xs px-2.5 py-1 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Missing skills */}
          {report?.missingSkills && report.missingSkills.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="w-4 h-4 text-red-400" />
                <h2 className="font-semibold text-foreground text-sm">Missing skills</h2>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="missing-skills">
                {report.missingSkills.map((skill) => (
                  <span key={skill} className="text-xs px-2.5 py-1 rounded-full bg-red-950/40 text-red-400 border border-red-800/30">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Extracted skills from job */}
          {posting.extractedSkills && posting.extractedSkills.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 md:col-span-2">
              <h2 className="font-semibold text-foreground text-sm mb-3">Required skills</h2>
              <div className="flex flex-wrap gap-2">
                {posting.extractedSkills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Application Prep */}
        {report && (
          <div className="bg-card border border-border rounded-xl p-6 mb-6" data-testid="application-prep">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-foreground">Application Prep</h2>
            </div>

            <div className="space-y-4">
              {/* Matched skills — lead with strengths */}
              {report.matchedSkills && report.matchedSkills.length > 0 && (
                <div className="p-4 bg-emerald-950/20 border border-emerald-800/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Highlight in your application</p>
                  </div>
                  <ul className="space-y-1.5">
                    {report.matchedSkills.map((skill) => (
                      <li key={skill} className="flex items-start gap-2 text-sm text-foreground/80">
                        <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                        <span>
                          Emphasize your <strong className="text-foreground">{skill}</strong> experience — it directly matches what they require.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing skills — actionable gaps */}
              {report.missingSkills && report.missingSkills.length > 0 && (
                <div className="p-4 bg-amber-950/20 border border-amber-800/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                    <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Skills to address</p>
                  </div>
                  <ul className="space-y-1.5">
                    {report.missingSkills.map((skill) => (
                      <li key={skill} className="flex items-start gap-2 text-sm text-foreground/80">
                        <span className="text-amber-400 mt-0.5 shrink-0">→</span>
                        <span>
                          <strong className="text-foreground">{skill}</strong> is listed as a requirement. Consider taking a short course or adding a personal project to close this gap.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* General tips */}
              <div className="p-4 bg-indigo-950/20 border border-indigo-800/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-3.5 h-3.5 text-indigo-400" />
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Application tips</p>
                </div>
                <ul className="space-y-1.5 text-sm text-foreground/80">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                    Tailor your resume headline to match <strong className="text-foreground">{posting.title}</strong> at {posting.company}.
                  </li>
                  {posting.salaryMin && (
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                      The posted salary range starts at <strong className="text-foreground">${posting.salaryMin.toLocaleString()}</strong>
                      {posting.salaryMax ? ` up to $${posting.salaryMax.toLocaleString()}` : ""}. Research market rates before negotiating.
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                    Write a concise cover letter focusing on specific achievements, not just responsibilities.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Full description */}
        {posting.fullDescription ? (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold text-foreground mb-4">Job description</h2>
            <div
              className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed"
              data-testid="job-description"
            >
              {posting.fullDescription}
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
