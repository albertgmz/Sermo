import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { LITE_CATEGORIES } from "@/lib/lite-preferences";

function RowSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="flex size-10 shrink-0 items-center justify-center">
        <Skeleton className="size-4" />
      </div>
    </div>
  );
}

export function LiteSettingsSkeleton() {
  const t = useTranslations("lite.settingsForm");
  return (
    <LoadingRegion label={t("loadingLabel")}>
      <section className="rounded-lg border bg-card">
        <div className="space-y-1 border-b p-4">
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <RowSkeleton />
        <div className="border-t px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold">{t("categoriesLabel")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("categoriesDescription")}
          </p>
        </div>
        <div className="divide-y">
          {LITE_CATEGORIES.map(({ key }) => (
            <RowSkeleton key={key} />
          ))}
        </div>
        <div className="border-t p-4">
          <Skeleton className="h-10 w-28" />
        </div>
      </section>
    </LoadingRegion>
  );
}
