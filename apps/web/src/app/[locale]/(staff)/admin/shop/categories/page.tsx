import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink, SortLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { CategoryList } from "./category-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories");
  return { title: t("metaTitle") };
}

export default function ShopCategoriesPage({
  searchParams,
}: PageProps<"/[locale]/admin/shop/categories">) {
  const t = useTranslations("adminEconomy.categories");
  const add = <AddLink href="/admin/shop/categories/new">{t("add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/shop/categories")}
      actions={
        <>
          <SortLink href="/admin/shop/categories/sort">
            {t("sortLink")}
          </SortLink>
          {add}
        </>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <CategoryList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
