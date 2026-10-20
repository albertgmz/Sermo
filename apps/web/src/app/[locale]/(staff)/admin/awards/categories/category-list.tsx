import { awardCategoriesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { AddLink, SortLink } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { deleteAwardCategory } from "./actions";

// The award categories in the order the awards page shows them (changed on the sort page), each
// leading to its edit page. Deleting one that holds awards leaves them without a category.
export async function AwardCategoryList({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/awards">["searchParams"];
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminEconomy.awardCategories"),
    read(awardCategoriesList, {}),
  ]);
  const add = (
    <AddLink href="/admin/awards/categories/new" secondary>
      {t("add")}
    </AddLink>
  );
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          categoryCreated: t("notices.created"),
          categorySaved: t("notices.saved"),
          categoryOrdered: t("notices.ordered"),
          categoryDeleted: t("notices.deleted"),
        }}
      />
      <ItemList
        label={t("heading")}
        heading={t("heading")}
        description={t("description")}
        action={
          items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {items.length > 1 && (
                <SortLink href="/admin/awards/categories/sort">
                  {t("sortLink")}
                </SortLink>
              )}
              {add}
            </div>
          )
        }
        empty={{
          title: t("none"),
          description: t("emptyDescription"),
          action: add,
        }}
        items={items.map((category) => ({
          id: category.id,
          title: category.title,
          href: `/admin/awards/categories/${category.id}`,
          description: category.description || undefined,
          badges: (
            <Badge variant="secondary">
              {t("count", { count: category.awardCount })}
            </Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`/admin/awards/categories/${category.id}`}
                label={t("edit", { title: category.title })}
              />
              <ConfirmStep
                action={deleteAwardCategory}
                fields={{ id: category.id }}
                summary={t("deleteShort")}
                submit={t("delete")}
                warning={t("deleteWarning", { count: category.awardCount })}
              />
            </>
          ),
        }))}
      />
    </>
  );
}
