import { useTranslations } from "next-intl";
import {
  FeedSkeleton,
  LoadingRegion,
  SidebarSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

// The placeholder of the wall, under the header of the layout, which stays on screen: the list
// beside the profile's cards.
export default function Loading() {
  const t = useTranslations("members.profile");
  return (
    <LoadingRegion label={t("loadingActivity")}>
      <PageLayout aside={<SidebarSkeleton />} asideOnMobile="hidden">
        <FeedSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
