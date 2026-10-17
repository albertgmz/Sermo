import { useTranslations } from "next-intl";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("developer.page");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <div className="flex h-9 items-center">
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="mt-4 mb-8">
        <div className="max-w-prose">
          <TextSkeleton />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-3 xl:gap-10">
          {[1, 2, 3].map((item) => (
            <div key={item} className="max-w-prose space-y-3">
              <Skeleton className="h-6 w-40" />
              <TextSkeleton />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-96 w-full" />
    </LoadingRegion>
  );
}
