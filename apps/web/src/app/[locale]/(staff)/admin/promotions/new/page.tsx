import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { PromotionForm } from "../promotion-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotionNew");
  return { title: t("metaTitle") };
}

export default function NewPromotionPage() {
  const t = useTranslations("adminGroups.promotionNew");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/promotions/new")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <PromotionForm />
    </ScreenFrame>
  );
}
