import { useTranslations } from "next-intl";
import { CardSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("admin.loading");
  return (
    <LoadingRegion label={t("aria.forums")}>
      <h2 className="text-lg font-semibold">{t("forumsHeading")}</h2>
      {[1, 2].map((i) => (
        <CardSkeleton key={i}>
          {[1, 2, 3].map((j) => (
            <div key={j} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex h-10 items-center">
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-10 w-16" />
            </div>
          ))}
        </CardSkeleton>
      ))}
    </LoadingRegion>
  );
}
