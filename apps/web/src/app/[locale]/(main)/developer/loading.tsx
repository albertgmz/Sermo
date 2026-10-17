import { useTranslations } from "next-intl";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("developer.page");
  return (
    <PageLayout className="page-full-width md:pt-8">
      <LoadingRegion label={t("aria.loading")}>
        <div className="flex h-9 items-center">
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="mt-4 mb-6 max-w-prose space-y-6">
          <TextSkeleton />
          {[1, 2, 3].map((item) => (
            <div key={item} className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <TextSkeleton />
            </div>
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </LoadingRegion>
    </PageLayout>
  );
}
