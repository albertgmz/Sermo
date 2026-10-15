import { useTranslations } from "next-intl";
import {
  HeadingSkeleton,
  LoadingRegion,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("forums.tagPage");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <PageLayout className="pt-2">
        <HeadingSkeleton />
        <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-card">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <ThreadRowSkeleton key={i} />
          ))}
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
