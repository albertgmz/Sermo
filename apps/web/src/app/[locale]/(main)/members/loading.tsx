import { useTranslations } from "next-intl";
import {
  LoadingRegion,
  MembersOverviewSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("members.loading");
  return (
    <LoadingRegion label={t("label")}>
      <PageLayout
        aside={
          <div className="space-y-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        }
        asideSide="start"
        asideOnMobile="hidden"
        mainClassName="space-y-(--page-gap)"
      >
        <header>
          <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
          <Skeleton className="mt-1 h-5 w-3/4" />
        </header>
        <div className="lg:hidden">
          <TabsSkeleton />
        </div>
        <MembersOverviewSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
