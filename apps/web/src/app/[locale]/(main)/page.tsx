import { PenLine, Rss, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  moreFeed,
  newFeedCount,
} from "@/app/[locale]/(main)/_feed/feed-actions";
import {
  feedHref,
  feedPage,
  TABS,
  tabOf,
} from "@/app/[locale]/(main)/_feed/feed-page";
import { FeedSidebar } from "@/app/[locale]/(main)/_feed/feed-sidebar";
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
import { pagesParam } from "@/lib/list-pages";
import { POLL_MS } from "@/lib/poll-intervals";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.page");
  return { title: t("metaTitle") };
}

// The window the backend ranks the top feed over.
const TOP_DAYS = 7;

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

async function HomeFeed({ searchParams }: PageProps<"/[locale]">) {
  const [params, viewer, t] = await Promise.all([
    searchParams,
    getViewer(),
    getTranslations("home.page"),
  ]);
  const tab = tabOf(params.tab);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const needsLogin = tab === "following" && !viewer.user;
  const first = needsLogin ? null : await feedPage(tab, cursor);

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

      {first === null ? (
        <EmptyState
          icon={Users}
          title={t("loginTitle")}
          description={t("loginDescription")}
          className="rounded-lg border bg-card"
        >
          <Link
            href={`/login?next=${encodeURIComponent("/?tab=following")}`}
            className={cn(buttonVariants(), "h-10 px-4")}
          >
            {t("login")}
          </Link>
        </EmptyState>
      ) : first.rows.length === 0 && !first.nextCursor ? (
        <EmptyState
          icon={Rss}
          title={t("emptyTitle")}
          description={t(`empty.${tab}`, { count: TOP_DAYS })}
          className="rounded-lg border bg-card"
        />
      ) : (
        <PagedList
          first={first}
          more={moreFeed.bind(null, tab)}
          pages={pagesParam(params.pages)}
          start={cursor}
          listKey={["feed", tab]}
          hrefBase={feedHref(tab)}
          moreLabel={t("loadMore")}
          estimateSize={320}
          spacing="spaced"
          fresh={
            tab === "top"
              ? undefined
              : {
                  check: newFeedCount.bind(null, tab),
                  intervalMs: POLL_MS.feed,
                }
          }
        />
      )}
    </>
  );
}
