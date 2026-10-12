import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadingSkeleton, PendingSkeleton } from "../skeletons";

export default function Loading() {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton />
        <PendingSkeleton />
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
