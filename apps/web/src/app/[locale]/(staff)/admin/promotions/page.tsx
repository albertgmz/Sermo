import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { NewPromotion } from "./new-promotion";
import { PromotionList } from "./promotion-list";

export async function generateMetadata({
  searchParams,
}: PageProps<"/[locale]/admin/promotions">): Promise<Metadata> {
  const creating = (await searchParams).new !== undefined;
  const t = await getTranslations(
    creating ? "adminGroups.promotionNew" : "adminGroups.promotions",
  );
  return { title: t("metaTitle") };
}

export default async function PromotionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/promotions">) {
  if ((await searchParams).new !== undefined) return <NewPromotion />;
  const t = await getTranslations("adminGroups.promotions");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/promotions")}
      actions={
        <Link
          href="/admin/promotions?new=1"
          className={buttonVariants({ className: "min-h-10 px-4" })}
        >
          <Plus aria-hidden="true" />
          {t("new")}
        </Link>
      }
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PromotionList searchParams={searchParams} />
    </ScreenFrame>
  );
}
