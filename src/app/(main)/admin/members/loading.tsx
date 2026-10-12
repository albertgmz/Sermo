import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  LoadingRegion,
  MemberRowSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("admin.loading");
  return (
    <LoadingRegion label={t("aria.members")}>
      <CardSkeleton>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((row) => (
          <div key={row} className="py-1">
            <MemberRowSkeleton />
            <div className="px-4 pb-3">
              <Skeleton className="h-4 w-48 max-w-full" />
            </div>
          </div>
        ))}
      </CardSkeleton>
      <Skeleton className="h-10 w-32" />
    </LoadingRegion>
  );
}
