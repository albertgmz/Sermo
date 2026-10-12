import { useFormatter, useTranslations } from "next-intl";
import { StaticPage } from "@/app/(main)/(static)/static-page";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("static.contactLoading");
  const format = useFormatter();
  return (
    <StaticPage
      href="/contact"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content=""
    >
      <LoadingRegion label={t("aria.loading")}>
        <div className="mt-6 space-y-6">
          <TextSkeleton />
          {[1].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <TextSkeleton />
            </div>
          ))}
          <div className="mt-8 space-y-4 rounded-lg border bg-card p-4">
            <Skeleton className="h-6 w-32" />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRowSkeleton />
              <FormRowSkeleton />
            </div>
            <Skeleton className="h-4 w-20" />
            <EditorSkeleton className="min-h-32" />
            <Skeleton className="h-10 w-16 md:h-8" />
          </div>
        </div>
      </LoadingRegion>
    </StaticPage>
  );
}
