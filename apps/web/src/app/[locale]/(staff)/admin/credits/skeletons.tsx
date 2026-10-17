import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadingSkeleton } from "../../skeletons";
import { ListSkeleton } from "../groups/skeletons";

// The skeletons of the economy screens' list, new and edit pages (credit rules, awards and the
// shop share them): each mirrors what settles.

// The new and the edit page: a card of fields, optionally the closed advanced card, the save bar.
// `heading` adds the page header's placeholder above, for a page that draws its own header once
// its record is read.
export function EditFormSkeleton({
  rows = 4,
  advanced = false,
  heading = false,
}: {
  rows?: number;
  advanced?: boolean;
  heading?: boolean;
}) {
  const form = (
    <div aria-hidden="true" className="space-y-4">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="space-y-2 border-b p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }, (_, row) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
              key={row}
              className="grid gap-2 p-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full md:h-8" />
            </div>
          ))}
        </div>
      </div>
      {advanced && <Skeleton className="h-12 w-full rounded-lg" />}
      <div className="rounded-lg border p-4">
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
  return heading ? (
    <div className="space-y-6">
      <HeadingSkeleton trail />
      {form}
    </div>
  ) : (
    form
  );
}

// The loading file of a new or an edit page.
export function EditFormLoading({
  label,
  rows,
  advanced,
}: {
  label: string;
  rows?: number;
  advanced?: boolean;
}) {
  return (
    <LoadingRegion label={label}>
      <EditFormSkeleton heading rows={rows} advanced={advanced} />
    </LoadingRegion>
  );
}

// The loading file of a list or sort page.
export function ListLoading({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <ListSkeleton rows={6} />
      </div>
    </LoadingRegion>
  );
}
