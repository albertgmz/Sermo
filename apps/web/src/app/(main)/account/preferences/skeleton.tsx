import { useTranslations } from "next-intl";
import { SectionSkeleton } from "@/app/(main)/account/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

function WatchListSkeleton({
  heading,
  description,
}: {
  heading: string;
  description: string;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y">
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className="flex flex-wrap items-center gap-3 p-4"
          >
            <div className="min-w-0 flex-1 basis-40 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-10 w-28" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function PreferencesSkeleton() {
  const t = useTranslations("account.preferences");
  return (
    <div className="space-y-4">
      <SectionSkeleton
        heading={t("sectionHeading")}
        description={t("sectionDescription")}
        rows={3}
      />
      <WatchListSkeleton
        heading={t("threadsHeading")}
        description={t("threadsDescription")}
      />
      <WatchListSkeleton
        heading={t("forumsHeading")}
        description={t("forumsDescription")}
      />
    </div>
  );
}
