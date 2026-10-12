import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import {
  heroSubtitleClass,
  heroTitleClass,
} from "@/components/layout/page-hero";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function Loading() {
  const t = useTranslations("upgrade.loading");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <Container className="flex items-center justify-between gap-10 py-12 md:py-20">
        <div className="w-full max-w-xl">
          <h1 className={heroTitleClass}>
            {t.rich("heading", {
              highlight: (chunks) => (
                <span className="text-primary">{chunks}</span>
              ),
              br: () => <br />,
            })}
          </h1>
          <p className={cn("mt-4 max-w-md", heroSubtitleClass)}>
            {t("description")}
          </p>
          <Skeleton className="mt-5 h-20 w-full max-w-md" />
        </div>
        <Skeleton className="hidden size-72 shrink-0 lg:block" />
      </Container>
      <Container className="space-y-12 pb-8">
        <div className="grid gap-6 md:grid-cols-3 md:gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-6 rounded-lg border bg-card p-6">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-12 w-32" />
              <TextSkeleton />
              <div className="space-y-4">
                {[1, 2, 3, 4, 5, 6].map((j) => (
                  <Skeleton key={j} className="h-5 w-full" />
                ))}
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <CardSkeleton>
          <div className="p-4">
            <TextSkeleton />
          </div>
        </CardSkeleton>
        <div className="divide-y rounded-lg border bg-card">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex min-h-12 items-center px-4">
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </Container>
    </LoadingRegion>
  );
}
