import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../groups/skeletons";
import { BanList } from "./ban-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.bans");
  return { title: t("metaTitle") };
}

export default function BansPage({
  searchParams,
}: PageProps<"/[locale]/admin/bans">) {
  const t = useTranslations("adminUsers.bans");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={6} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <BanList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
