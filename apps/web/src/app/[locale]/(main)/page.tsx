import { Images, PenLine, Rss } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { FeaturedThreads } from "@/app/[locale]/(main)/_feed/featured-threads";
import {
  moreFeed,
  moreMedia,
  newFeedCount,
} from "@/app/[locale]/(main)/_feed/feed-actions";
import {
  TABS as FEED_TABS,
  feedPage,
  type Tab,
} from "@/app/[locale]/(main)/_feed/feed-page";
import { FeedSidebar } from "@/app/[locale]/(main)/_feed/feed-sidebar";
import { mediaPage } from "@/app/[locale]/(main)/_feed/media-page";
import { ForumList } from "@/app/[locale]/(main)/forums/forum-list";
import {
  STATS_TABS,
  type StatsTab,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { postToWall } from "@/app/[locale]/(main)/members/actions";
import { PostComposer } from "@/app/[locale]/(main)/members/post-composer";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import {
  FeedSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import {
  barOf,
  type HomeTab,
  homeHref,
  openTab,
  tabParam,
} from "@/lib/home-tabs";
import { pagesParam } from "@/lib/list-pages";
import { POLL_MS } from "@/lib/poll-intervals";
import { getGuestTab } from "@/lib/sermo/home-tab";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.page");
  return { title: t("metaTitle") };
}

export default function HomePage(props: PageProps<"/[locale]">) {
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
          <FeedSidebar />
        </Suspense>
      }
      asideOnMobile="hidden"
      mainClassName="space-y-(--page-gap)"
    >
      <h1 className="sr-only">{t("heading")}</h1>
      {/* No fallback: only members get a composer, and the shell cannot tell them from guests
          without reading the cookie. The composer settles on the session alone, ahead of the
          feed. */}
      <Suspense fallback={null}>
        <OnFeedTabs {...props}>
          <HomeComposer />
        </OnFeedTabs>
      </Suspense>
      {/* No fallback: the block is drawn only when something is featured. */}
      <Suspense fallback={null}>
        <OnFeedTabs {...props}>
          <FeaturedThreads />
        </OnFeedTabs>
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingFeed")}>
            <TabsSkeleton />
            <FeedSkeleton />
          </LoadingRegion>
        }
      >
        <HomeTabs {...props} />
      </Suspense>
    </PageLayout>
  );
}

// Posts on the wall of the member who is signed in.
async function HomeComposer() {
  const [{ user, permissions }, t] = await Promise.all([
    getViewer(),
    getTranslations("home.page"),
  ]);
  if (!user || !permissions.canPostProfile) return null;
  const member = await membersFor([user]);
  return (
    <section
      aria-label={t("aria.newPost")}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <PostComposer
        action={postToWall.bind(null, user.id, "/")}
        avatar={<UserAvatar user={member(user.id)} size="lg" />}
        name={user.username}
        placeholder={t("placeholder")}
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
  );
}

// The address of the Forums tab with a section and a statistics tab: the list is the one of
// `/forums`, whose own links stay on that page.
function forumsTabHref(section: string | null, stats: StatsTab) {
  const params = new URLSearchParams({ tab: "forums" });
  if (section !== null) params.set("section", section);
  if (stats !== STATS_TABS[0].value) params.set("stats", stats);
  return `/?${params.toString()}`;
}

// The tab the page opens on, once per request: the address, else the default of the visitor. A
// member's default comes with the session (their choice, or the site's rules decided for them);
// only a guest asks the site, and that answer is shared.
const opening = cache(
  async (searchParams: PageProps<"/[locale]">["searchParams"]) => {
    const [params, viewer] = await Promise.all([searchParams, getViewer()]);
    const signedIn = viewer.user !== null;
    const home = viewer.user?.openHomeTab ?? (await getGuestTab());
    const tab = openTab({ named: tabParam(params.tab), home, signedIn });
    return { params, signedIn, home, tab };
  },
);

// What belongs to the feed (the wall composer, the featured threads) is drawn on its tabs only.
async function OnFeedTabs({
  searchParams,
  children,
}: PageProps<"/[locale]"> & { children: React.ReactNode }) {
  const { tab } = await opening(searchParams);
  return FEED_TABS.some((feed) => feed === tab) ? children : null;
}

async function HomeTabs({ searchParams }: PageProps<"/[locale]">) {
  const [{ params, signedIn, home, tab }, t] = await Promise.all([
    opening(searchParams),
    getTranslations("home.page"),
  ]);
  const { bar, more } = barOf({ active: tab, fallback: home, signedIn });
  const link = (value: HomeTab) => ({
    value,
    label: t(`tabs.${value}`),
    href: homeHref(value),
  });

  return (
    <>
      <TabLinks
        tabs={bar.map(link)}
        more={more.map(link)}
        moreLabel={t("tabs.more")}
        active={tab}
        label={t("aria.feed")}
        variant="segmented"
      />
      {tab === "forums" ? (
        <ForumList
          section={typeof params.section === "string" ? params.section : null}
          stats={
            STATS_TABS.find((entry) => entry.value === params.stats)?.value ??
            STATS_TABS[0].value
          }
          hrefFor={forumsTabHref}
        />
      ) : tab === "media" ? (
        <HomeMedia params={params} />
      ) : (
        <HomeFeed tab={tab} params={params} />
      )}
    </>
  );
}

type Params = Awaited<PageProps<"/[locale]">["searchParams"]>;

async function HomeFeed({ tab, params }: { tab: Tab; params: Params }) {
  const t = await getTranslations("home.page");
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const first = await feedPage(tab, cursor);

  return first.rows.length === 0 && !first.nextCursor ? (
    <EmptyState
      icon={Rss}
      title={t("emptyTitle")}
      description={t(`empty.${tab}`)}
      className="rounded-lg border bg-card"
    />
  ) : (
    <PagedList
      first={first}
      more={moreFeed.bind(null, tab)}
      pages={pagesParam(params.pages)}
      start={cursor}
      listKey={["feed", tab]}
      hrefBase={homeHref(tab)}
      moreLabel={t("loadMore")}
      estimateSize={320}
      spacing="spaced"
      fresh={
        tab === "hot"
          ? undefined
          : {
              check: newFeedCount.bind(null, tab),
              intervalMs: POLL_MS.feed,
            }
      }
    />
  );
}

// The newest pictures on content the visitor can see.
async function HomeMedia({ params }: { params: Params }) {
  const t = await getTranslations("home.page");
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const first = await mediaPage(cursor);

  return first.rows.length === 0 && !first.nextCursor ? (
    <EmptyState
      icon={Images}
      title={t("emptyTitle")}
      description={t("empty.media")}
      className="rounded-lg border bg-card"
    />
  ) : (
    <PagedList
      first={first}
      more={moreMedia}
      pages={pagesParam(params.pages)}
      start={cursor}
      listKey={["media"]}
      hrefBase={homeHref("media")}
      moreLabel={t("loadMore")}
      estimateSize={720}
      spacing="spaced"
    />
  );
}
