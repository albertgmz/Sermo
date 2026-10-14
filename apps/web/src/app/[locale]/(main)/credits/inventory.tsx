import {
  appearanceGet,
  shopInventory,
  threadsByAuthor,
} from "@sermo/core/contracts";
import { Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ItemEffect } from "@/app/[locale]/(main)/credits/item-effect";
import {
  ItemPreview,
  type Wearer,
} from "@/app/[locale]/(main)/credits/item-preview";
import { catalogsFor } from "@/app/[locale]/(main)/credits/items";
import { UseForm } from "@/app/[locale]/(main)/credits/use-form";
import { WearForm } from "@/app/[locale]/(main)/credits/wear-form";
import { EmptyState } from "@/components/forum/empty-state";
import { LoadMore } from "@/components/forum/load-more";
import { SectionCard } from "@/components/forum/section-card";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

type Entry = z.output<typeof shopInventory.output>["items"][number];
type Appearance = z.output<typeof appearanceGet.output>;
type Cursors = { active?: string; unused?: string; threads?: string };
type ThreadOption = { value: string; label: string };

export function inventoryHref(cursors: Cursors) {
  const params = new URLSearchParams({ tab: "inventory" });
  for (const [name, cursor] of Object.entries(cursors)) {
    if (cursor) params.set(name, cursor);
  }
  return `/credits?${params}`;
}

// The effects that are used on a thread of the member.
const ON_THREADS = ["threadCover", "highlight", "bump"];

function Held({ label }: { label: string }) {
  return <p className="text-xs font-medium text-success">{label}</p>;
}

// What the member can do with an entry follows from its effect; the backend refuses what is not
// allowed.
export async function Control({
  entry,
  appearance,
  threads,
  returnTo,
}: {
  entry: Entry;
  appearance: Appearance;
  threads: ThreadOption[];
  returnTo: string;
}) {
  const t = await getTranslations("credits.inventory");
  const { item } = entry;
  const { effect } = item;
  switch (effect.type) {
    case "frame":
      return (
        <WearForm
          look="frameId"
          catalogId={effect.frameId}
          worn={appearance.frameId === effect.frameId}
          itemName={item.name}
          returnTo={returnTo}
        />
      );
    case "nameColor":
      return (
        <WearForm
          look="nameColorId"
          catalogId={effect.colorId}
          worn={appearance.nameColorId === effect.colorId}
          itemName={item.name}
          returnTo={returnTo}
        />
      );
    case "nameIcon":
      return (
        <WearForm
          look="nameIconItemId"
          catalogId={item.id}
          worn={appearance.nameIconItemId === item.id}
          itemName={item.name}
          returnTo={returnTo}
        />
      );
    case "threadCover":
    case "highlight":
    case "bump":
      if (threads.length === 0) {
        return (
          <p className="basis-full text-sm text-muted-foreground">
            {t("noThreads")}
          </p>
        );
      }
      return (
        <UseForm
          inventoryId={entry.id}
          itemName={item.name}
          returnTo={returnTo}
          threads={threads}
        />
      );
    case "permission":
      if (item.isConsumable) {
        return (
          <UseForm
            inventoryId={entry.id}
            itemName={item.name}
            returnTo={returnTo}
            threads={null}
          />
        );
      }
      return <Held label={t("inEffect")} />;
    case "usernameChange":
      return (
        <Link
          href="/account"
          aria-label={t("aria.changeUsername", { itemName: item.name })}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 basis-full px-4 sm:basis-auto md:h-8 md:px-3",
          )}
        >
          {t("changeUsername")}
        </Link>
      );
    case "group":
      return <Held label={t("inEffect")} />;
  }
}

