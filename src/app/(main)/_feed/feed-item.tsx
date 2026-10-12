import { Eye, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { ClampedBody } from "@/app/(main)/_feed/clamped-body";
import { react } from "@/app/(main)/actions";
import { Art } from "@/components/forum/art";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { LevelBadge } from "@/components/forum/level";
import { Markdown } from "@/components/forum/markdown";
import { messageActionClass } from "@/components/forum/message-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserHoverCard } from "@/components/forum/user-hover-card";
import { threadCoverSrc } from "@/lib/appearance";
import type {
  FeedItem as FeedEntry,
  ReactionsView,
  ReactionTarget,
  UserView,
} from "@/lib/db";
import { formatCompact } from "@/lib/format";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const contextLinkClass =
  "font-medium text-foreground underline-offset-4 hover:underline";

// About what the clamped box holds on a phone.
const CLAMP_LENGTH = 440;
const CLAMP_LINES = 7;

function Body({ href, children }: { href: string; children: string }) {
  return (
    <ClampedBody
      href={href}
      expectLong={
        children.length > CLAMP_LENGTH ||
        children.split("\n").length > CLAMP_LINES
      }
    >
      <Markdown>{children}</Markdown>
    </ClampedBody>
  );
}

function Card({
  item,
  context,
  highlighted = false,
  cover,
  target,
  targetId,
  reactions,
  href,
  count,
  noun,
  views,
  viewer,
  reactionTypes,
  children,
}: {
  item: FeedEntry;
  context: React.ReactNode;
  highlighted?: boolean;
  cover?: string | null;
  target: ReactionTarget;
  targetId: number;
  reactions: ReactionsView;
  href: string;
  count: number;
  noun: [singular: string, plural: string];
  views?: number;
  viewer: UserView | null;
  reactionTypes: ReactionType[];
  children: React.ReactNode;
}) {
  const { author } = item;
  return (
    <article
      className={cn(
        "relative isolate overflow-hidden rounded-lg border bg-card",
        highlighted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      {highlighted && (
        <CoverBackdrop cover={author.appearance.cover} variant="full" />
      )}
      {cover && (
        <Art
          src={threadCoverSrc(cover)}
          className="aspect-[4/1] w-full border-b sm:aspect-[5/1]"
        />
      )}
      <header className="flex items-start gap-3 px-4 pt-4">
        <UserAvatar user={author} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            <UserHoverCard user={author} className="[overflow-wrap:anywhere]" />
            <UserBadges user={author} />
            <LevelBadge level={author.level} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {context}
            {context && <span aria-hidden="true"> · </span>}
            <RelativeTime date={item.createdAt} className="whitespace-nowrap" />
          </p>
        </div>
        {highlighted && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-primary">
            <Sparkles aria-hidden="true" className="size-3" />
            Highlighted
          </span>
        )}
      </header>
      <div className="px-4 pt-3">{children}</div>
      <footer className="flex items-center gap-1 px-2 pt-1 pb-2">
        <ReactionButton
          action={react.bind(null, target, targetId)}
          total={reactions.total}
          viewerTypeId={reactions.viewerTypeId}
          types={reactionTypes}
          viewerId={viewer?.id ?? null}
          authorId={author.id}
        />
        <Link
          href={href}
          aria-label={`${count} ${noun[count === 1 ? 0 : 1]}`}
          className={messageActionClass}
        >
          <MessageCircle />
          {count}
        </Link>
        {views !== undefined && (
          <span className="inline-flex h-10 items-center gap-1.5 px-2 text-xs font-medium tabular-nums text-muted-foreground md:h-8">
            <Eye aria-hidden="true" className="size-4" />
            {formatCompact(views)}
            <span className="sr-only"> views</span>
          </span>
        )}
        <ShareButton href={href} className={messageActionClass} />
        <ReactionSummary reactions={reactions} className="ml-auto" />
      </footer>
    </article>
  );
}

export function FeedItem({
  item,
  viewer,
  reactionTypes,
}: {
  item: FeedEntry;
  viewer: UserView | null;
  reactionTypes: ReactionType[];
}) {
  if (item.type === "profilePost") {
    const { profilePost } = item;
    const href = `/members/${profilePost.profileUser.id}#profile-post-${profilePost.id}`;
    return (
      <Card
        item={item}
        context={
          profilePost.profileUserId !== profilePost.authorId && (
            <>
              posted on{" "}
              <UserHoverCard
                user={profilePost.profileUser}
                className="font-medium"
              />
              's profile
            </>
          )
        }
        target="profilePost"
        targetId={profilePost.id}
        reactions={profilePost.reactions}
        href={href}
        count={profilePost.comments.length}
        noun={["comment", "comments"]}
        viewer={viewer}
        reactionTypes={reactionTypes}
      >
        <Body href={href}>{profilePost.body}</Body>
      </Card>
    );
  }

  const { thread, post } = item;
  const isThread = item.type === "thread";
  const threadHref = `/threads/${thread.id}`;
  const href = isThread ? threadHref : `${threadHref}#post-${post.id}`;
  return (
    <Card
      item={item}
      context={
        <>
          {isThread ? "started a thread in" : "replied to a thread in"}{" "}
          <Link
            href={`/forums/${thread.forum.id}`}
            className={contextLinkClass}
          >
            {thread.forum.title}
          </Link>
        </>
      }
      highlighted={isThread && thread.highlighted}
      cover={isThread ? thread.cover : null}
      target="post"
      targetId={post.id}
      reactions={post.reactions}
      href={href}
      count={thread.replyCount}
      noun={["reply", "replies"]}
      views={isThread ? thread.views : undefined}
      viewer={viewer}
      reactionTypes={reactionTypes}
    >
      <h2
        className={cn(
          isThread ? "text-base md:text-lg" : "text-sm md:text-base",
          "leading-snug font-semibold [overflow-wrap:anywhere]",
        )}
      >
        {thread.prefix && (
          <PrefixTag
            prefix={thread.prefix}
            className="mr-1.5 align-[0.125rem]"
          />
        )}
        <ThreadHoverCard
          thread={thread}
          className="underline-offset-4 hover:underline"
        />
      </h2>
      {!isThread && (
        <p className="mt-2 truncate border-l-2 pl-2.5 text-xs text-muted-foreground">
          <span className="font-medium">{thread.author.username}:</span>{" "}
          {thread.excerpt}
        </p>
      )}
      <Body href={href}>{post.body}</Body>
    </Card>
  );
}
