import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { FormSkeleton, ResultsSkeleton } from "./skeletons";

export default function Loading() {
  const t = useTranslations("search.loading");
  return (
    <LoadingRegion label={t("label")}>
      <PageLayout mainClassName="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <FormSkeleton />
        <ResultsSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
