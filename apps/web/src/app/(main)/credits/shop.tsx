import { shopCategoriesList, shopItemsList } from "@sermo/core/contracts";
import { Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BuyForm } from "@/app/(main)/credits/buy-form";
import { ItemEffect, Lasts } from "@/app/(main)/credits/item-effect";
import { ItemPreview, type Wearer } from "@/app/(main)/credits/item-preview";
import { catalogsFor, type ShopItemData } from "@/app/(main)/credits/items";
import { LoadMore } from "@/app/(main)/credits/load-more";
import { Credits } from "@/components/forum/credits";
import { EmptyState } from "@/components/forum/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

type Viewer = { id: number; username: string } | null;

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
  viewer,
}: {
  category: string;
  cursor?: string;
  viewer: Viewer;
}) {
  const [t, categories] = await Promise.all([
    getTranslations("credits.shop"),
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
  const listing = await read(shopItemsList, {
    categoryId: current.id,
    cursor,
  });
  const items = listing.items.filter(({ isActive }) => isActive);
  const [catalogs, wearer] = await Promise.all([
    catalogsFor(items),
    wearerOf(viewer, t("sampleUsername")),
  ]);
  const returnTo = shopHref(current.id);

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
      {current.description && (
        <p className="max-w-prose text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
          {current.description}
        </p>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={Store}
            title={t("emptyCategoryTitle")}
            description={t("emptyCategoryDescription")}
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              wearer={wearer}
              catalogs={catalogs}
              signedIn={Boolean(viewer)}
              returnTo={returnTo}
            />
          ))}
        </ul>
      )}
      {listing.nextCursor && (
        <LoadMore href={shopHref(current.id, listing.nextCursor)} />
      )}
    </div>
  );
}

async function ItemCard({
  item,
  wearer,
  catalogs,
  signedIn,
  returnTo,
}: {
  item: ShopItemData;
  wearer: Wearer;
  catalogs: Awaited<ReturnType<typeof catalogsFor>>;
  signedIn: boolean;
  returnTo: string;
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
        {signedIn ? (
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
