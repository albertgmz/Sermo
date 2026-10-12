import { useTranslations } from "next-intl";
import {
  HeadingSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("home.loading");
  return (
    <PageLayout>
      <LoadingRegion label={t("page")}>
        <HeadingSkeleton />
        <div className="mt-6">
          <TextSkeleton />
        </div>
      </LoadingRegion>
    </PageLayout>
  );
}
