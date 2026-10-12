import { useTranslations } from "next-intl";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("conversations.loading.newConversation");
  return (
    <LoadingRegion label={t("label")}>
      <div className="lg:h-full lg:overflow-y-auto">
        <header className="flex min-h-14 items-center gap-1 border-b px-2 py-2 lg:px-4">
          <Skeleton className="size-10 lg:hidden" />
          <h1 className="text-sm font-semibold">{t("heading")}</h1>
        </header>
        <div className="max-w-2xl space-y-5 p-4">
          <div>
            <Skeleton className="mb-2 h-5 w-20" />
            <div className="grid gap-x-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5, 6].map((user) => (
                <div key={user} className="flex h-10 items-center gap-2">
                  <Skeleton className="size-4" />
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
          <FormRowSkeleton />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <EditorSkeleton />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
      </div>
    </LoadingRegion>
  );
}
