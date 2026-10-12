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
            <Skeleton className="h-10 w-full md:h-8" />
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
