import { useTranslations } from "next-intl";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("conversations.loading.newConversation");
  return (
    <LoadingRegion label={t("label")}>
      <PageLayout className="pt-2">
        <div className="flex h-10 items-center md:h-8">
          <Skeleton className="h-3 w-48" />
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <div className="mt-4 space-y-5">
          <div>
            <Skeleton className="mb-2 h-5 w-20" />
            <Skeleton className="h-10 w-full md:h-8" />
          </div>
          <FormRowSkeleton />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <EditorSkeleton />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
