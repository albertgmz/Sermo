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
  return (
    <LoadingRegion label="Loading credits…">
      <PageHero
        title="Credits"
        subtitle="Earn credits by taking part in the community and spend them on cosmetics, boosts and permissions in the shop."
      />
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
