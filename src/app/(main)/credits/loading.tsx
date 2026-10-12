import { useTranslations } from "next-intl";
import {
  BalanceSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  ShopSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("credits.loading");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <PageHero title={t("title")} subtitle={t("subtitle")} />
      <Container>
        <BalanceSkeleton />
      </Container>
      <PageLayout
        className="pt-6"
        mainClassName="space-y-4"
        aside={<MemberListSkeleton rows={10} />}
      >
        <TabsSkeleton />
        <ShopSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
