import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { PromotionList } from "./promotion-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotions");
  return { title: t("metaTitle") };
}

export default function PromotionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/promotions">) {
  const t = useTranslations("adminGroups.promotions");
  const add = <AddLink href="/admin/promotions/new">{t("new")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/promotions")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PromotionList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
