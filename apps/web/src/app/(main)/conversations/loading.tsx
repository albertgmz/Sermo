import { useTranslations } from "next-intl";
import {
  ConversationListSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("conversations.loading");
  return (
    <LoadingRegion label={t("label")}>
      <PageLayout className="pt-2">
        <div className="flex h-10 items-center md:h-8">
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <Skeleton className="h-10 w-36 md:h-8" />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border bg-card">
          <ConversationListSkeleton />
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
