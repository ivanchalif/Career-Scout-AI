import { Link } from "wouter";
import {
  ArrowLeft, Zap, ExternalLink, RotateCcw,
  Building2, Calendar, DollarSign, CheckCircle, XCircle
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
      <div className="relative flex items-center justify-center w-28 h-28">
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
    query: { queryKey: getGetPostingQueryKey(id) },
  });
  const analyzeMutation = useAnalyzePosting();

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

  const { posting, report } = data;
  const score = report?.fitScore ?? null;

  return (
    <Layout>
      <div className="px-6 py-8 max-w-4xl mx-auto" data-testid="posting-detail-page">
        {/* Back */}
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mb-6 gap-2 -ml-2 text-muted-foreground" data-testid="back-button">
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Button>
        </Link>

        {/* Header card */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Score ring */}
            <div className="shrink-0">
              <ScoreRingLarge score={score} />
            </div>

            {/* Job info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-foreground" data-testid="posting-title">
                    {posting.title}
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{posting.company}</span>
                    <Badge variant="secondary" className="text-xs">{posting.source}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {posting.link && (
                    <a href={posting.link} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="gap-1.5" data-testid="posting-external-link">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </Button>
                    </a>
                  )}
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
                  <span>{new Date(posting.createdAt).toLocaleDateString()}</span>
                </div>
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

        {/* Full description */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-4">Job description</h2>
          <div
            className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed"
            data-testid="job-description"
          >
            {posting.fullDescription}
          </div>
        </div>
      </div>
    </Layout>
  );
}
