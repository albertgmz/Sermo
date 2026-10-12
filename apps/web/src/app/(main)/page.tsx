import { feedList } from "@sermo/core/contracts";
import { ChevronDown, Rss, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FeedItem } from "@/app/(main)/_feed/feed-item";
import { FeedSidebar } from "@/app/(main)/_feed/feed-sidebar";
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
import { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.page");
  return { title: t("metaTitle") };
}

// The window the backend ranks the top feed over.
const TOP_DAYS = 7;

const TABS = ["latest", "following", "top"] as const;

type Tab = (typeof TABS)[number];

function feedHref(tab: Tab, cursor?: string) {
  const params = new URLSearchParams();
  if (tab !== "latest") params.set("tab", tab);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/?${query}` : "/";
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
          <FeedSidebar />
        </Suspense>
      }
      asideOnMobile="hidden"
      mainClassName="space-y-(--page-gap)"
    >
      <h1 className="sr-only">{t("heading")}</h1>
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

async function HomeFeed({ searchParams }: PageProps<"/">) {
  const [params, viewer, reactionTypes] = await Promise.all([
    searchParams,
    getViewer(),
    getReactionTypes(),
  ]);
  const tab = TABS.find((value) => value === params.tab) ?? "latest";
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const needsLogin = tab === "following" && !viewer.user;
  const feed = needsLogin
    ? { items: [], nextCursor: null }
    : await read(feedList, { scope: tab, cursor });
  const author = await authorsFor(
    feed.items.flatMap((item) =>
      item.type === "profilePost"
        ? [item.profilePost.author]
        : [item.post.author, ...threadMembers(item.thread)],
    ),
  );
  const picker = viewer.permissions.canReact ? pickerTypes(reactionTypes) : [];
  const t = await getTranslations("home.page");
  const now = Date.now();

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
          <Link
            href={`/login?next=${encodeURIComponent("/?tab=following")}`}
            className={cn(buttonVariants(), "h-10 px-4")}
          >
            {t("login")}
          </Link>
        </EmptyState>
      ) : feed.items.length === 0 && !feed.nextCursor ? (
        <EmptyState
          icon={Rss}
          title={t("emptyTitle")}
          description={t(`empty.${tab}`, { count: TOP_DAYS })}
          className="rounded-lg border bg-card"
        />
      ) : (
        <>
          {feed.items.map((item) => (
            <FeedItem
              key={`${item.type}-${item.type === "profilePost" ? item.profilePost.id : item.post.id}`}
              item={item}
              author={author}
              now={now}
              viewerId={viewer.user?.id ?? null}
              picker={picker}
              reactionTypes={reactionTypes}
            />
          ))}
          {feed.nextCursor && (
            <Link
              href={feedHref(tab, feed.nextCursor)}
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
