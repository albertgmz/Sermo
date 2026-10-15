import { useTranslations } from "next-intl";
import { ComposerSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("forums.loading");
  return (
    <LoadingRegion label={t("aria.form")}>
      <PageLayout className="pt-2">
        <h1 className="sr-only">{t("heading")}</h1>
        <ComposerSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
