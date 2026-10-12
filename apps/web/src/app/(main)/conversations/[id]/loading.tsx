import { useTranslations } from "next-intl";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("conversations.loading.conversation");
  return (
    <LoadingRegion label={t("label")}>
      <div className="flex min-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] flex-col md:min-h-[calc(100dvh-3.5rem)] lg:h-full lg:min-h-0">
        <div className="flex min-h-14 items-center gap-3 border-b px-4 py-2">
          <Skeleton className="size-10 lg:hidden" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex-1 space-y-4 px-4 py-4 lg:overflow-y-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-4 w-32" />
                <TextSkeleton />
              </div>
            </div>
          ))}
        </div>
        <div className="sticky bottom-(--spacing-mobile-nav) border-t bg-background p-2 md:bottom-0 lg:static lg:bg-transparent lg:p-3">
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </LoadingRegion>
  );
}
