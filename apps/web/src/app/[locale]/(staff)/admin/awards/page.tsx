import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { AwardList } from "./award-list";
import { AwardCategoryList } from "./categories/category-list";
import { RebuildAwards } from "./rebuild-awards";
import { RevokeUnqualified } from "./revoke-unqualified";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awards");
  return { title: t("metaTitle") };
}

export default function AwardsPage({
  searchParams,
}: PageProps<"/[locale]/admin/awards">) {
  const t = useTranslations("adminEconomy.awards");
  const add = <AddLink href="/admin/awards/new">{t("add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/awards")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <AwardCategoryList searchParams={searchParams} />
      <AwardList searchParams={searchParams} addAction={add} />
      <RevokeUnqualified />
      <RebuildAwards />
    </ScreenFrame>
  );
}
