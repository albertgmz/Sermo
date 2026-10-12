import { useTranslations } from "next-intl";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export function StaticPageLoading() {
  const t = useTranslations("static.staticPage");
  return (
    <PageLayout
      asideSide="start"
      asideOnMobile="hidden"
      className="md:pt-8"
      aside={
        <div className="border-l">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="flex h-9 items-center pl-4">
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      }
    >
      <LoadingRegion label={t("aria.loading")}>
        <article className="max-w-prose">
          <div className="flex h-9 items-center">
            <Skeleton className="h-7 w-2/3" />
          </div>
          <div className="mt-1 flex h-5 items-center">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="mt-6 space-y-6">
            <TextSkeleton />
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="space-y-3">
                <Skeleton className="h-6 w-40" />
                <TextSkeleton />
              </div>
            ))}
          </div>
        </article>
      </LoadingRegion>
    </PageLayout>
  );
}
