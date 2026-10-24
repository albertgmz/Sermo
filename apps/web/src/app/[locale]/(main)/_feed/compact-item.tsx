import type { feedList } from "@sermo/core/contracts";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type * as z from "zod";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { FeatureMark } from "@/components/forum/feature-mark";
import { FirstUnreadLink } from "@/components/forum/first-unread-link";
import { messageActionClass } from "@/components/forum/message-action";
import { PollBadge } from "@/components/forum/poll-badge";
import { RelativeTime } from "@/components/forum/relative-time";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  contextLinkClass,
  UnnamedWall,
  WallOwner,
  wallPlace,
} from "@/components/forum/wall-owner";
import type { Lookup } from "@/lib/sermo/authors";
import { threadOpenHref } from "@/lib/sermo/open-links";
import { threadCard } from "@/lib/sermo/threads";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

type Item = z.output<typeof feedList.output>["items"][number];

// One entry of the feed as a single row: who, what it is about, how many answers, how many posts
// are new. No text of the post, no reactions and no reply box, so a row is the same two lines
// whatever it holds and nothing in it loads later: switching views, or scrolling a long list,
// moves nothing under the reader.
export function CompactFeedItem({
  item,
  author,
  now,
  signedIn,
}: {
  item: Item;
  author: Lookup<AuthorView>;
  // The clock, read by the page after its request data.
  now: number;
  // Whether the viewer is a member: a thread opens where they left off (`threadOpenHref`).
  signedIn: boolean;
}) {
  const t = useTranslations("home.feedItem");
  const format = useFormatter();

  if (item.type === "profilePost") {
    const { profilePost } = item;
    const href = wallTargetHref(profilePost.profileUserId, profilePost.id);
    const count = profilePost.commentCount;
    const place = wallPlace(
      profilePost.author.id,
      profilePost.profileUserId,
      (id) => author(id).member,
    );
    return (
      <Row
        id={`feed-profile-post-${profilePost.id}`}
        href={href}
        avatar={
          <UserAvatar
            user={author(profilePost.author.id).member}
            className="relative z-10"
          />
        }
        title={
          <>
            <UserLink
              user={author(profilePost.author.id).member}
              className="relative z-10"
            />
            {place.kind === "other" && (
              <>
                {" "}
                <WallOwner owner={place.owner} className="relative z-10" />
              </>
            )}
            {place.kind === "unnamed" && (
              <span className="font-normal text-muted-foreground">
                {" "}
                <UnnamedWall
                  ownerId={profilePost.profileUserId}
                  className="relative z-10"
                />
              </span>
            )}
          </>
        }
        meta={<RelativeTime date={item.createdAt} />}
        end={
          <Link
            href={href}
            aria-label={t("comments", {
              count,
              value: format.number(count, { useGrouping: false }),
            })}
            className={messageActionClass}
          >
            <MessageCircle />
            {format.number(count, { useGrouping: false })}
          </Link>
        }
      />
    );
  }

  const { thread, post } = item;
  const isThread = item.type === "thread";
  const href = isThread
    ? threadOpenHref(thread.id, signedIn)
    : threadHref(thread.id, post.position, post.id);
  const card = threadCard(thread, (ref) => author(ref).member);
  const count = thread.replyCount;
  return (
    <Row
      id={`feed-post-${post.id}`}
      href={href}
      avatar={
        <UserAvatar
          user={author(post.author).member}
          className="relative z-10"
        />
      }
      highlighted={
        isThread &&
        thread.highlightedUntil !== null &&
        Date.parse(thread.highlightedUntil) > now
      }
      title={
        <ThreadHoverCard
          thread={card}
          href={threadOpenHref(thread.id, signedIn)}
          className="relative z-10 hover:underline"
        />
      }
      meta={
        <>
          {item.featured && (
            <FeatureMark
              kind={item.featured}
              className="shrink-0 text-(length:--text-caption)"
            />
          )}
          {thread.pollKind && (
            <PollBadge
              kind={thread.pollKind}
              className="h-5 shrink-0"
              iconOnPhone
            />
          )}
          <span className="min-w-0 truncate">
            <UserLink
              user={author(post.author).member}
              className="relative z-10"
            />
            <span aria-hidden="true"> · </span>
            {t.rich(isThread ? "threadContext" : "replyContext", {
              title: thread.node.title,
              forum: (chunks) => (
                <Link
                  href={`/forums/${thread.node.id}`}
                  className={cn(contextLinkClass, "relative z-10")}
                >
                  {chunks}
                </Link>
              ),
            })}
            <span aria-hidden="true"> · </span>
            <RelativeTime date={item.createdAt} className="whitespace-nowrap" />
          </span>
        </>
      }
      end={
        <>
          {item.unread && (
            <FirstUnreadLink
              href={threadHref(
                thread.id,
                item.unread.firstPosition,
                item.unread.firstPostId,
              )}
              count={item.unread.count}
              more={item.unread.more}
            />
          )}
          <Link
            href={href}
            aria-label={t("replies", {
              count,
              value: format.number(count, { useGrouping: false }),
            })}
            className={messageActionClass}
          >
            <MessageCircle />
            {format.number(count, { useGrouping: false })}
          </Link>
        </>
      }
    />
  );
}

// The row's frame: the avatar, two lines (what it is, who and where) and the actions at the end.
// The whole row is a link, so the target to open it is as big as the row.
function Row({
  id,
  href,
  avatar,
  title,
  meta,
  end,
  highlighted = false,
}: {
  id: string;
  // Where the whole row leads: a link stretched over it, under the row's own links and buttons.
  href: string;
  avatar: React.ReactNode;
  title: React.ReactNode;
  meta: React.ReactNode;
  end: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <article
      id={id}
      data-shortcut-item=""
      className={cn(
        "relative isolate flex scroll-mt-4 items-center gap-3 overflow-hidden rounded-lg border bg-card px-3 py-2",
        highlighted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      <Link
        href={href}
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0"
      />
      {avatar}
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-1 text-sm leading-snug font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {meta}
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {end}
      </div>
    </article>
  );
}
