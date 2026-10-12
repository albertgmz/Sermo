import { useTranslations } from "next-intl";
import { FormRowSkeleton, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function AccountDetailsSkeleton() {
  const t = useTranslations("account.overviewSkeletons");
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("detailsHeading")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("detailsDescription")}
        </p>
      </div>
      <div className="divide-y">
        {[1, 2].map((row) => (
          <div key={row} className="space-y-2 p-4">
            <FormRowSkeleton />
            <TextSkeleton />
          </div>
        ))}
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-28" />
      </div>
    </section>
  );
}

export function AccountActivitySkeleton() {
  const t = useTranslations("account.overviewSkeletons");
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{t("activityHeading")}</h2>
      <p className="text-xs text-muted-foreground">
        {t("activityDescription")}
      </p>
      <div className="mt-3 divide-y">
        {[1, 2, 3, 4, 5, 6].map((row) => (
          <div key={row} className="space-y-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}
