import { ChevronDown, PenLine, Rss, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FeedItem } from "@/app/(main)/_feed/feed-item";
import { FeedSidebar } from "@/app/(main)/_feed/feed-sidebar";
import { postToWall } from "@/app/(main)/members/actions";
import { CompactComposer } from "@/components/forum/compact-composer";
import { EmptyState } from "@/components/forum/empty-state";
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

export const metadata: Metadata = {
  title: "Home - forum/ui",
};

const PAGE_SIZE = 20;
const TOP_DAYS = 7;
const DAY = 86_400_000;

const TABS = ["latest", "following", "top"] as const;

type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  latest: "Latest",
  following: "Following",
  top: "Top",
};

const EMPTY: Record<Tab, string> = {
  latest: "New threads, replies and profile posts will show up here.",
  following: "Posts from the members you follow will show up here.",
  top: `Nothing has been reacted to in the last ${TOP_DAYS} days.`,
};

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

export default async function HomePage({ searchParams }: PageProps<"/">) {
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

  return (
    <PageLayout
      aside={<FeedSidebar viewer={viewer} />}
      asideOnMobile="hidden"
      mainClassName="space-y-(--page-gap)"
    >
      <h1 className="sr-only">Home</h1>
      {viewer && (
        <section
          aria-label="New post"
          className="overflow-hidden rounded-lg border bg-card"
        >
          <CompactComposer
            action={postToWall.bind(null, viewer.id)}
            user={viewer}
            placeholder="What's on your mind?"
            submitLabel="Post to your profile"
            className="p-4"
          />
          <div className="flex items-center justify-between gap-3 border-t py-2 pr-2 pl-4">
            <p className="min-w-0 text-xs text-pretty text-muted-foreground">
              Posts go to your profile wall.
            </p>
            <Link
              href="/forums"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "h-10 px-3 md:h-8",
              )}
            >
              <PenLine />
              Start a thread
            </Link>
          </div>
        </section>
      )}

      <TabLinks
        tabs={TABS.map((value) => ({
          value,
          label: LABELS[value],
          href: feedHref(value),
        }))}
        active={tab}
        label="Feed"
        variant="segmented"
      />
      {tab === "top" && (
        <p className="text-xs text-muted-foreground">
          Most reacted in the last {TOP_DAYS} days.
        </p>
      )}

      {needsLogin ? (
        <EmptyState
          icon={Users}
          title="Follow members to build your feed"
          description="Log in to see posts from the members you follow."
          className="rounded-lg border bg-card"
        >
          <Link href="/login" className={cn(buttonVariants(), "h-10 px-4")}>
            Log in
          </Link>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="Nothing here yet"
          description={EMPTY[tab]}
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
              Load more
            </Link>
          )}
        </>
      )}
    </PageLayout>
  );
}
