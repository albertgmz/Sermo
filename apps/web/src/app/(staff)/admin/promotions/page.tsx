import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { PromotionList } from "./promotion-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotions");
  return { title: t("metaTitle") };
}

export default function PromotionsPage({
  searchParams,
}: PageProps<"/admin/promotions">) {
  const t = useTranslations("adminGroups.promotions");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton formRows={4} />}
    >
      <PromotionList searchParams={searchParams} />
    </ScreenFrame>
  );
}
