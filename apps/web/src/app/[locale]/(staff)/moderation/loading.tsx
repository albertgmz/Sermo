import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeadingSkeleton,
  LinkCardsSkeleton,
  PendingSkeleton,
} from "../skeletons";

export default function Loading() {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <PendingSkeleton />
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <LinkCardsSkeleton />
        </div>
      </div>
    </LoadingRegion>
  );
}
