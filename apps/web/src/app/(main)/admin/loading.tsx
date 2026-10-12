import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("admin.loading");
  return (
    <LoadingRegion label={t("aria.dashboard")}>
      <h2 className="text-lg font-semibold">{t("dashboardHeading")}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-2 px-4 py-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </CardSkeleton>
        <MemberListSkeleton />
      </div>
    </LoadingRegion>
  );
}
