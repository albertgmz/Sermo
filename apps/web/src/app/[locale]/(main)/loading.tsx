import { useTranslations } from "next-intl";
import {
  ForumCategoriesSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

// The forum list's own parts; the widgets around it are the visitor's, so they are not known yet.
export default function Loading() {
  const t = useTranslations("forums.loading");
  return (
    <LoadingRegion label={t("aria.forums")}>
      <PageLayout mainClassName="space-y-(--page-gap)">
        <TabsSkeleton />
        <ForumCategoriesSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
