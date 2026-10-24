import {
  Clock,
  Images,
  type LucideIcon,
  PenLine,
  Rss,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
import { postToWall } from "@/app/[locale]/(main)/members/actions";
import { PostComposer } from "@/app/[locale]/(main)/members/post-composer";
import { EmptyState } from "@/components/forum/empty-state";
import { FeedFilterBar } from "@/components/forum/feed-filter-bar";
import { PagedList } from "@/components/forum/paged-list";
import { PictureViewer } from "@/components/forum/picture-viewer";
import { queryOfSearch } from "@/components/forum/places";
import {
  FeedSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { Streamed } from "@/components/forum/streamed";
import { TabLinks } from "@/components/forum/tab-links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { buttonVariants } from "@/components/ui/button";
import { WidgetArea, widgetAreas } from "@/components/widgets/widget-area";
import {
  feedHref,
  filterFromParams,
  filterKey,
  isFiltered,
} from "@/lib/feed-filters";
import { FEED_ROW_ESTIMATE } from "@/lib/feed-view";
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
import { getFeedView } from "@/lib/sermo/feed-view";
import { getGuestTab } from "@/lib/sermo/home-tab";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import type { ApiWidget } from "@/lib/sermo/widgets";
import { getWidgets } from "@/lib/sermo/widgets";
import { cn } from "@/lib/utils";

// The main column of the feed (`/novedades`): the wall composer, the widgets around the tabs, the
// tabs and the open tab's list. It is one part, which the tabs and the filters change in place
// (`TabSwitch`): the page draws it, and so does `feedColumn` for a tab or a filter changed.

// The parameters of the address the feed's tabs and filters change in place.
export const FEED_SWITCH_PARAMS = [
  "tab",
  "forums",
  "prefix",
  "type",
  "tag",
  "watched",
  "unread",
];

// The widgets the feed draws for a tab and its filter, sorted into the page's areas, and what they
// are drawn with.
export function feedWidgets(
  tab: HomeTab,
  params: Params,
  widgets: ApiWidget[],
) {
  // The featured threads belong to the feed: on its tabs only, and not above a list a filter
  // narrowed, which may leave them out.
  const featured =
    FEED_TABS.some((feed) => feed === tab) &&
    !isFiltered(filterFromParams(params));
  const drawn = widgets.filter(
    (widget) => featured || widget.type !== "featured",
  );
  return {
    areas: widgetAreas("novedades", drawn),
    context: {
      params,
      widgets: drawn,
      href: (query: [string, string][]) => viewHref(tab, params, query),
    },
  };
}

// The main column as the address with `search` draws it, for a tab or a filter changed in place:
// read again as a page load reads it.
export async function feedColumnOf(search: string) {
  const [opened, widgets] = await Promise.all([
    openingOf(queryOfSearch(search)),
    getWidgets("novedades"),
  ]);
  return <FeedColumn opened={opened} widgets={widgets} inPlace />;
}

export async function FeedColumn({
  opened,
  widgets,
  inPlace = false,
}: {
  opened: Opened;
  widgets: ApiWidget[];
  inPlace?: boolean;
}) {
  const [t, seo] = await Promise.all([
    getTranslations("home.page"),
    getTranslations("home.seo"),
  ]);
  const { tab, params } = opened;
  const { areas, context } = feedWidgets(tab, params, widgets);
  return (
    <>
      {/* The tab's name in the page's title, which follows a tab opened in place. */}
      <span hidden data-switch-title={seo(`${tab}.title`)} />
      {/* No fallback: only members get a composer, and the shell cannot tell them from guests
          without reading the cookie. The composer settles on the session alone, ahead of the
          feed. */}
      {FEED_TABS.some((feed) => feed === tab) && (
        <Streamed inPlace={inPlace} fallback={null}>
          <HomeComposer />
        </Streamed>
      )}
      <WidgetArea widgets={areas.above} context={context} />
      <Streamed
        inPlace={inPlace}
        fallback={
          <LoadingRegion label={t("loadingFeed")}>
            <TabsSkeleton />
            <FeedSkeleton />
          </LoadingRegion>
        }
      >
        <HomeTabs opened={opened} />
      </Streamed>
      <WidgetArea widgets={areas.below} context={context} />
    </>
  );
}

export type Params = Awaited<PageProps<"/[locale]/novedades">["searchParams"]>;

// The address of the open tab with its filter, from its first page, with `query` set on it (a
// widget's choice, such as a statistics tab).
function viewHref(tab: HomeTab, params: Params, query: [string, string][]) {
  const href =
    tab === "media" ? homeHref(tab) : feedHref(tab, filterFromParams(params));
  const extra = new URLSearchParams(query).toString();
  return extra ? `${href}&${extra}` : href;
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

// The tab the page opens on: the address, else the default of the visitor. A member's default
// comes with the session (their choice, or the site's rules decided for them); only a guest asks
// the site, and that answer is shared.
export async function openingOf(params: Params) {
  const viewer = await getViewer();
  const signedIn = viewer.user !== null;
  const home = viewer.user?.openHomeTab ?? (await getGuestTab());
  const tab = openTab({ named: tabParam(params.tab), home, signedIn });
  return { params, signedIn, home, tab };
}

export type Opened = Awaited<ReturnType<typeof openingOf>>;

const TAB_ICONS: Record<HomeTab, LucideIcon> = {
  latest: Clock,
  hot: TrendingUp,
  following: UserCheck,
  media: Images,
};

// Two bars, one per screen size: a phone has every tab but Media on its bar, with icons and only
// the open tab's label on the narrowest screens; a wider screen pins three (`barOf`).
async function HomeTabs({ opened }: { opened: Opened }) {
  const { params, signedIn, home, tab } = opened;
  const t = await getTranslations("home.page");
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
      <div data-switch-panel="" className="space-y-(--page-gap)">
        {tab === "media" ? (
          <HomeMedia params={params} />
        ) : (
          <>
            <FeedFilterBar tab={tab} filter={filterFromParams(params)} />
            <HomeFeed tab={tab} params={params} />
          </>
        )}
      </div>
    </>
  );
}

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
