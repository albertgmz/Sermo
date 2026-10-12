import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  CatalogueSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("awards.loading");
  return (
    <LoadingRegion label={t("label")}>
      <PageHero title={t("heading")} subtitle={t("description")}>
        <Skeleton className="h-10 w-56" />
      </PageHero>
      <PageLayout
        className="pt-0"
        aside={
          <>
            <MemberListSkeleton rows={10} />
            <CardSkeleton>
              <div className="p-4">
                <TextSkeleton />
                <div className="mt-4 grid grid-cols-2 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              </div>
            </CardSkeleton>
          </>
        }
      >
        <CatalogueSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
