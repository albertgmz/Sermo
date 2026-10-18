import {
  Clock,
  Images,
  type LucideIcon,
  MessagesSquare,
  PenLine,
  Rss,
  TrendingUp,
  UserCheck,
} from "lucide-react";
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
import { FeedFilterBar } from "@/components/forum/feed-filter-bar";
import { WebSiteJsonLd } from "@/components/forum/json-ld";
import { PagedList } from "@/components/forum/paged-list";
import { PictureViewer } from "@/components/forum/picture-viewer";
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
import { cn } from "@/lib/utils";

// The head of the tab the page opens on. The bare address and the guests' own tab are one page; the
// site's own description, when the owner wrote one, speaks for that tab.
export async function generateMetadata(
  props: PageProps<"/[locale]">,
): Promise<Metadata> {
  const [{ params, tab }, guestTab, site, t] = await Promise.all([
    opening(props.searchParams),
    getGuestTab(),
    getSite(),
    getTranslations("home.seo"),
  ]);
  const address = homeAddress({ opened: tab, guestTab, params });
  const head = homeMetadata({
    address,
    origin: publicUrl(),
    title: t(`${tab}.title`),
    description:
      (address.path === "/" && site.description) ||
      t(`${tab}.description`, { site: site.name }),
  });
  // Following is the viewer's own list: nothing to share. The bare address is the site itself.
  if (tab === "following") return head;
  return publicHead(head, {
    title: address.path === "/" ? site.name : t(`${tab}.title`),
  });
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
      {/* No fallback: structured data draws nothing. */}
      <Suspense fallback={null}>
        <OnHomeAddress {...props}>
          <WebSiteJsonLd />
        </OnHomeAddress>
      </Suspense>
      {/* No fallback: only the page a deleted account or a failed sign-out lands on has a notice. */}
      <Suspense fallback={null}>
        <HomeNotice {...props} />
      </Suspense>
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
        <OnFeedTabs {...props} unfiltered>
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

// The lines a visitor is sent here with: a member whose account was just deleted (the action), and
// one the backend could not sign out (the sign-out route), with the tone of each.
const HOME_NOTICES = {
  accountDeleted: "text-success",
  signOutFailed: "text-destructive",
} as const;

async function HomeNotice({ searchParams }: PageProps<"/[locale]">) {
  const [{ notice }, t] = await Promise.all([
    searchParams,
    getTranslations("home.page"),
  ]);
  if (typeof notice !== "string" || !Object.hasOwn(HOME_NOTICES, notice))
    return null;
  const key = notice as keyof typeof HOME_NOTICES;
  return (
    <output
      className={cn(
        "block rounded-lg border bg-card p-4 text-sm",
        HOME_NOTICES[key],
      )}
    >
      {t(key)}
    </output>
  );
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

// The site's structured data belongs to its home address: the bare address as guests (and so
// crawlers) open it, not a tab, a continued list or a copy. A guest's home is the site's tab.
async function OnHomeAddress({
  searchParams,
  children,
}: PageProps<"/[locale]"> & { children: React.ReactNode }) {
  const { params, tab, signedIn, home } = await opening(searchParams);
  if (signedIn) return null;
  const address = homeAddress({ opened: tab, guestTab: home, params });
  return address.path === "/" && address.index ? children : null;
}

// What belongs to the feed (the wall composer, the featured threads) is drawn on its tabs only; the
// featured threads not above a list narrowed by a filter, which may leave them out.
async function OnFeedTabs({
  searchParams,
  unfiltered = false,
  children,
}: PageProps<"/[locale]"> & {
  unfiltered?: boolean;
  children: React.ReactNode;
}) {
  const { tab, params } = await opening(searchParams);
  if (unfiltered && isFiltered(filterFromParams(params))) return null;
  return FEED_TABS.some((feed) => feed === tab) ? children : null;
}

const TAB_ICONS: Record<HomeTab, LucideIcon> = {
  latest: Clock,
  hot: TrendingUp,
  following: UserCheck,
  forums: MessagesSquare,
  media: Images,
};

// Two bars, one per screen size: a phone has every tab but Media on its bar, with icons and only
// the open tab's label on the narrowest screens; a wider screen pins three (`barOf`).
async function HomeTabs({ searchParams }: PageProps<"/[locale]">) {
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
        <>
          <FeedFilterBar tab={tab} filter={filterFromParams(params)} />
          <HomeFeed tab={tab} params={params} />
        </>
      )}
    </>
  );
}

type Params = Awaited<PageProps<"/[locale]">["searchParams"]>;

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
