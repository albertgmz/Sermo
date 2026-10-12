import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../../groups/skeletons";
import { AdministratorList } from "./administrator-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.administrators");
  return { title: t("metaTitle") };
}

export default function AdministratorsPage() {
  const t = useTranslations("adminGroups.administrators");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton />
          </LoadingRegion>
        }
      >
        <AdministratorList />
      </Suspense>
    </div>
  );
}
