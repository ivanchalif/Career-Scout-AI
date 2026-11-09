import { ArrowUpDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DashboardView } from "@/lib/dashboard-sorts";

export const DASHBOARD_SORT_OPTIONS = [
  ["recommended", "Recommended: Fit + your choices"],
  ["date-desc", "Date: Newest first"],
  ["date-asc", "Date: Oldest first"],
  ["score-desc", "Score: Highest first"],
  ["score-asc", "Score: Lowest first"],
  ["title-asc", "Title: A → Z"],
  ["title-desc", "Title: Z → A"],
  ["company-asc", "Company: A → Z"],
  ["company-desc", "Company: Z → A"],
] as const;

export function DashboardSortSelect({
  view, value, onValueChange,
}: {
  view: DashboardView;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor="dashboard-sort" className="text-xs text-muted-foreground">
        Sort {view === "active" ? "Active" : view === "applied" ? "Applied" : "Deleted"}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="dashboard-sort" data-testid="sort-select" className="h-9 w-full sm:w-72 gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DASHBOARD_SORT_OPTIONS.map(([key, label]) => (
            <SelectItem key={key} value={key}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
