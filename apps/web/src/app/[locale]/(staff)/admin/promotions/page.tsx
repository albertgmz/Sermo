import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { PromotionList } from "./promotion-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotions");
  return { title: t("metaTitle") };
}

export default function PromotionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/promotions">) {
  const t = useTranslations("adminGroups.promotions");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/promotions")}
      actions={
        <Link
          href="/admin/promotions/new"
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
