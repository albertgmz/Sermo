import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { BatchScreen } from "./batch-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.batch");
  return { title: t("metaTitle") };
}

export default function BatchPage() {
  const t = useTranslations("adminUsers.batch");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={3} />
          </LoadingRegion>
        }
      >
        <BatchScreen />
      </Suspense>
    </div>
  );
}
