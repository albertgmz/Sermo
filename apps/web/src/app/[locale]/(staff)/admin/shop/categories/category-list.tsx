import { shopCategoriesList } from "@sermo/core/contracts";
import { Package } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getLadder } from "@/app/[locale]/(main)/upgrade/ladder";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { one } from "../../credits/shared";
import { deleteCategory } from "./actions";

type Search = {
  notice?: string | string[];
  edit?: string | string[];
};

// Which category the public upgrade page takes its ranks from, by the site convention the page
// itself uses (`getLadder`).
async function LadderNote() {
  const [t, ladder] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    getLadder(),
  ]);
  return (
    <p className="rounded-lg border bg-card px-4 py-2.5 text-sm text-pretty">
      {ladder
        ? t("ladder", {
            name: ladder.category.name,
            count: ladder.ranks.length,
          })
        : t("noLadder")}{" "}
      <span className="text-muted-foreground">{t("ladderRule")}</span>
    </p>
  );
}

// The categories in display order (the order is changed on the sort page), each with its edit
// page and its items. The address the editor used to open at (`?edit=<id>`) goes to the category's
// own page.
export async function CategoryList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<Search>;
  // The "Add category" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, { items }, params] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    read(shopCategoriesList, {}),
    searchParams,
  ]);
  const editing = parseId(one(params.edit));
  if (editing !== null && items.some((category) => category.id === editing)) {
    redirect(`/admin/shop/categories/${editing}`);
  }
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          ordered: t("notices.ordered"),
          deleted: t("notices.deleted"),
        }}
      />
      <LadderNote />
      <ItemList
        label={t("heading")}
        heading={t("heading")}
        description={t("listHelp")}
        empty={{
          title: t("none"),
          description: t("emptyDescription"),
          action: addAction,
        }}
        items={items.map((category) => ({
          id: category.id,
          title: category.name,
          href: `/admin/shop/categories/${category.id}`,
          description: category.description || undefined,
          badges: category.isActive ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : (
            <Badge variant="outline">{t("inactive")}</Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`/admin/shop/items?category=${category.id}`}
                label={t("items", { name: category.name })}
                icon={<Package />}
              />
              <RowLink
                href={`/admin/shop/categories/${category.id}`}
                label={t("edit", { name: category.name })}
              />
              <ConfirmStep
                action={deleteCategory}
                fields={{ id: category.id }}
                summary={t("deleteShort")}
                submit={t("delete")}
                warning={t("deleteWarning")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}
