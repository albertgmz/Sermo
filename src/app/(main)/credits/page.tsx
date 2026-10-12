import { Check, Coins, Package, Plus, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BoostForm } from "@/app/(main)/credits/boost-form";
import { BuyForm } from "@/app/(main)/credits/buy-form";
import { EquipForm } from "@/app/(main)/credits/equip-form";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { Credits } from "@/components/forum/credits";
import { EmptyState } from "@/components/forum/empty-state";
import { Leaderboard } from "@/components/forum/leaderboard";
import { PermissionIcon } from "@/components/forum/permission-icon";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { ShopIcon } from "@/components/forum/shop-icon";
import { Signature } from "@/components/forum/signature";
import {
  BalanceSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  ShopSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { userNameClass } from "@/components/forum/user-name";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { COVERS, coverSrc, nameColor } from "@/lib/appearance";
import {
  getLeaderboard,
  getOwnedItems,
  getPermissions,
  getShopItems,
  getTransactions,
  getUserThreads,
  type InventoryItemView,
  type OwnedItems,
  type PermissionView,
  type ThreadView,
  type UserView,
} from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { AWARD_SLOTS, PERMISSIONS } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import type {
  Appearance,
  ShopCategory,
  ShopEffect,
  ShopItem,
  Transaction,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("credits.credits");
  return { title: t("metaTitle") };
}

type Query = Partial<
  Record<
    "tab" | "category" | "tier" | "show" | "applied" | "thread",
    string | string[]
  >
>;

type Props = {
  searchParams: Promise<Query>;
};

const TABS = ["shop", "inventory", "history"] as const;
type Tab = (typeof TABS)[number];

const CATEGORIES = [
  {
    value: "frame",
    label: "categories.frameLabel",
    blurb: "categories.frameDescription",
  },
  {
    value: "color",
    label: "categories.colorLabel",
    blurb: "categories.colorDescription",
  },
  {
    value: "threadCover",
    label: "categories.threadCoverLabel",
    blurb: "categories.threadCoverDescription",
  },
  {
    value: "boost",
    label: "categories.boostLabel",
    blurb: "categories.boostDescription",
  },
  {
    value: "permission",
    label: "categories.permissionLabel",
    blurb: "categories.permissionDescription",
  },
] as const satisfies { value: ShopCategory; label: string; blurb: string }[];

const FRAMES_PER_PAGE = 24;

const WAYS_TO_EARN = [
  "activity",
  "posts",
  "reactions",
  "streak",
  "awards",
  "referrals",
] as const;

const actionClass = "h-10 px-4 md:h-8 md:px-3";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function shopHref(category: ShopCategory, tier?: number, show?: number) {
  const params = new URLSearchParams({ category });
  if (tier) params.set("tier", String(tier));
  if (show) params.set("show", String(show));
  return `/credits?${params}`;
}

function isEquipped(effect: ShopEffect, appearance: Appearance) {
  switch (effect.type) {
    case "frame":
      return appearance.frame === effect.frame;
    case "nameColor":
      return appearance.nameColor === effect.color;
    default:
      return false;
  }
}

function Balance({ viewer }: { viewer: UserView | null }) {
  const t = useTranslations("credits.credits");
  return (
    <section
      aria-labelledby="balance-title"
      className="grid overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <div className="p-4 md:p-6">
        <h2 id="balance-title" className="text-sm font-semibold">
          {t("balanceHeading")}
        </h2>
        {viewer ? (
          <>
            <p className="mt-3 flex items-center gap-3 text-5xl leading-none font-bold tracking-tighter tabular-nums">
              <Coins
                aria-hidden="true"
                className="size-9 shrink-0 text-primary"
              />
              {formatNumber(viewer.credits)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("balanceDescription")}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
              {t("loginDescription")}
            </p>
            <Link
              href="/login"
              className={cn(buttonVariants(), actionClass, "mt-4")}
            >
              {t("login")}
            </Link>
          </>
        )}
      </div>
      <div className="border-t p-4 md:border-t-0 md:border-l md:p-6">
        <h3 className="text-sm font-semibold">{t("earnHeading")}</h3>
        <ul className="mt-3 grid gap-x-6 gap-y-2 text-sm text-muted-foreground sm:grid-cols-2">
          {WAYS_TO_EARN.map((way) => (
            <li key={way} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-primary"
              />
              {t(`waysToEarn.${way}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ChipNav({
  label,
  chips,
  active,
}: {
  label: string;
  chips: {
    value: string;
    label: React.ReactNode;
    href: string;
    count: number;
  }[];
  active: string;
}) {
  return (
    <nav
      aria-label={label}
      className="relative -mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0"
    >
      {chips.map((chip) => (
        <Link
          key={chip.value}
          href={chip.href}
          scroll={false}
          aria-current={chip.value === active ? "page" : undefined}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary/50 aria-[current=page]:bg-primary/10 aria-[current=page]:text-foreground"
        >
          {chip.label}
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatNumber(chip.count)}
          </span>
        </Link>
      ))}
    </nav>
  );
}

type ShopPreview = UserView | Pick<UserView, "username" | "avatar">;

function ItemPicture({
  item,
  preview,
  children,
}: {
  item: ShopItem;
  preview: ShopPreview;
  children?: React.ReactNode;
}) {
  const { effect } = item;
  if (effect.type === "frame") {
    return (
      <div className="flex h-36 items-center justify-center overflow-hidden border-b bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]">
        <UserAvatar
          user={{ ...preview, appearance: { frame: effect.frame } }}
          size="xl"
          link={false}
        />
      </div>
    );
  }
  return (
    <div className="relative isolate flex aspect-video items-end overflow-hidden border-b p-3">
      <Art
        category={item.category === "threadCover" ? "threadCovers" : "shop"}
        src={item.image}
        className="absolute inset-0 -z-10"
      />
      {effect.type === "nameColor" && (
        <p
          className={cn(
            "min-w-0 truncate text-2xl font-bold tracking-tight",
            nameColor(effect.color)?.text,
          )}
        >
          {"id" in preview ? (
            <UserLink
              user={preview}
              className={nameColor(effect.color)?.text}
            />
          ) : (
            preview.username
          )}
        </p>
      )}
      {children}
    </div>
  );
}

function ItemAction({
  item,
  viewer,
  owned,
  equipped,
}: {
  item: ShopItem;
  viewer: UserView | null;
  owned: InventoryItemView | undefined;
  equipped: boolean;
}) {
  const t = useTranslations("credits.credits");
  if (!viewer) {
    return (
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
      >
        {t("loginToBuy")}
      </Link>
    );
  }
  const missing = Math.max(0, item.price - viewer.credits);
  if (item.consumable) {
    return (
      <BuyForm itemId={item.id} itemName={item.name} missing={missing}>
        {owned && (
          <Link
            href={`/credits?tab=inventory#${item.category}`}
            aria-label={t("aria.use", { itemName: item.name })}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            {t("use")}
          </Link>
        )}
      </BuyForm>
    );
  }
  if (!owned) {
    return <BuyForm itemId={item.id} itemName={item.name} missing={missing} />;
  }
  return (
    <EquipForm
      itemId={item.id}
      itemName={item.name}
      equipped={equipped}
      from="shop"
    />
  );
}

function ItemCard({
  item,
  viewer,
  preview,
  owned,
}: {
  item: ShopItem;
  viewer: UserView | null;
  preview: ShopPreview;
  owned: InventoryItemView | undefined;
}) {
  const t = useTranslations("credits.credits");
  const equipped = Boolean(
    viewer && owned && isEquipped(item.effect, viewer.appearance),
  );
  const overArt = item.category === "boost";
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <ItemPicture item={item} preview={preview}>
        {overArt && (
          <h3 className="text-lg leading-tight font-semibold tracking-tight text-balance">
            {item.name}
          </h3>
        )}
      </ItemPicture>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex-1 space-y-0.5">
          {!overArt && (
            <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
              {item.name}
            </h3>
          )}
          {item.category !== "frame" && (
            <p className="text-sm text-pretty text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
        <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Credits value={item.price} className="text-base" />
          {owned &&
            (item.consumable ? (
              <Badge variant="secondary">
                {t("items", { count: owned.quantity })}
              </Badge>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <Check aria-hidden="true" className="size-3.5" />
                {t(equipped ? "equipped" : "owned")}
              </span>
            ))}
        </div>
        <ItemAction
          item={item}
          viewer={viewer}
          owned={owned}
          equipped={equipped}
        />
      </div>
    </li>
  );
}

function PermissionExample({
  permission,
  viewer,
  sample,
}: {
  permission: PermissionView;
  viewer: UserView | null;
  // Stands in where the viewer has nothing to show yet.
  sample: UserView;
}) {
  const t = useTranslations("credits.credits");
  const name = viewer?.username ?? t("sampleUsername");
  switch (permission.key) {
    case "signature":
      return (
        <>
          <p className="text-sm">{t("sampleReply")}</p>
          <Signature className="mt-2 border-t pt-2">
            {viewer?.signature ?? t("sampleSignature")}
          </Signature>
        </>
      );
    case "profileCover":
      return (
        <ul className="grid grid-cols-3 gap-2">
          {COVERS.slice(0, 3).map(({ key }) => (
            <li key={key}>
              <Art
                category="profileCovers"
                src={coverSrc(key)}
                className="aspect-(--aspect-cover) rounded-sm border"
              />
            </li>
          ))}
        </ul>
      );
    case "customTitle":
      return (
        <>
          <p
            className={cn(
              "truncate text-sm font-semibold",
              viewer && userNameClass(viewer),
            )}
          >
            {viewer ? <UserLink user={viewer} /> : name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {viewer?.customTitle ?? t("sampleTitle")}
          </p>
        </>
      );
    case "awardSlot": {
      const awards = viewer?.awards.length ? viewer.awards : sample.awards;
      return (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {awards.slice(0, AWARD_SLOTS.mobile).map((award) => (
            <AwardIcon key={award.id} award={award} size="sm" />
          ))}
          <span className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-primary text-primary">
            <Plus aria-hidden="true" className="size-3" />
          </span>
          <span className="ml-1">{t("awardDescription")}</span>
        </p>
      );
    }
    case "usernameChange":
      return (
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted-foreground line-through [overflow-wrap:anywhere]">
            {viewer ? <UserLink user={viewer} /> : name}
          </span>
          <span aria-hidden="true">→</span>
          <span className="sr-only">{t("aria.becomes")}</span>
          <span className="font-semibold">{t("sampleNewUsername")}</span>
        </p>
      );
  }
}

function PermissionState({
  permission,
  item,
  viewer,
}: {
  permission: PermissionView;
  item: ShopItem;
  viewer: UserView | null;
}) {
  const t = useTranslations("credits.credits");
  if (!viewer) {
    return (
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
      >
        {t("loginToBuy")}
      </Link>
    );
  }
  const { source, quantity } = permission;
  // A consumable is bought again and again, except by staff, who never
  // spend one.
  if (source && (!item.consumable || source === "staff")) {
    return (
      <div className="flex min-h-10 flex-col justify-center rounded-lg border border-success/30 bg-success/10 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check aria-hidden="true" className="size-4 shrink-0" />
          {t("permissionOwned")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(`sources.${source}`, { rank: String(viewer.rank?.name) })}
        </p>
      </div>
    );
  }
  return (
    <>
      {quantity !== undefined && (
        <p className="text-xs text-muted-foreground">
          {t.rich("changes", {
            count: quantity,
            quantity: (chunks) => (
              <span className="font-semibold text-foreground tabular-nums">
                {chunks}
              </span>
            ),
          })}
        </p>
      )}
      <BuyForm
        itemId={item.id}
        itemName={item.name}
        missing={Math.max(0, item.price - viewer.credits)}
      >
        {quantity !== undefined && quantity > 0 && (
          <Link
            href="/account"
            aria-label={t("aria.use", { itemName: item.name })}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            {t("use")}
          </Link>
        )}
      </BuyForm>
    </>
  );
}

function PermissionShop({
  items,
  permissions,
  viewer,
  sample,
}: {
  items: ShopItem[];
  permissions: PermissionView[];
  viewer: UserView | null;
  sample: UserView;
}) {
  const t = useTranslations("credits.credits");
  const tPermissions = useTranslations("lib.permissions");
  return (
    <>
      <p className="rounded-lg border bg-card px-4 py-3 text-sm text-pretty text-muted-foreground">
        {t.rich("rankDescription", {
          link: (chunks) => (
            <Link
              href="/upgrade"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
      <ul className="grid gap-3">
        {permissions.map((permission) => {
          const item = items.find(
            ({ effect }) =>
              effect.type === "permission" &&
              effect.permission === permission.key,
          );
          if (!item) return null;
          return (
            <li
              key={permission.key}
              id={`permission-${permission.key}`}
              className="scroll-mt-4 overflow-hidden rounded-lg border bg-card sm:grid sm:grid-cols-[9rem_minmax(0,1fr)]"
            >
              <div className="relative isolate flex h-20 items-center justify-center border-b sm:h-auto sm:border-r sm:border-b-0">
                <Art
                  category="shop"
                  src={item.image}
                  className="absolute inset-0 -z-10"
                />
                <span className="flex size-12 items-center justify-center rounded-full border bg-background/80 text-primary">
                  <PermissionIcon permission={permission} className="size-6" />
                </span>
              </div>
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="min-w-0 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">
                      {tPermissions(`${permission.key}.label`)}
                    </h3>
                    <p className="text-sm text-pretty text-muted-foreground">
                      {tPermissions(`${permission.key}.description`)}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background/60 p-3">
                    <PermissionExample
                      permission={permission}
                      viewer={viewer}
                      sample={sample}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 xl:border-l xl:pl-4">
                  <Credits value={item.price} className="text-base" />
                  <PermissionState
                    permission={permission}
                    item={item}
                    viewer={viewer}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Shop({
  items,
  query,
  viewer,
  preview,
  owned,
  permissions,
  sample,
}: {
  items: ShopItem[];
  query: Query;
  viewer: UserView | null;
  preview: ShopPreview;
  owned: Map<number, InventoryItemView>;
  permissions: PermissionView[];
  sample: UserView;
}) {
  const t = useTranslations("credits.credits");
  const category =
    CATEGORIES.find(({ value }) => value === one(query.category)) ??
    CATEGORIES[0];
  const inCategory = items.filter((item) => item.category === category.value);
  const isFrames = category.value === "frame";

  const tiers = [...new Set(inCategory.map((item) => item.price))].sort(
    (a, b) => a - b,
  );
  const tier = isFrames
    ? tiers.find((price) => String(price) === one(query.tier))
    : undefined;
  const list = isFrames
    ? inCategory
        .filter((item) => !tier || item.price === tier)
        .toSorted((a, b) => a.price - b.price)
    : inCategory;
  const shown = isFrames
    ? Math.max(FRAMES_PER_PAGE, Math.floor(Number(one(query.show))) || 0)
    : list.length;
  const visible = list.slice(0, shown);

  return (
    <div className="space-y-4">
      <ChipNav
        label={t("aria.categories")}
        active={category.value}
        chips={CATEGORIES.map(({ value, label }) => ({
          value,
          href: shopHref(value),
          count: items.filter((item) => item.category === value).length,
          label: (
            <>
              <ShopIcon category={value} className="size-4" />
              {t(label)}
            </>
          ),
        }))}
      />
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {t(category.blurb)}
      </p>
      {isFrames && (
        <ChipNav
          label={t("aria.price")}
          active={String(tier ?? "all")}
          chips={[
            {
              value: "all",
              label: t("allPrices"),
              href: shopHref("frame"),
              count: inCategory.length,
            },
            ...tiers.map((price) => ({
              value: String(price),
              label: <Credits value={price} className="font-medium" />,
              href: shopHref("frame", price),
              count: inCategory.filter((item) => item.price === price).length,
            })),
          ]}
        />
      )}
      {category.value === "permission" ? (
        <PermissionShop
          items={inCategory}
          permissions={permissions}
          viewer={viewer}
          sample={sample}
        />
      ) : (
        <ul
          className={cn(
            "grid gap-3",
            isFrames
              ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"
              : "sm:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {visible.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              viewer={viewer}
              preview={preview}
              owned={owned.get(item.id)}
            />
          ))}
        </ul>
      )}
      {visible.length < list.length && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("frames", { count: list.length, shown: visible.length })}
          </p>
          <Link
            href={shopHref("frame", tier, shown + FRAMES_PER_PAGE)}
            scroll={false}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-5")}
          >
            {t("showMore")}
          </Link>
        </div>
      )}
    </div>
  );
}

function ItemThumb({ item, preview }: { item: ShopItem; preview: AvatarUser }) {
  const { effect } = item;
  return (
    <div className="relative isolate flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
      {effect.type === "frame" ? (
        <UserAvatar
          user={{ ...preview, appearance: { frame: effect.frame } }}
          size="md"
          link={false}
        />
      ) : (
        <Art
          category={item.category === "threadCover" ? "threadCovers" : "shop"}
          src={item.image}
          className="absolute inset-0 -z-10"
        />
      )}
    </div>
  );
}

function Inventory({
  owned,
  viewer,
  threads,
  applied,
}: {
  owned: OwnedItems;
  viewer: UserView;
  threads: ThreadView[];
  applied: { item: ShopItem; thread: ThreadView } | null;
}) {
  const t = useTranslations("credits.credits");
  const groups = CATEGORIES.filter(({ value }) => owned[value].length > 0);
  const threadOptions = threads.map((thread) => ({
    value: String(thread.id),
    label: thread.prefix ? (
      <span className="flex w-0 min-w-0 flex-1 items-center gap-1.5">
        <PrefixTag prefix={thread.prefix} />
        <span className="truncate">{thread.title}</span>
      </span>
    ) : (
      thread.title
    ),
  }));
  const coverOptions = threads.map((thread) => ({
    value: String(thread.id),
    label: thread.prefix ? (
      <span className="flex w-0 min-w-0 flex-1 items-center gap-1.5">
        <PrefixTag prefix={thread.prefix} />
        <span className="truncate">
          {thread.cover
            ? t("coveredThread", { title: thread.title })
            : thread.title}
        </span>
      </span>
    ) : thread.cover ? (
      t("coveredThread", { title: thread.title })
    ) : (
      thread.title
    ),
  }));
  const usable: Partial<Record<ShopCategory, string>> = {
    boost: t("boostDescription"),
    threadCover: t("coverDescription"),
  };
  return (
    <div className="space-y-4">
      {applied && (
        <output className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty">
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {t.rich("applied", {
              itemName: applied.item.name,
              threadTitle: applied.thread.title,
              forumTitle: applied.thread.forum.title,
              effect:
                applied.item.effect.type === "highlight" &&
                !applied.thread.highlightedUntil
                  ? "other"
                  : applied.item.effect.type,
              until: applied.thread.highlightedUntil
                ? formatDate(applied.thread.highlightedUntil)
                : "",
              item: (chunks) => <span className="font-semibold">{chunks}</span>,
              thread: (chunks) => (
                <Link
                  href={`/threads/${applied.thread.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {applied.thread.prefix && (
                    <PrefixTag
                      prefix={applied.thread.prefix}
                      className="mr-1.5 align-(--prefix-offset)"
                    />
                  )}
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </output>
      )}
      {groups.length === 0 && (
        <SectionCard title={t("inventoryHeading")}>
          <EmptyState
            icon={Package}
            title={t("inventoryEmpty")}
            description={t("inventoryDescription")}
          >
            <Link href="/credits" className={cn(buttonVariants(), actionClass)}>
              {t("browseShop")}
            </Link>
          </EmptyState>
        </SectionCard>
      )}
      {groups.map(({ value, label }) => (
        <div key={value} id={value} className="scroll-mt-4">
          <SectionCard title={t(label)} description={usable[value]}>
            <ul className="divide-y divide-border">
              {owned[value].map((item) => {
                const equipped = isEquipped(item.effect, viewer.appearance);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <ItemThumb item={item} preview={viewer} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {item.name}
                        {item.consumable && (
                          <span className="font-medium text-muted-foreground tabular-nums">
                            {t("inventoryItems", { count: item.quantity })}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("acquired", { date: formatDate(item.acquiredAt) })}
                        {equipped && (
                          <span className="font-medium text-success">
                            <span aria-hidden="true"> · </span>
                            {t("equipped")}
                          </span>
                        )}
                      </p>
                    </div>
                    {(value === "frame" || value === "color") && (
                      <EquipForm
                        itemId={item.id}
                        itemName={item.name}
                        equipped={equipped}
                        from="inventory"
                        className="basis-full sm:w-28 sm:basis-auto"
                      />
                    )}
                    {usable[value] && (
                      <div className="min-w-0 basis-full">
                        {threads.length > 0 ? (
                          <BoostForm
                            itemId={item.id}
                            itemName={item.name}
                            threads={
                              value === "threadCover"
                                ? coverOptions
                                : threadOptions
                            }
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t("noThreads")}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </div>
      ))}
    </div>
  );
}

function History({ transactions }: { transactions: Transaction[] }) {
  const t = useTranslations("credits.credits");
  return (
    <SectionCard title={t("historyHeading")}>
      {transactions.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t("historyEmpty")}
          description={t("historyDescription")}
        />
      ) : (
        <ul className="divide-y divide-border">
          {transactions.map((transaction) => (
            <li
              key={transaction.id}
              className="flex min-h-12 items-center justify-between gap-3 px-4 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{transaction.reason}</p>
                <RelativeTime
                  date={transaction.createdAt}
                  className="text-xs text-muted-foreground"
                />
              </div>
              <span
                className={cn(
                  "shrink-0 text-sm font-semibold tabular-nums",
                  transaction.amount < 0 ? "text-destructive" : "text-success",
                )}
              >
                {transaction.amount < 0 ? "−" : "+"}
                {formatNumber(Math.abs(transaction.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

async function CreditsContent({ searchParams }: Props) {
  const t = await getTranslations("credits.credits");
  const [query, viewer] = await Promise.all([searchParams, getCurrentUser()]);
  const [items, richest, owned, transactions, threads, held] =
    await Promise.all([
      getShopItems(),
      getLeaderboard("credits", 10),
      viewer ? getOwnedItems(viewer.id) : null,
      viewer ? getTransactions(viewer.id) : [],
      viewer ? getUserThreads(viewer.id) : [],
      viewer ? getPermissions(viewer.id) : null,
    ]);
  const permissions: PermissionView[] =
    held ??
    PERMISSIONS.map((permission) => ({
      ...permission,
      granted: false,
      source: null,
    }));
  const inventory = owned ? Object.values(owned).flat() : [];

  const tab: Tab =
    (viewer && TABS.find((value) => value === one(query.tab))) || "shop";
  const tabs = [
    {
      value: "shop",
      label: t("shopTab"),
      href: "/credits",
      count: items.length,
    },
    {
      value: "inventory",
      label: t("inventoryTab"),
      href: "/credits?tab=inventory",
      count: inventory.length,
    },
    {
      value: "history",
      label: t("historyTab"),
      href: "/credits?tab=history",
      count: transactions.length,
    },
  ];

  const appliedItem = items.find(
    (item) =>
      (item.category === "boost" || item.category === "threadCover") &&
      String(item.id) === one(query.applied),
  );
  // Only a thread that really carries the boost or cover is reported.
  const appliedThread = threads.find((thread) => {
    if (String(thread.id) !== one(query.thread)) return false;
    switch (appliedItem?.effect.type) {
      case "threadCover":
        return thread.cover === appliedItem.effect.cover;
      case "bump":
        return thread.bumpedAt;
      default:
        return thread.highlighted;
    }
  });

  return (
    <>
      {viewer ? (
        <>
          {tab === "shop" && <h2 className="sr-only">{t("shopTab")}</h2>}
          <TabLinks tabs={tabs} active={tab} label={t("aria.sections")} />
        </>
      ) : (
        <h2 className="border-b pb-2 text-lg font-semibold tracking-tight">
          {t("shopTab")}
        </h2>
      )}
      {tab === "shop" && (
        <Shop
          items={items}
          query={query}
          viewer={viewer}
          preview={
            viewer ?? {
              username: t("sampleUsername"),
              avatar: richest[0].avatar,
            }
          }
          owned={new Map(inventory.map((item) => [item.id, item]))}
          permissions={permissions}
          sample={richest[0]}
        />
      )}
      {tab === "inventory" && viewer && owned && (
        <Inventory
          owned={owned}
          viewer={viewer}
          threads={threads}
          applied={
            appliedItem && appliedThread
              ? { item: appliedItem, thread: appliedThread }
              : null
          }
        />
      )}
      {tab === "history" && <History transactions={transactions} />}
    </>
  );
}

// The shell shows the skeleton of the default category. Once the query is
// known, the fallback of the content is the one of the category requested.
async function CreditsSection(props: Props) {
  const t = await getTranslations("credits.credits");
  const requested = one((await props.searchParams).category);
  const category = CATEGORIES.find(({ value }) => value === requested)?.value;
  return (
    <Suspense
      fallback={
        <LoadingRegion label={t("aria.loadingShop")}>
          <TabsSkeleton />
          <ShopSkeleton category={category} />
        </LoadingRegion>
      }
    >
      <CreditsContent {...props} />
    </Suspense>
  );
}

async function CreditLeaders() {
  const t = await getTranslations("credits.credits");
  const viewerId = (await getCurrentUser())?.id;
  const richest = await getLeaderboard("credits", 10);
  return (
    <SectionCard
      title={t("leadersHeading")}
      description={t("leadersDescription")}
    >
      <Leaderboard members={richest} by="credits" viewerId={viewerId} />
    </SectionCard>
  );
}

export default function CreditsPage(props: Props) {
  const t = useTranslations("credits.credits");
  return (
    <>
      <PageHero title={t("title")} subtitle={t("subtitle")} />
      <Container>
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingBalance")}>
              <BalanceSkeleton />
            </LoadingRegion>
          }
        >
          <CreditBalance />
        </Suspense>
      </Container>
      <PageLayout
        className="pt-6"
        mainClassName="space-y-4"
        aside={
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingLeaders")}>
                <MemberListSkeleton rows={10} />
              </LoadingRegion>
            }
          >
            <CreditLeaders />
          </Suspense>
        }
      >
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingShop")}>
              <TabsSkeleton />
              <ShopSkeleton />
            </LoadingRegion>
          }
        >
          <CreditsSection {...props} />
        </Suspense>
      </PageLayout>
    </>
  );
}

async function CreditBalance() {
  const viewer = await getCurrentUser();
  return <Balance viewer={viewer} />;
}
