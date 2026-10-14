import { useTranslations } from "next-intl";
import { AuthShellSkeleton } from "@/app/[locale]/(auth)/auth-shell";
import { FormRowSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellSkeleton heading={t("verifyHeading")}>
      <LoadingRegion label={t("verifyLabel")}>
        <div className="space-y-6">
          <Skeleton className="mx-auto h-10 w-full" />
          <div className="space-y-4">
            <FormRowSkeleton />
            <Skeleton className="h-10 w-full md:h-8" />
          </div>
        </div>
      </LoadingRegion>
    </AuthShellSkeleton>
  );
}
