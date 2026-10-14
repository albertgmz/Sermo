import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

export function PerksSkeleton() {
  const t = useTranslations("account.perks");
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="divide-y">
        {[1, 2, 3, 4, 5].map((perk) => (
          <div
            key={perk}
            aria-hidden="true"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
          >
            <Skeleton className="size-10 shrink-0" />
            <div className="min-w-0 flex-1 basis-48 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
            <div className="basis-full sm:basis-auto">
              <Skeleton className="h-10 w-28" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
