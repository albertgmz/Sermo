import { shopCategoriesList, shopItemsList } from "@sermo/core/contracts";
import { Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BuyForm } from "@/app/[locale]/(main)/credits/buy-form";
import { ItemEffect, Lasts } from "@/app/[locale]/(main)/credits/item-effect";
import {
  ItemPreview,
  type Wearer,
} from "@/app/[locale]/(main)/credits/item-preview";
import {
  catalogsFor,
  type ShopItemData,
} from "@/app/[locale]/(main)/credits/items";
import { moreShop } from "@/app/[locale]/(main)/credits/more-shop";
import { getLadder } from "@/app/[locale]/(main)/upgrade/ladder";
import { Credits } from "@/components/forum/credits";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import { buttonVariants } from "@/components/ui/button";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

export type Viewer = { id: number; username: string } | null;

function shopHref(categoryId: number, cursor?: string) {
  const params = new URLSearchParams({ category: String(categoryId) });
  if (cursor) params.set("cursor", cursor);
  return `/credits?${params}`;
}

async function wearerOf(viewer: Viewer, sample: string): Promise<Wearer> {
  if (!viewer) {
    return { username: sample, avatar: null, frame: null, nameColor: null };
  }
  return (await membersFor([viewer]))(viewer.id);
}

// The shop: the backend's active categories in its order, and the items of the one asked for.
export async function Shop({
  category,
  cursor,
  pages = 1,
  viewer,
}: {
  category: string;
  cursor?: string;
  // How many pages the address asks for (`?pages=N`, the list's place).
  pages?: number;
  viewer: Viewer;
}) {
  const [t, loadMore, categories] = await Promise.all([
    getTranslations("credits.shop"),
    getTranslations("credits.loadMore"),
    read(shopCategoriesList, {}),
  ]);
  const active = categories.items.filter(({ isActive }) => isActive);
  const current = active.find(({ id }) => String(id) === category) ?? active[0];
  if (!current) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon={Store}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }
  const first = await shopPage(current.id, cursor, viewer);

  return (
    <div className="space-y-4">
      <nav
        aria-label={t("aria.categories")}
        className="relative -mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0"
      >
        {active.map((entry) => (
          <Link
            key={entry.id}
            href={shopHref(entry.id)}
            scroll={false}
            aria-current={entry.id === current.id ? "page" : undefined}
            className="inline-flex h-10 shrink-0 items-center rounded-md border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary/50 aria-[current=page]:bg-primary/10 aria-[current=page]:text-foreground"
          >
            {entry.name}
          </Link>
        ))}
      </nav>
      <div data-switch-panel="" className="space-y-4">
        {current.description && (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
            {current.description}
          </p>
        )}
        {first.rows.length === 0 && !first.nextCursor ? (
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={Store}
              title={t("emptyCategoryTitle")}
              description={t("emptyCategoryDescription")}
            />
          </div>
        ) : (
          <PagedList
            first={first}
            more={moreShop.bind(null, current.id)}
            pages={pages}
            start={cursor}
            listKey={["shop", current.id]}
            hrefBase={shopHref(current.id)}
            moreLabel={loadMore("label")}
            // One row is a page of cards: about 1500 px in three columns.
            estimateSize={1500}
            spacing="spaced"
          />
        )}
      </div>
    </div>
  );
}

// One page of a category's items, as one row of the shop's list (the grid of their cards): the
// page the shop opens at, and each page "Load more" puts under it in place (`moreShop`).
export async function shopPage(
  categoryId: number,
  cursor: string | undefined,
  viewer: Viewer,
  reader: typeof read = read,
): Promise<ListPage> {
  const [t, listing] = await Promise.all([
    getTranslations("credits.shop"),
    reader(shopItemsList, { categoryId, cursor }),
  ]);
  const items = listing.items.filter(({ isActive }) => isActive);
  // The ranks are bought on /upgrade, where the price already paid for one is taken off the
  // next. Only a category with a group item can be (part of) the ladder.
  const [catalogs, wearer, ladder] = await Promise.all([
    catalogsFor(items),
    wearerOf(viewer, t("sampleUsername")),
    items.some(({ effect }) => effect.type === "group") ? getLadder() : null,
  ]);
  const returnTo = shopHref(categoryId, cursor);
  return {
    nextCursor: listing.nextCursor,
    rows:
      items.length === 0
        ? []
        : [
            {
              key: cursor ?? "",
              node: (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      wearer={wearer}
                      catalogs={catalogs}
                      signedIn={Boolean(viewer)}
                      returnTo={returnTo}
                      ranked={
                        item.effect.type === "group" &&
                        item.categoryId === ladder?.category.id
                      }
                    />
                  ))}
                </ul>
              ),
            },
          ],
  };
}

async function ItemCard({
  item,
  wearer,
  catalogs,
  signedIn,
  returnTo,
  ranked,
}: {
  item: ShopItemData;
  wearer: Wearer;
  catalogs: Awaited<ReturnType<typeof catalogsFor>>;
  signedIn: boolean;
  returnTo: string;
  // A rank of the ladder: bought on /upgrade, never here.
  ranked: boolean;
}) {
  const t = await getTranslations("credits.shop");
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <ItemPreview item={item} catalogs={catalogs} wearer={wearer} />
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex-1 space-y-1">
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
            {item.name}
          </h3>
          {item.description && (
            <p className="text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
              {item.description}
            </p>
          )}
          {item.effect.type !== "group" && (
            <p className="text-xs font-medium text-pretty [overflow-wrap:anywhere]">
              <ItemEffect item={item} catalogs={catalogs} />
            </p>
          )}
        </div>
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Credits value={item.price} className="text-base" />
          <p className="text-xs text-muted-foreground">
            {item.stock !== null && (
              <span>{t("stock", { count: item.stock })}</span>
            )}
            {item.stock !== null && item.durationSeconds !== null && (
              <span aria-hidden="true"> · </span>
            )}
            {item.durationSeconds !== null && (
              <Lasts seconds={item.durationSeconds} />
            )}
          </p>
        </div>
        {ranked ? (
          <Link
            href="/upgrade"
            aria-label={t("aria.ranks", { itemName: item.name })}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 w-full",
            )}
          >
            {t("ranks")}
          </Link>
        ) : signedIn ? (
          <BuyForm
            itemId={item.id}
            itemName={item.name}
            returnTo={returnTo}
            quantity={item.isConsumable}
            left={item.stock}
          />
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(returnTo)}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 w-full",
            )}
          >
            {t("loginToBuy")}
          </Link>
        )}
      </div>
    </li>
  );
}
