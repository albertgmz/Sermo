import { FormRowSkeleton, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

// A section of the account pages while it loads: the heading is real text, the rows are bars.
export function SectionSkeleton({
  heading,
  description,
  rows = 2,
}: {
  heading: string;
  description?: string;
  rows?: number;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="divide-y">
        {ROWS.slice(0, rows).map((row) => (
          <div key={row} className="space-y-2 p-4">
            <FormRowSkeleton />
            <TextSkeleton />
          </div>
        ))}
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-28" />
      </div>
    </section>
  );
}

export function PageHeadingSkeleton({ heading }: { heading: string }) {
  return <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>;
}

// A group of settings rows while it loads: the heading is real text, the rows are bars.
export function GroupSkeleton({
  heading,
  description,
  rows = 3,
}: {
  heading: string;
  description?: string;
  rows?: number;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {heading}
        </h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {ROWS.slice(0, rows).map((row) => (
          <div key={row} className="space-y-2 p-4">
            <FormRowSkeleton />
            <TextSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}
