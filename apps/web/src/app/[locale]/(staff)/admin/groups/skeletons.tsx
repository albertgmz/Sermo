import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// The skeletons of the screens of "Groups and permissions" (groups, promotions, permissions and
// staff share them): each mirrors the block it stands for once settled.

// A panel holding a list of rows with a title line and a detail line.
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="border-b p-4">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y">
        {ROWS.slice(0, rows).map((row) => (
          <div key={row} className="space-y-2 px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// A list panel and a form panel: the skeleton of a screen listing its rows above a creation form.
export function ListFormSkeleton({ formRows }: { formRows?: number }) {
  return (
    <div className="space-y-4">
      <ListSkeleton />
      <FormSkeleton rows={formRows} />
    </div>
  );
}

// A panel holding label / control rows and the save bar.
export function FormSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="border-b p-4">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y">
        {ROWS.slice(0, rows).map((row) => (
          <div
            key={row}
            className="grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full md:h-8" />
          </div>
        ))}
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

// The heading of a page: shown at once, while the page's content streams in below it.
export function PageHead({
  heading,
  subtitle,
}: {
  heading: string;
  subtitle?: string;
}) {
  return (
    <header>
      <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </header>
  );
}
