import { useMemo } from "react";
import { Link } from "wouter";
import { EyeOff, ExternalLink, Building2, Tag, Loader2 } from "lucide-react";
import { useListPostings, useGetCompanyFilterSettings, useGetTitleExcludeSettings } from "@workspace/api-client-react";
import Layout from "@/components/layout";

type FilterReasons = {
  byCompany: boolean;
  companyReason: string | null;
  byTitle: boolean;
  titleReasons: string[];
};

function getFilterReasons(
  company: string,
  title: string,
  companyFilter: { mode: string; companies: string[] } | null | undefined,
  titleKeywords: string[],
): FilterReasons {
  let byCompany = false;
  let companyReason: string | null = null;

  if (companyFilter && companyFilter.mode !== "off" && companyFilter.companies.length > 0) {
    const co = company.toLowerCase();
    const matched = companyFilter.companies.find((c) => {
      const e = c.toLowerCase();
      return co.includes(e) || e.includes(co);
    });
    if (companyFilter.mode === "exclude" && matched) {
      byCompany = true;
      companyReason = `Excluded: "${matched}"`;
    } else if (companyFilter.mode === "include" && !matched) {
      byCompany = true;
      companyReason = "Not in allowlist";
    }
  }

  const tl = title.toLowerCase();
  const titleReasons = titleKeywords.filter((kw) => tl.includes(kw.toLowerCase()));
  const byTitle = titleReasons.length > 0;

  return { byCompany, companyReason, byTitle, titleReasons };
}

export default function FilteredPage() {
  const { data: postings, isLoading } = useListPostings({ hidden: true });
  const { data: companyFilterData } = useGetCompanyFilterSettings();
  const { data: titleExcludeData } = useGetTitleExcludeSettings();

  const companyFilter = companyFilterData ?? null;
  const titleKeywords: string[] = titleExcludeData?.titleExcludeKeywords ?? [];

  const annotated = useMemo(() => {
    if (!postings) return [];
    return postings.map((item) => {
      const reasons = getFilterReasons(
        item.posting.company,
        item.posting.title,
        companyFilter as { mode: string; companies: string[] } | null,
        titleKeywords,
      );
      return { ...item, ...reasons };
    });
  }, [postings, companyFilter, titleKeywords]);

  const sorted = useMemo(
    () => [...annotated].sort((a, b) => new Date(b.posting.createdAt).getTime() - new Date(a.posting.createdAt).getTime()),
    [annotated],
  );

  return (
    <Layout>
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <EyeOff className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Filtered Jobs</h1>
            <p className="text-sm text-muted-foreground">
              Jobs synced from email but hidden by your active filters before you could review them.
            </p>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
        </div>

        {!isLoading && sorted.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
            <EyeOff className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No filtered jobs</p>
            <p className="mt-1 text-xs">Your current filters aren't suppressing any active postings — or no syncs have run yet.</p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {sorted.length} job{sorted.length === 1 ? "" : "s"} suppressed
              </span>
              <Link href="/profile" className="text-xs text-indigo-400 hover:underline">
                Edit filters →
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {sorted.map(({ posting, report, byCompany, companyReason, byTitle, titleReasons }) => (
                <li key={posting.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Link href={`/postings/${posting.id}`} className="text-sm font-medium text-foreground hover:text-indigo-400 transition-colors truncate">
                        {posting.title}
                      </Link>
                      {report?.fitScore != null && (
                        <span className={`shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums ${
                          report.fitScore >= 80
                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                            : report.fitScore >= 60
                            ? "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                            : "bg-red-950/60 text-red-400 border border-red-800/40"
                        }`}>
                          {report.fitScore}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{posting.company}</span>
                      {posting.location && (
                        <span className="text-xs text-muted-foreground/60">{posting.location}</span>
                      )}
                      <span className="text-xs text-muted-foreground/50">
                        {new Date(posting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {byCompany && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-950/40 text-amber-400 border border-amber-800/30" title={companyReason ?? undefined}>
                          <Building2 className="w-2.5 h-2.5 shrink-0" />
                          {companyReason ?? "Company filter"}
                        </span>
                      )}
                      {byTitle && titleReasons.map((kw) => (
                        <span key={kw} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-950/40 text-rose-400 border border-rose-800/30">
                          <Tag className="w-2.5 h-2.5 shrink-0" />
                          "{kw}"
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    {posting.link && (
                      <a
                        href={posting.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground/50 hover:text-indigo-400 transition-colors"
                        title="Open original posting"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Layout>
  );
}
