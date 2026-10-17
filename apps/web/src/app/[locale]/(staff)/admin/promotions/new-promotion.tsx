import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { FormSkeleton } from "../groups/skeletons";
import { PromotionForm } from "./promotion-form";

// The page for a new promotion, at `/admin/promotions?new=1`: the list's own address, as the
// registry has no screen of its own for it. The way up ends in the list.
export async function NewPromotion() {
  const [t, list] = await Promise.all([
    getTranslations("adminGroups.promotionNew"),
    getTranslations("adminGroups.promotions"),
  ]);
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/promotions").then((crumbs) => [
        ...crumbs,
        { href: "/admin/promotions", label: list("pageHeading") },
      ])}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <PromotionForm />
    </ScreenFrame>
  );
}
