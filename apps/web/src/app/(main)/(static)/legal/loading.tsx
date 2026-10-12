import { useFormatter, useTranslations } from "next-intl";
import { StaticPage } from "@/app/(main)/(static)/static-page";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("static.legalLoading");
  const format = useFormatter();
  return (
    <StaticPage
      href="/legal"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content=""
    >
      <LoadingRegion label={t("aria.loading")}>
        <div className="mt-6 space-y-6">
          <TextSkeleton />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <TextSkeleton />
            </div>
          ))}
        </div>
      </LoadingRegion>
    </StaticPage>
  );
}
