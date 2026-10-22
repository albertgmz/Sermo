import { useTranslations } from "next-intl";
import { AuthShellLoading } from "@/app/[locale]/(auth)/auth-shell";
import { FormRowSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellLoading page="register">
      <p className="-mt-3 mb-6 text-center text-sm text-muted-foreground md:-mt-5">
        {t("registerDescription")}
      </p>
      <div className="space-y-4">
        <FormRowSkeleton />
        <FormRowSkeleton />
        <FormRowSkeleton />
        <Skeleton className="h-1 w-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-full md:h-8" />
      </div>
      <Skeleton className="mx-auto mt-4 h-10 w-56" />
    </AuthShellLoading>
  );
}
