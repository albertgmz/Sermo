import { useTranslations } from "next-intl";
import { FormRowSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ResetSkeleton() {
  const t = useTranslations("auth.loading");
  return (
    <LoadingRegion label={t("resetLabel")}>
      <Skeleton className="mx-auto mb-4 h-5 w-64 max-w-full" />
      <div className="space-y-4">
        <div className="space-y-2">
          <FormRowSkeleton />
          <Skeleton className="h-1 w-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
        <FormRowSkeleton />
        <Skeleton className="h-10 w-full md:h-8" />
      </div>
    </LoadingRegion>
  );
}
