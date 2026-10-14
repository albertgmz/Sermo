import { shopItemsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Art } from "@/components/forum/art";
import { ShopIcon } from "@/components/forum/shop-icon";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { Notice } from "@/components/staff/notice";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { one } from "../../credits/shared";
import { effectWords } from "./effect-words";
import { ItemForm } from "./item-form";
import { getLookups } from "./lookups";

// The items of one category (the first when none is chosen) as a paged list, then the form for a
// new item in that category.
export async function ItemScreen({
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
  return (
    <>
      <Notice searchParams={searchParams} notices={notices} />
      <CursorList
        items={page.items}
        nextCursor={page.nextCursor}
        path="/admin/shop/items"
        params={{ ...params, category: String(category.id) }}
        itemKey={(item) => item.id}
        label={t("heading")}
        filters={
          <form method="get" className="flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-sm font-semibold">{t("heading")}</h2>
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
        }
        empty={{ title: t("none") }}
        render={(item) => (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            {item.image ? (
              <Art
                src={item.image.url}
                category="shop"
                className="size-12 shrink-0 rounded-lg"
              />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border text-muted-foreground">
                <ShopIcon type={item.effect.type} className="size-6" />
              </span>
            )}
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
                {item.name}
                {item.isActive ? (
                  <Badge variant="success">{t("active")}</Badge>
                ) : (
                  <Badge variant="outline">{t("inactive")}</Badge>
                )}
              </span>
              <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {effectWords(item.effect, lookups, effects)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("facts", {
                  price: format.number(item.price),
                  stock:
                    item.stock === null
                      ? t("unlimited")
                      : format.number(item.stock),
                })}
              </span>
            </span>
            <Link
              href={`/admin/shop/items/${item.id}`}
              className="inline-flex min-h-10 min-w-10 items-center justify-center text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
            >
              {t("edit")}
              <span className="sr-only"> {item.name}</span>
            </Link>
          </div>
        )}
      />
      <ItemForm lookups={lookups} categoryId={category.id} />
    </>
  );
}
