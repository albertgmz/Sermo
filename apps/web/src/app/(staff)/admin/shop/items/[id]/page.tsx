import { shopItemsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { EconomyNotice } from "../../../credits/shared";
import { FormSkeleton, PageHead } from "../../../groups/skeletons";
import { deleteItem } from "../actions";
import { ItemForm } from "../item-form";
import { getLookups } from "../lookups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items.editPage");
  return { title: t("metaTitle") };
}

async function EditItem({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/shop/items/[id]">["params"];
  searchParams: PageProps<"/admin/shop/items/[id]">["searchParams"];
}) {
  const itemId = parseId((await params).id);
  if (itemId === null) notFound();
  const [t, item, lookups] = await Promise.all([
    getTranslations("adminEconomy.items"),
    read(shopItemsGet, { itemId }),
    getLookups(),
  ]);
  return (
    <>
      <PageHead heading={item.name} subtitle={t("editPage.subtitle")} />
      <EconomyNotice
        searchParams={searchParams}
        shown={{
          saved: t("notices.saved"),
          createdNoPicture: t("notices.createdNoPicture"),
        }}
      />
      <ItemForm item={item} lookups={lookups} />
      <ConfirmStep
        action={deleteItem}
        fields={{ id: item.id }}
        heading={t("deleteHeading")}
        warning={t("deleteWarning")}
        submit={t("delete")}
      />
      <p>
        <Link
          href={`/admin/shop/items?category=${item.categoryId}`}
          className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("back")}
        </Link>
      </p>
    </>
  );
}

export default async function ShopItemPage({
  params,
  searchParams,
}: PageProps<"/admin/shop/items/[id]">) {
  const t = await getTranslations("adminEconomy.items");
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={8} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <EditItem params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
