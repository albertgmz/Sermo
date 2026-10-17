import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadingSkeleton } from "../../skeletons";

// The new and the edit page as they settle: the reaction's card of fields, the two closed cards
// (animation, access) and the save bar.
export function ReactionFormSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="space-y-2 border-b p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="divide-y">
          {[1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="grid gap-2 p-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full md:h-8" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="rounded-lg border p-4">
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

// The loading file of the new and the edit page.
export function ReactionFormLoading() {
  const t = useTranslations("adminContent.reactions");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <ReactionFormSkeleton />
      </div>
    </LoadingRegion>
  );
}
