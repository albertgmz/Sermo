import { useTranslations } from "next-intl";
import { MessagesSkeleton } from "@/app/(main)/conversations/[id]/messages-skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("conversations.loading.conversation");
  return (
    <LoadingRegion label={t("label")}>
      <PageLayout
        className="pt-2"
        asideOnMobile="hidden"
        aside={
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <Skeleton className="h-4 w-24" />
            </div>
            {[1, 2, 3].map((item) => (
              <div key={item} className="flex min-h-12 items-center gap-3 px-4">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        }
      >
        <div className="flex h-10 items-center md:h-8">
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="mt-1 flex items-start gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="ml-auto h-10 w-20" />
        </div>
        <div className="mt-4">
          <MessagesSkeleton />
        </div>
        <Skeleton className="mt-4 h-40 w-full" />
      </PageLayout>
    </LoadingRegion>
  );
}
