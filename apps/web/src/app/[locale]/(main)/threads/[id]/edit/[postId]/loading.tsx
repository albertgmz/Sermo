import { useTranslations } from "next-intl";
import {
  EditorSkeleton,
  FormRowSkeleton,
  HeadingSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("threads.editLoading");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <PageLayout className="pt-2">
        <HeadingSkeleton />
        <div className="mt-4 space-y-4">
          <EditorSkeleton minHeight={200} />
          <FormRowSkeleton />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
