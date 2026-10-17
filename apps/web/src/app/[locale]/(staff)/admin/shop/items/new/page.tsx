import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { parseId } from "@/lib/sermo/ids";
import { EditFormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { one } from "../../../credits/shared";
import { saveItem } from "../actions";
import { ItemFormFields } from "../item-form";
import { getLookups } from "../lookups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items.new");
  return { title: t("metaTitle") };
}

// A new item starts in the category the list was showing (`?category=`), or the first.
async function NewItem({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/shop/items/new">["searchParams"];
}) {
  const [t, lookups, params] = await Promise.all([
    getTranslations("adminEconomy.items.new"),
    getLookups(),
    searchParams,
  ]);
  return (
    <EditForm action={saveItem} submit={t("submit")}>
      <ItemFormFields
        lookups={lookups}
        categoryId={parseId(one(params.category)) ?? undefined}
      />
    </EditForm>
  );
}

export default function NewItemPage({
  searchParams,
}: PageProps<"/[locale]/admin/shop/items/new">) {
  const t = useTranslations("adminEconomy.items");
  return (
    <ScreenFrame
      heading={t("new.heading")}
      subtitle={t("new.description")}
      trail={staffTrail("/admin/shop/items/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton rows={7} advanced={1} />}
    >
      <NewItem searchParams={searchParams} />
    </ScreenFrame>
  );
}