async function Rows({
  title,
  description,
  list,
  more,
  appearance,
  wearer,
  threads,
  returnTo,
}: {
  title: string;
  description: string;
  list: { items: Entry[]; nextCursor: string | null };
  more: string | null;
  appearance: Appearance;
  wearer: Wearer;
  threads: ThreadOption[];
  returnTo: string;
}) {
  const [t, loadMore] = await Promise.all([
    getTranslations("credits.inventory"),
    getTranslations("credits.loadMore"),
  ]);
  const catalogs = await catalogsFor(list.items.map(({ item }) => item));
  return (
    <SectionCard title={title} description={description}>
      <ul className="divide-y divide-border">
        {list.items.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
          >
            <ItemPreview
              item={entry.item}
              catalogs={catalogs}
              wearer={wearer}
              size="thumb"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                {entry.item.name}
                {entry.item.isConsumable && (
                  <span className="font-medium text-muted-foreground tabular-nums">
                    {" "}
                    {t("unitsLeft", { count: formatNumber(entry.quantity) })}
                  </span>
                )}
              </p>
              <p className="text-xs text-pretty [overflow-wrap:anywhere]">
                <ItemEffect item={entry.item} catalogs={catalogs} />
              </p>
              <p className="text-xs text-muted-foreground">
                {t("acquired", { date: formatDate(entry.acquiredAt) })}
                {entry.expiresAt && (
                  <>
                    <span aria-hidden="true"> · </span>
                    {t("expires", { date: formatDate(entry.expiresAt) })}
                  </>
                )}
              </p>
            </div>
            <Control
              entry={entry}
              appearance={appearance}
              threads={threads}
              returnTo={returnTo}
            />
          </li>
        ))}
      </ul>
      {more && (
        <div className="p-3">
          <LoadMore href={more}>{loadMore("label")}</LoadMore>
        </div>
      )}
    </SectionCard>
  );
}

const pagerLink =
  "relative font-medium text-foreground underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-2.5 hover:underline";

// What the member owns: items in effect and consumables with units left.
export async function Inventory({
  viewer,
  cursors,
}: {
  viewer: { id: number; username: string };
  cursors: Cursors;
}) {
  const t = await getTranslations("credits.inventory");
  const [active, unused, appearance, member] = await Promise.all([
    read(shopInventory, { state: "active", cursor: cursors.active }),
    read(shopInventory, { state: "unused", cursor: cursors.unused }),
    read(appearanceGet, {}),
    membersFor([viewer]),
  ]);
  const entries = [...active.items, ...unused.items];
  if (entries.length === 0) {
    return (
      <SectionCard title={t("heading")}>
        <EmptyState
          icon={Package}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        >
          <Link
            href="/credits"
            className={cn(buttonVariants(), "h-10 px-4 md:h-8 md:px-3")}
          >
            {t("browseShop")}
          </Link>
        </EmptyState>
      </SectionCard>
    );
  }

  // The member's own threads, for the items that act on one.
  const own = entries.some(({ item }) => ON_THREADS.includes(item.effect.type))
    ? await read(threadsByAuthor, {
        userId: viewer.id,
        cursor: cursors.threads,
        limit: 30,
      })
    : null;
  const threads = (own?.items ?? []).map((thread) => ({
    value: String(thread.id),
    label: thread.cover
      ? t("coveredThread", { title: thread.title })
      : thread.title,
  }));
  // Back to the page of the lists the member was on.
  const shared = {
    appearance,
    wearer: member(viewer.id),
    threads,
    returnTo: inventoryHref(cursors),
  };

  return (
    <div className="space-y-4">
      {active.items.length > 0 && (
        <Rows
          title={t("activeHeading")}
          description={t("activeDescription")}
          list={active}
          more={
            active.nextCursor
              ? inventoryHref({ ...cursors, active: active.nextCursor })
              : null
          }
          {...shared}
        />
      )}
      {unused.items.length > 0 && (
        <Rows
          title={t("unusedHeading")}
          description={t("unusedDescription")}
          list={unused}
          more={
            unused.nextCursor
              ? inventoryHref({ ...cursors, unused: unused.nextCursor })
              : null
          }
          {...shared}
        />
      )}
      {own && (own.nextCursor || cursors.threads) && (
        <p className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
          {own.nextCursor && (
            <Link
              href={inventoryHref({ ...cursors, threads: own.nextCursor })}
              scroll={false}
              className={pagerLink}
            >
              {t("olderThreads")}
            </Link>
          )}
          {cursors.threads && (
            <Link
              href={inventoryHref({ ...cursors, threads: undefined })}
              scroll={false}
              className={pagerLink}
            >
              {t("newestThreads")}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
