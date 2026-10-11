import Link from "next/link";
import { FollowButton } from "@/app/(main)/members/wall-buttons";
import { ForumIcon } from "@/components/forum/forum-icon";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserHoverCard } from "@/components/forum/user-hover-card";
import {
  getCategories,
  getFollowing,
  getForumStats,
  getUsers,
  type ThreadView,
  type UserView,
} from "@/lib/db";
import { formatCompact } from "@/lib/format";

const LIST_SIZE = 5;

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

function ThreadTitle({ thread }: { thread: ThreadView }) {
  return (
    <ThreadHoverCard
      thread={thread}
      className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] hover:underline"
    >
      {thread.prefix && (
        <PrefixTag
          prefix={thread.prefix}
          className="mr-1.5 align-[0.0625rem]"
        />
      )}
      {thread.title}
    </ThreadHoverCard>
  );
}

export async function FeedSidebar({ viewer }: { viewer: UserView | null }) {
  const [stats, categories, users, following] = await Promise.all([
    getForumStats(LIST_SIZE),
    getCategories(),
    getUsers(),
    viewer ? getFollowing(viewer.id) : [],
  ]);
  const forums = categories.flatMap((category) => category.forums);
  const followedIds = new Set(following.map((user) => user.id));
  const suggestions = users
    .filter((user) => user.id !== viewer?.id && !followedIds.has(user.id))
    .toSorted((a, b) => b.followerCount - a.followerCount)
    .slice(0, 4);

  return (
    <>
      <SectionCard title="Trending">
        <ol className="divide-y divide-border">
          {stats.mostReacted.map((thread, index) => (
            <li key={thread.id} className="flex gap-3 px-4 py-2.5">
              <span className="w-4 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <ThreadTitle thread={thread} />
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatCompact(thread.reactionCount)}{" "}
                  {thread.reactionCount === 1 ? "reaction" : "reactions"} ·{" "}
                  {formatCompact(thread.replyCount)}{" "}
                  {thread.replyCount === 1 ? "reply" : "replies"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Latest threads">
        {stats.latestPosts.map((thread) => (
          <div key={thread.id} className="px-4 py-2.5">
            <ThreadTitle thread={thread} />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <UserHoverCard
                user={thread.lastPost.author}
                className="font-medium"
              />{" "}
              · <RelativeTime date={thread.lastPost.createdAt} />
            </p>
          </div>
        ))}
      </SectionCard>

      {suggestions.length > 0 && (
        <SectionCard title="Members to follow">
          {suggestions.map((user) => (
            <MemberRow key={user.id} user={user}>
              <FollowButton user={user} viewer={viewer} following={false} />
            </MemberRow>
          ))}
        </SectionCard>
      )}

      <SectionCard
        title="Forums"
        action={
          <Link href="/forums" className={viewAllClass}>
            View all
          </Link>
        }
      >
        {forums.slice(0, 6).map((forum) => (
          <Link
            key={forum.id}
            href={`/forums/${forum.slug}`}
            className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/30"
          >
            <ForumIcon
              name={forum.icon}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {forum.title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatCompact(forum.threadCount)}
              <span className="sr-only"> threads</span>
            </span>
          </Link>
        ))}
      </SectionCard>
    </>
  );
}
