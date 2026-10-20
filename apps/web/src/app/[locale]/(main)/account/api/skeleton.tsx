import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

// The key section while the key is read: one key row and the replace line, the common case.
export function KeySkeleton() {
  const t = useTranslations("account.apiKeys.key");
  return (
    <section aria-hidden="true" className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Skeleton className="size-5 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-10 w-20" />
      </div>
      <div className="border-t px-4 py-2">
        <Skeleton className="h-6 w-24" />
      </div>
    </section>
  );
}
