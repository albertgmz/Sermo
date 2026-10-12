import { ChevronDown, PenLine, Rss, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FeedItem } from "@/app/(main)/_feed/feed-item";
import { FeedSidebar } from "@/app/(main)/_feed/feed-sidebar";
import { postToWall } from "@/app/(main)/members/actions";
import { CompactComposer } from "@/components/forum/compact-composer";
import { EmptyState } from "@/components/forum/empty-state";
import {
  FeedSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import {
  type FeedItem as FeedEntry,
  getFeed,
  getReactionTypes,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.page");
  return { title: t("metaTitle") };
}

const PAGE_SIZE = 20;
const TOP_DAYS = 7;
const DAY = 86_400_000;

const TABS = ["latest", "following", "top"] as const;

type Tab = (typeof TABS)[number];

function feedHref(tab: Tab, page = 1) {
  const params = new URLSearchParams();
  if (tab !== "latest") params.set("tab", tab);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function reactionCount(item: FeedEntry) {
  return item.type === "profilePost"
    ? item.profilePost.reactions.total
    : item.post.reactions.total;
}

async function loadFeed(tab: Tab, viewerId: number | null, limit: number) {
  if (tab === "latest") return getFeed(viewerId, limit);
  const all = await getFeed(viewerId, Number.MAX_SAFE_INTEGER);
  if (tab === "following") {
    return all.filter((item) => item.following).slice(0, limit);
  }
  const since = new Date(Date.now() - TOP_DAYS * DAY).toISOString();
  return all
    .filter((item) => item.createdAt >= since && reactionCount(item) > 0)
    .toSorted((a, b) => reactionCount(b) - reactionCount(a))
    .slice(0, limit);
}

export default function HomePage(props: PageProps<"/">) {
  const t = useTranslations("home.page");
  return (
    <PageLayout
      aside={
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingSidebar")}>
              <SidebarSkeleton />
            </LoadingRegion>
          }
        >
          <HomeSidebar />
        </Suspense>
      }
      asideOnMobile="hidden"
      mainClassName="space-y-(--page-gap)"
    >
      <h1 className="sr-only">{t("heading")}</h1>
      {/* No fallback: only members get a composer, and the shell cannot tell
          them from guests without reading the cookie. The composer settles on
          the session alone, ahead of the feed. */}
      <Suspense fallback={null}>
        <HomeComposer />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingFeed")}>
            <TabsSkeleton />
            <FeedSkeleton />
          </LoadingRegion>
        }
      >
        <HomeFeed {...props} />
      </Suspense>
    </PageLayout>
  );
}

async function HomeSidebar() {
  const viewer = await getCurrentUser();
  return <FeedSidebar viewer={viewer} />;
}

async function HomeComposer() {
  const viewer = await getCurrentUser();
  const t = await getTranslations("home.page");
  return (
    <>
      {viewer && (
        <section
          aria-label={t("aria.newPost")}
          className="overflow-hidden rounded-lg border bg-card"
        >
          <CompactComposer
            action={postToWall.bind(null, viewer.id)}
            user={viewer}
            placeholder={t("placeholder")}
            submitLabel={t("submit")}
            className="p-4"
          />
          <div className="flex items-center justify-between gap-3 border-t py-2 pr-2 pl-4">
            <p className="min-w-0 text-xs text-pretty text-muted-foreground">
              {t("description")}
            </p>
            <Link
              href="/forums"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "h-10 px-3 md:h-8",
              )}
            >
              <PenLine />
              {t("startThread")}
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

async function HomeFeed({ searchParams }: PageProps<"/">) {
  const [params, viewer, reactionTypes] = await Promise.all([
    searchParams,
    getCurrentUser(),
    getReactionTypes(),
  ]);
  const tab = TABS.find((value) => value === params.tab) ?? "latest";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const needsLogin = tab === "following" && !viewer;
  const shown = page * PAGE_SIZE;
  const loaded = needsLogin
    ? []
    : await loadFeed(tab, viewer?.id ?? null, shown + 1);
  const items = loaded.slice(0, shown);
  const t = await getTranslations("home.page");

  return (
    <>
      <TabLinks
        tabs={TABS.map((value) => ({
          value,
          label: t(`tabs.${value}`),
          href: feedHref(value),
        }))}
        active={tab}
        label={t("aria.feed")}
        variant="segmented"
      />
      {tab === "top" && (
        <p className="text-xs text-muted-foreground">
          {t("days", { count: TOP_DAYS })}
        </p>
      )}

      {needsLogin ? (
        <EmptyState
          icon={Users}
          title={t("loginTitle")}
          description={t("loginDescription")}
          className="rounded-lg border bg-card"
        >
          <Link href="/login" className={cn(buttonVariants(), "h-10 px-4")}>
            {t("login")}
          </Link>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={t("emptyTitle")}
          description={t(`empty.${tab}`, { count: TOP_DAYS })}
          className="rounded-lg border bg-card"
        />
      ) : (
        <>
          {items.map((item) => (
            <FeedItem
              key={item.id}
              item={item}
              viewer={viewer}
              reactionTypes={reactionTypes}
            />
          ))}
          {loaded.length > shown && (
            <Link
              href={feedHref(tab, page + 1)}
              scroll={false}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 w-full",
              )}
            >
              <ChevronDown />
              {t("loadMore")}
            </Link>
          )}
        </>
      )}
    </>
  );
}
