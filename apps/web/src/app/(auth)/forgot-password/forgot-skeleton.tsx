import { useTranslations } from "next-intl";
import { FormRowSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ForgotSkeleton() {
  const t = useTranslations("auth.loading");
  return (
    <LoadingRegion label={t("forgotLabel")}>
      <Skeleton className="mx-auto mb-4 h-10 w-full" />
      <div className="space-y-4">
        <FormRowSkeleton />
        <Skeleton className="h-10 w-full md:h-8" />
      </div>
      <Skeleton className="mx-auto mt-4 h-10 w-28" />
    </LoadingRegion>
  );
}
