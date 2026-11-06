import { Button } from "@/components/ui/button";

export function QueryError({ retry, message = "Jobs could not be loaded. Your saved jobs have not been changed." }: { retry: () => void; message?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-border bg-card px-4 py-5 flex items-center justify-between gap-3">
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" onClick={retry}>Retry</Button>
    </div>
  );
}
