import { shopItemsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Art } from "@/components/forum/art";
import { ShopIcon } from "@/components/forum/shop-icon";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { AddLink } from "../../credits/header-links";
import { one } from "../../credits/shared";
import { deleteItem } from "./actions";
import { effectWords } from "./effect-words";
import { getLookups } from "./lookups";

const PATH = "/admin/shop/items";

// The items of one category (the first when none is chosen) as a paged list, each leading to its
// edit page. The backend pages items by cursor, so "Next" is a link, as in every cursor list.
export async function ShopItemList({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/shop/items">["searchParams"];
}) {
  const [t, effects, format, lookups, params] = await Promise.all([
    getTranslations("adminEconomy.items"),
    getTranslations("adminEconomy.items.effects"),
    getFormatter(),
    getLookups(),
    searchParams,
  ]);
  const { categories } = lookups;
  const wanted = parseId(one(params.category));
  const category =
    categories.find((entry) => entry.id === wanted) ?? categories[0];
  const notices = {
    created: t("notices.created"),
    deleted: t("notices.deleted"),
  };
  if (!category) {
    return (
      <>
        <Notice searchParams={searchParams} notices={notices} />
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("noCategories")}{" "}
          <Link
            href="/admin/shop/categories"
            className="text-primary-ink underline-offset-4 hover:underline"
          >
            {t("toCategories")}
          </Link>
        </p>
      </>
    );
  }
  const page = await call(shopItemsList, {
    categoryId: category.id,
    cursor: cursorFrom(params),
    limit: 25,
  });
  const here = { ...params, category: String(category.id) };
  return (
    <>
      <Notice searchParams={searchParams} notices={notices} />
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      >
        <label className="grid gap-1.5 text-xs font-medium">
          {t("category")}
          <select
            name="category"
            defaultValue={category.id}
            className={`${selectClass} sm:w-56`}
          >
            {categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" className="min-h-10 px-4">
          {t("show")}
        </Button>
      </form>
      <ItemList
        paging={{ path: PATH, params: here, nextCursor: page.nextCursor }}
        label={t("heading")}
        heading={t("heading")}
        empty={{
          title: t("none"),
          description: t("emptyDescription"),
          action: (
            <AddLink href={`${PATH}/new?category=${category.id}`}>
              {t("add")}
            </AddLink>
          ),
        }}
        items={page.items.map((item) => ({
          id: item.id,
          icon: item.image ? (
            <Art
              src={item.image.url}
              category="shop"
              className="size-10 rounded-lg"
            />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-lg border text-muted-foreground">
              <ShopIcon type={item.effect.type} className="size-5" />
            </span>
          ),
          title: item.name,
          href: `${PATH}/${item.id}`,
          description: (
            <>
              <span className="block">
                {effectWords(item.effect, lookups, effects)}
              </span>
              <span className="block">
                {t("facts", {
                  price: format.number(item.price),
                  stock:
                    item.stock === null
                      ? t("unlimited")
                      : format.number(item.stock),
                })}
              </span>
            </>
          ),
          badges: item.isActive ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : (
            <Badge variant="outline">{t("inactive")}</Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`${PATH}/${item.id}`}
                label={t("edit", { name: item.name })}
              />
              <ConfirmStep
                action={deleteItem}
                fields={{ id: item.id }}
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
