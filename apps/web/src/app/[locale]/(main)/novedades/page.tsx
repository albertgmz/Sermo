import {
  Clock,
  Images,
  type LucideIcon,
  PenLine,
  Rss,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
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
import { mediaPage } from "@/app/[locale]/(main)/_feed/media-page";
import {
  STATS_TABS,
  type StatsTab,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { postToWall } from "@/app/[locale]/(main)/members/actions";
import { PostComposer } from "@/app/[locale]/(main)/members/post-composer";
import { EmptyState } from "@/components/forum/empty-state";
import { FeedFilterBar } from "@/components/forum/feed-filter-bar";
import { PagedList } from "@/components/forum/paged-list";
import { PictureViewer } from "@/components/forum/picture-viewer";
import {
  FeedSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import {
  WidgetArea,
  widgetAreas,
  widgetAside,
} from "@/components/widgets/widget-area";
import {
  feedHref,
  filterFromParams,
  filterKey,
  isFiltered,
} from "@/lib/feed-filters";
import { FEED_ROW_ESTIMATE } from "@/lib/feed-view";
import { homeAddress, homeMetadata } from "@/lib/home-seo";
import {
  barOf,
  type HomeTab,
  homeHref,
  NOVEDADES_PATH,
  openTab,
  phoneBarOf,
  tabParam,
} from "@/lib/home-tabs";
import { pagesParam } from "@/lib/list-pages";
import { POLL_MS } from "@/lib/poll-intervals";
import { publicUrl } from "@/lib/sermo/config";
import { getFeedView } from "@/lib/sermo/feed-view";
import { getGuestTab } from "@/lib/sermo/home-tab";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { getSite } from "@/lib/sermo/site";
import { getWidgets } from "@/lib/sermo/widgets";
import { cn } from "@/lib/utils";

// The head of the tab the page opens on. The bare address and the guests' own tab are one page.
export async function generateMetadata(
  props: PageProps<"/[locale]/novedades">,
): Promise<Metadata> {
  const [{ params, tab }, guestTab, site, t] = await Promise.all([
    opening(props.searchParams),
    getGuestTab(),
    getSite(),
    getTranslations("home.seo"),
  ]);
  const head = homeMetadata({
    address: homeAddress({ opened: tab, guestTab, params }),
    origin: publicUrl(),
    title: t(`${tab}.title`),
    description: t(`${tab}.description`, { site: site.name }),
  });
  // Following is the viewer's own list: nothing to share.
  if (tab === "following") return head;
  return publicHead(head, { title: t(`${tab}.title`) });
}

// The feed: the wall composer and the feed tabs, with the widgets of the page's positions (the
// featured threads above the tabs and the side blocks, by default). The home page (`/`) is the
// forum list.
export default async function NovedadesPage(
  props: PageProps<"/[locale]/novedades">,
) {
  const [{ tab, params }, widgets, t] = await Promise.all([
    opening(props.searchParams),
    getWidgets("novedades"),
    getTranslations("home.page"),
  ]);
  // The featured threads belong to the feed: on its tabs only, and not above a list a filter
  // narrowed, which may leave them out.
  const featured =
    FEED_TABS.some((feed) => feed === tab) &&
    !isFiltered(filterFromParams(params));
  const areas = widgetAreas(
    "novedades",
    widgets.filter((widget) => featured || widget.type !== "featured"),
  );
  const stats: StatsTab =
    STATS_TABS.find((entry) => entry.value === params.stats)?.value ??
    STATS_TABS[0].value;
  const context = {
    stats,
    statsHref: (value: StatsTab) => statsHref(tab, params, value),
  };
  return (
    <PageLayout
      mainClassName="space-y-(--page-gap)"
      lead={
        areas.lead.length > 0 && (
          <WidgetArea widgets={areas.lead} context={context} />
        )
      }
      {...widgetAside(areas.aside, context)}
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
      <WidgetArea widgets={areas.above} context={context} />
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
      <WidgetArea widgets={areas.below} context={context} />
    </PageLayout>
  );
}

// The address of a forum statistics tab on this page: the open tab with its filter, from its first
// page, with the statistics tab.
function statsHref(tab: HomeTab, params: Params, stats: StatsTab) {
  const href =
    tab === "media" ? homeHref(tab) : feedHref(tab, filterFromParams(params));
  return stats === STATS_TABS[0].value ? href : `${href}&stats=${stats}`;
}

// Posts on the wall of the member who is signed in. Not on a phone, where the + of the bottom bar
// does it.
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
      className="overflow-hidden rounded-lg border bg-card max-md:hidden"
    >
      <PostComposer
        action={postToWall.bind(null, user.id, NOVEDADES_PATH)}
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
          href="/"
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

// The tab the page opens on, once per request: the address, else the default of the visitor. A
// member's default comes with the session (their choice, or the site's rules decided for them);
// only a guest asks the site, and that answer is shared.
const opening = cache(
  async (searchParams: PageProps<"/[locale]/novedades">["searchParams"]) => {
    const [params, viewer] = await Promise.all([searchParams, getViewer()]);
    const signedIn = viewer.user !== null;
    const home = viewer.user?.openHomeTab ?? (await getGuestTab());
    const tab = openTab({ named: tabParam(params.tab), home, signedIn });
    return { params, signedIn, home, tab };
  },
);

// What belongs to the feed (the wall composer) is drawn on its tabs only.
async function OnFeedTabs({
  searchParams,
  children,
}: PageProps<"/[locale]/novedades"> & { children: React.ReactNode }) {
  const { tab } = await opening(searchParams);
  return FEED_TABS.some((feed) => feed === tab) ? children : null;
}

const TAB_ICONS: Record<HomeTab, LucideIcon> = {
  latest: Clock,
  hot: TrendingUp,
  following: UserCheck,
  media: Images,
};

// Two bars, one per screen size: a phone has every tab but Media on its bar, with icons and only
// the open tab's label on the narrowest screens; a wider screen pins three (`barOf`).
async function HomeTabs({ searchParams }: PageProps<"/[locale]/novedades">) {
  const [{ params, signedIn, home, tab }, t] = await Promise.all([
    opening(searchParams),
    getTranslations("home.page"),
  ]);
  const { bar, more } = barOf({ active: tab, fallback: home, signedIn });
  const phone = phoneBarOf({ active: tab, signedIn });
  const link = (value: HomeTab) => ({
    value,
    label: t(`tabs.${value}`),
    href: homeHref(value),
  });
  const phoneLink = (value: HomeTab) => {
    const Icon = TAB_ICONS[value];
    return { ...link(value), icon: <Icon /> };
  };

  return (
    <>
      <TabLinks
        tabs={phone.bar.map(phoneLink)}
        more={phone.more.map(phoneLink)}
        moreLabel={t("tabs.more")}
        active={tab}
        label={t("aria.feed")}
        variant="segmented"
        narrow
        className="md:hidden"
      />
      <TabLinks
        tabs={bar.map(link)}
        more={more.map(link)}
        moreLabel={t("tabs.more")}
        active={tab}
        label={t("aria.feed")}
        variant="segmented"
        className="max-md:hidden"
      />
      {tab === "media" ? (
        <HomeMedia params={params} />
      ) : (
        <>
          <FeedFilterBar tab={tab} filter={filterFromParams(params)} />
          <HomeFeed tab={tab} params={params} />
        </>
      )}
    </>
  );
}

type Params = Awaited<PageProps<"/[locale]/novedades">["searchParams"]>;

async function HomeFeed({ tab, params }: { tab: Tab; params: Params }) {
  const t = await getTranslations("home.page");
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const filter = filterFromParams(params);
  // The layout is part of what the list holds: a change draws other rows, so it is another list,
  // and its rows are sized for it until they are measured.
  const [first, view] = await Promise.all([
    feedPage(tab, cursor, undefined, filter),
    getFeedView(),
  ]);

  return first.rows.length === 0 && !first.nextCursor ? (
    <EmptyState
      icon={Rss}
      title={t("emptyTitle")}
      description={isFiltered(filter) ? t("emptyFiltered") : t(`empty.${tab}`)}
      className="rounded-lg border bg-card"
    />
  ) : (
    <PagedList
      first={first}
      more={moreFeed.bind(null, tab, filter)}
      pages={pagesParam(params.pages)}
      start={cursor}
      listKey={["feed", tab, filterKey(filter), view]}
      hrefBase={feedHref(tab, filter)}
      moreLabel={t("loadMore")}
      emptyNote={t("emptyMore")}
      estimateSize={FEED_ROW_ESTIMATE[view]}
      spacing="spaced"
      fresh={
        tab === "hot"
          ? undefined
          : {
              check: newFeedCount.bind(null, tab, filter),
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
    <PictureViewer>
      <PagedList
        first={first}
        more={moreMedia}
        pages={pagesParam(params.pages)}
        start={cursor}
        listKey={["media"]}
        hrefBase={homeHref("media")}
        moreLabel={t("loadMore")}
        // One row is a page of large cards: about 6000 px in one column, 2000 in three.
        estimateSize={3000}
        spacing="spaced"
      />
    </PictureViewer>
  );
}
