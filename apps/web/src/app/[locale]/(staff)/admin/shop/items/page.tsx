import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { parseId } from "@/lib/sermo/ids";
import { staffTrail } from "../../../trail";
import { AddLink } from "../../credits/header-links";
import { one } from "../../credits/shared";
import { ListSkeleton } from "../../groups/skeletons";
import { ShopItemList } from "./shop-item-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items");
  return { title: t("metaTitle") };
}

// The "Add item" link starts the new item in the category being shown.
async function AddItem({
  searchParams,
  label,
}: {
  searchParams: PageProps<"/[locale]/admin/shop/items">["searchParams"];
  label: string;
}) {
  const category = parseId(one((await searchParams).category));
  return (
    <AddLink
      href={
        category === null
          ? "/admin/shop/items/new"
          : `/admin/shop/items/new?category=${category}`
      }
    >
      {label}
    </AddLink>
  );
}

export default function ShopItemsPage({
  searchParams,
}: PageProps<"/[locale]/admin/shop/items">) {
  const t = useTranslations("adminEconomy.items");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/shop/items")}
      actions={
        <Suspense
          fallback={<AddLink href="/admin/shop/items/new">{t("add")}</AddLink>}
        >
          <AddItem searchParams={searchParams} label={t("add")} />
        </Suspense>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <ShopItemList searchParams={searchParams} />
    </ScreenFrame>
  );
}
