import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadingSkeleton } from "../skeletons";

export { FormSkeleton, ListSkeleton } from "../admin/groups/skeletons";

// The loading file of a route of Moderation and of Tools and logs: a heading placeholder, then
// the given skeletons, each mirroring the block it stands for once settled.
export function LoadingPage({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const t = useTranslations("moderation.common");
  return (
    <LoadingRegion label={label ?? t("loading")}>
      <div className="space-y-6">
        <HeadingSkeleton />
        <div className="space-y-4">{children}</div>
      </div>
    </LoadingRegion>
  );
}

// A panel holding a filter bar and rows with a badge line, an excerpt and a meta line.
export function QueueSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
        <Skeleton className="h-10 w-full md:h-8" />
        <Skeleton className="h-10 w-full md:h-8" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of identical placeholders.
          <div key={row} className="space-y-2 p-4">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

// A panel holding a few lines of text, for the content of a case.
export function ContentSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="border-b p-4">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

// A panel of sign-ups: each row a tick, a name line, a few facts and the two buttons.
export function SignupsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="divide-y">
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of identical placeholders.
          <div key={row} className="flex gap-3 p-4">
            <Skeleton className="mt-1 size-4" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
