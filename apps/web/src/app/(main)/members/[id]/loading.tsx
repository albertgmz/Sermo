import { useTranslations } from "next-intl";
import {
  FeedSkeleton,
  LoadingRegion,
  ProfileHeaderSkeleton,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("members.profileLoading");
  return (
    <LoadingRegion label={t("label")}>
      <ProfileHeaderSkeleton />
      <Container className="pt-5">
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-2 w-24 sm:w-64 lg:w-96" />
          <Skeleton className="h-3 w-28" />
        </div>
        <TabsSkeleton />
      </Container>
      <PageLayout aside={<SidebarSkeleton />} asideOnMobile="hidden">
        <FeedSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
