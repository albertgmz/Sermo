import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The phone's bottom bar while the visitor's own entries load: six places, the middle button round.
export function MobileNavSkeleton() {
  const t = useTranslations("home.layout");
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      <LoadingRegion label={t("loadingNavigation")}>
        <div
          aria-hidden="true"
          className="mx-auto grid h-14 max-w-lg grid-cols-6"
        >
          {[1, 2, 3, 4, 5, 6].map((item) =>
            item === 4 ? (
              <div key={item} className="flex items-center justify-center">
                <Skeleton className="size-11 rounded-full" />
              </div>
            ) : (
              <div
                key={item}
                className="flex flex-col items-center justify-center gap-1"
              >
                <Skeleton className="size-5" />
                <Skeleton className="h-2.5 w-8" />
              </div>
            ),
          )}
        </div>
      </LoadingRegion>
    </div>
  );
}
