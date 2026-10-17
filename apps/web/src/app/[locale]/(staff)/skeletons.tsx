import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  LoadingRegion,
  MemberRowSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The skeletons of the panel's pages; each mirrors the block it stands for once settled.

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// `trail`: the page draws a `PageHeader` with a trail, whose row comes first.
export function HeadingSkeleton({ trail }: { trail?: boolean }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {trail && <Skeleton className="h-10 w-40 md:h-8" />}
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

// The loading file of a screen: the placeholder of its `PageHeader` (trail row included), then the
// given skeletons, each mirroring the block it stands for once settled. `label` is the loading
// line announced (default: "Loading the page…").
export function LoadingPage({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={label ?? t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">{children}</div>
      </div>
    </LoadingRegion>
  );
}

// The form of a new or an edit page (`EditForm`): a card of `rows` fields, `advanced` closed cards,
// the save bar. `heading` adds the page header's placeholder above, for a page that draws its
// header once its record is read.
export function EditFormSkeleton({
  rows = 4,
  advanced = 0,
  heading = false,
}: {
  rows?: number;
  advanced?: number;
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
      {Array.from({ length: advanced }, (_, card) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
        <Skeleton key={card} className="h-12 w-full rounded-lg" />
      ))}
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

export function PendingSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-28" />
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
    </div>
  );
}

// A card of `LinkCard`: the icon box, the title and the line, and on the home the screens' links.
function LinkCardSkeleton({ links }: { links?: boolean }) {
  return (
    <div className="flex gap-3 rounded-lg border bg-card p-4">
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-3/4" />
        {links && (
          <div className="space-y-2 pt-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}
      </div>
    </div>
  );
}

export function LinkCardsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[1, 2, 3, 4].map((card) => (
        <LinkCardSkeleton key={card} />
      ))}
    </div>
  );
}

export function SectionGridSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-20" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((card) => (
          <LinkCardSkeleton key={card} links />
        ))}
      </div>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <CardSkeleton described>
      {[1, 2, 3].map((row) => (
        <div key={row} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </CardSkeleton>
  );
}

export function StaffSkeleton() {
  return (
    <CardSkeleton described>
      {[1, 2, 3].map((row) => (
        <MemberRowSkeleton key={row} />
      ))}
    </CardSkeleton>
  );
}

export function JobsSkeleton() {
  return (
    <CardSkeleton described>
      <div className="grid grid-cols-3 gap-2 px-4 py-3">
        {[1, 2, 3].map((cell) => (
          <Skeleton key={cell} className="h-10 w-full" />
        ))}
      </div>
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </CardSkeleton>
  );
}

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
            className="grid gap-2 p-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6"
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
