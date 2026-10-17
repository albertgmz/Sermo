import { shopItemsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm } from "@/components/staff/edit-form";
import { Notice } from "@/components/staff/notice";
import { PageHeader } from "@/components/staff/page-header";
import { StreamedPanel } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../../../trail";
import { EditFormSkeleton } from "../../../credits/skeletons";
import { deleteItem, saveItem } from "../actions";
import { ItemFormFields } from "../item-form";
import { getLookups } from "../lookups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items.editPage");
  return { title: t("metaTitle") };
}

async function EditItem({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/shop/items/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/shop/items/[id]">["searchParams"];
}) {
  const itemId = parseId((await params).id);
  if (itemId === null) notFound();
  const [t, item, lookups] = await Promise.all([
    getTranslations("adminEconomy.items"),
    read(shopItemsGet, { itemId }),
    getLookups(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail(`/admin/shop/items/${item.id}`)}
        title={item.name}
        description={t("editPage.subtitle")}
        actions={
          <Link
            href={`/admin/shop/items?category=${item.categoryId}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 px-4 md:h-8 md:px-3",
            )}
          >
            {t("back")}
          </Link>
        }
      />
      <div className="space-y-4">
        <Notice
          searchParams={searchParams}
          notices={{
            saved: t("notices.saved"),
            createdNoPicture: t("notices.createdNoPicture"),
          }}
        />
        <EditForm action={saveItem}>
          <ItemFormFields item={item} lookups={lookups} />
        </EditForm>
        <ConfirmStep
          action={deleteItem}
          fields={{ id: item.id }}
          heading={t("deleteHeading")}
          warning={t("deleteWarning")}
          submit={t("delete")}
        />
      </div>
    </div>
  );
}

export default function ShopItemPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/shop/items/[id]">) {
  const t = useTranslations("adminEconomy.items");
  return (
    <StreamedPanel
      label={t("loading")}
      fallback={<EditFormSkeleton heading rows={7} advanced />}
    >
      <EditItem params={params} searchParams={searchParams} />
    </StreamedPanel>
  );
}
