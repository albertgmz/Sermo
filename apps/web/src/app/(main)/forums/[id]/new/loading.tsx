import { useTranslations } from "next-intl";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("forums.loading");
  return (
    <LoadingRegion label={t("aria.form")}>
      <PageLayout className="pt-2">
        <div className="flex h-10 items-center md:h-8">
          <Skeleton className="h-3 w-48" />
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <FormRowSkeleton />
            <FormRowSkeleton />
          </div>
          <EditorSkeleton className="min-h-50" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
