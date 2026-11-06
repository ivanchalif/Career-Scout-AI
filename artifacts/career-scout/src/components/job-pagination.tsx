import { Button } from "@/components/ui/button";

type JobPaginationProps = {
  page: number;
  totalPages: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
};

/** Zero-based state; one-based labels. All pages stay reachable on narrow screens. */
export function JobPagination({ page, totalPages, loading = false, onPageChange }: JobPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5 py-4" aria-label="Job pages">
      <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => onPageChange(0)}>First</Button>
      <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => onPageChange(page - 1)}>Previous</Button>
      {Array.from({ length: totalPages }, (_, index) => (
        <Button
          key={index}
          variant={index === page ? "default" : "outline"}
          size="sm"
          className="min-w-9"
          aria-label={`Page ${index + 1}`}
          aria-current={index === page ? "page" : undefined}
          disabled={loading}
          onClick={() => onPageChange(index)}
        >
          {index + 1}
        </Button>
      ))}
      <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => onPageChange(page + 1)}>Next</Button>
      <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => onPageChange(totalPages - 1)}>Last</Button>
    </nav>
  );
}
