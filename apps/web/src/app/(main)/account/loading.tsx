import { useTranslations } from "next-intl";
import {
  AccountActivitySkeleton,
  AccountDetailsSkeleton,
} from "@/app/(main)/account/overview-skeletons";
import { LoadingRegion, StatTileSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("account.loading");
  return (
    <LoadingRegion label={t("overviewLabel")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 lg:pb-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("overviewHeading")}
          </h1>
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <StatTileSkeleton key={i} />
          ))}
        </div>
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <AccountDetailsSkeleton />
          <AccountActivitySkeleton />
        </div>
      </div>
    </LoadingRegion>
  );
}
