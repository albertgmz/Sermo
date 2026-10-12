import { useTranslations } from "next-intl";
import {
  CatalogueSkeleton,
  LoadingRegion,
  MemberListSkeleton,
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
      <PageLayout className="pt-0" aside={<MemberListSkeleton rows={10} />}>
        <CatalogueSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
