import type { feedList } from "@sermo/core/contracts";
import { Eye, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type * as z from "zod";
import { ClampedBody } from "@/app/(main)/_feed/clamped-body";
import { replyFromFeed } from "@/app/(main)/actions";
import { wallHref } from "@/app/(main)/members/[id]/wall";
import { commentOnWallPost } from "@/app/(main)/members/actions";
import { PostAttachments } from "@/app/(main)/threads/[id]/post-attachments";
import { Art } from "@/components/forum/art";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { HtmlContent } from "@/components/forum/html-content";
import { LevelBadge } from "@/components/forum/level";
import { LineComposer } from "@/components/forum/line-composer";
import { messageActionClass } from "@/components/forum/message-row";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import {
  hasWallComments,
  WallComments,
} from "@/components/forum/wall-comments";
import { formatCompact } from "@/lib/format";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { threadCard } from "@/lib/sermo/threads";
import type { AuthorView, PictureView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type ApiFeedItem = z.output<typeof feedList.output>["items"][number];

const contextLinkClass =
  "font-medium text-foreground underline-offset-4 hover:underline";

// About what the clamped box holds on a phone.
const CLAMP_LENGTH = 440;
const CLAMP_LINES = 7;

// A guess for the first HTML, from the markup alone.
function looksLong(html: string) {
  const text = html.replace(/<[^>]*>/g, "");
  const blocks = html.match(/<(?:p|li|h[1-6]|pre|blockquote)\b/g) ?? [];
  return text.length > CLAMP_LENGTH || blocks.length > CLAMP_LINES;
}

function Body({ href, children }: { href: string; children: string }) {
  return (
    <ClampedBody href={href} expectLong={looksLong(children)}>
      <HtmlContent>{children}</HtmlContent>
    </ClampedBody>
  );
}

// Where the count of answers leads: to the card's own composer when the viewer may answer
// there, to the login page and back to the feed for a guest, otherwise to the item itself.
function answerHref(
  canAnswer: boolean,
  anchor: string,
  viewerId: number | null,
  returnTo: string,
  href: string,
) {
  if (canAnswer) return `#${anchor}-comment`;
  if (viewerId === null) return `/login?next=${encodeURIComponent(returnTo)}`;
  return href;
}

function Card({
  id,
  author,
  createdAt,
  context,
  highlighted = false,
  cover,
  reaction,
  href,
  answerHref,
  count,
  noun,
  views,
  answers,
  children,
}: {
  id: string;
  author: AuthorView;
  createdAt: string;
  context: React.ReactNode;
  highlighted?: boolean;
  cover?: PictureView | null;
  reaction: React.ReactNode;
  href: string;
  answerHref: string;
  count: number;
  noun: "comments" | "replies";
  views?: number;
  // What sits under the card's actions: the comments, the composer.
  answers?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("home.feedItem");
  const format = useFormatter();
  const formattedCount = format.number(count, { useGrouping: false });
  const { member } = author;
  return (
    <article
      id={id}
      className={cn(
        "relative isolate scroll-mt-4 overflow-hidden rounded-lg border bg-card",
        highlighted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      {highlighted && <CoverBackdrop cover={author.cover} variant="full" />}
      {cover && (
        <Art
          category="threadCovers"
          src={cover.url}
          className="aspect-[4/1] w-full border-b sm:aspect-[5/1]"
        />
      )}
      <header className="flex items-start gap-3 px-4 pt-4">
        <UserAvatar user={member} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            <UserLink user={member} className="[overflow-wrap:anywhere]" />
            <UserBadges user={member} />
            <LevelBadge level={{ level: member.level }} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {context}
            {context && <span aria-hidden="true"> · </span>}
            <RelativeTime date={createdAt} className="whitespace-nowrap" />
          </p>
        </div>
        {highlighted && (
          <span className="inline-flex shrink-0 items-center gap-1 text-(length:--text-caption) font-medium text-primary">
            <Sparkles aria-hidden="true" className="size-3" />
            {t("highlighted")}
          </span>
        )}
      </header>
      <div className="px-4 pt-3">{children}</div>
      <footer className="flex items-center gap-1 px-2 pt-1 pb-2">
        {reaction}
        <Link
          href={answerHref}
          aria-label={t(noun, { count, value: formattedCount })}
          className={messageActionClass}
        >
          <MessageCircle />
          {formattedCount}
        </Link>
        {views !== undefined && (
          <span className="inline-flex h-10 items-center gap-1.5 px-2 text-xs font-medium tabular-nums text-muted-foreground md:h-8">
            <Eye aria-hidden="true" className="size-4" />
            {t.rich("views", {
              count: views,
              value: formatCompact(views),
              label: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
        )}
        <ShareButton href={href} className={messageActionClass} />
      </footer>
      {answers && <div className="px-4 pb-4">{answers}</div>}
    </article>
  );
}

export function FeedItem({
  item,
  author,
  now,
  viewerId,
  picker,
  reactionTypes,
  returnTo,
}: {
  item: ApiFeedItem;
  author: (id: number) => AuthorView;
  // The clock, read by the page after its request data.
  now: number;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  // The feed address the card is on: where an answer written in it returns to.
  returnTo: string;
}) {
  const t = useTranslations("home.feedItem");
  if (item.type === "profilePost") {
    const { profilePost } = item;
    const href = `/members/${profilePost.profileUserId}#profile-post-${profilePost.id}`;
    const anchor = `feed-profile-post-${profilePost.id}`;
    const comments = profilePost.latestComments;
    const links =
      profilePost.commentCount > comments.length
        ? {
            more: `${wallHref(profilePost.profileUserId, {
              comments: { postId: profilePost.id },
            })}#profile-post-${profilePost.id}`,
          }
        : {};
    return (
      <Card
        id={anchor}
        author={author(profilePost.author.id)}
        createdAt={item.createdAt}
        context={
          profilePost.profileUserId !== profilePost.author.id &&
          t.rich("profileContext", {
            profile: (chunks) => (
              <Link
                href={`/members/${profilePost.profileUserId}`}
                className={contextLinkClass}
              >
                {chunks}
              </Link>
            ),
          })
        }
        reaction={
          <Reactions
            target="profilePost"
            id={profilePost.id}
            reactions={profilePost.reactions}
            authorId={profilePost.author.id}
            viewerId={viewerId}
            picker={profilePost.state === "visible" ? picker : []}
            reactionTypes={reactionTypes}
          />
        }
        href={href}
        answerHref={answerHref(
          profilePost.canComment,
          anchor,
          viewerId,
          returnTo,
          href,
        )}
        count={profilePost.commentCount}
        noun="comments"
        answers={
          hasWallComments(profilePost, comments, links) && (
            <WallComments
              anchor={anchor}
              comments={comments}
              links={links}
              action={
                profilePost.canComment
                  ? commentOnWallPost.bind(null, profilePost.id, returnTo)
                  : undefined
              }
              member={(id) => author(id).member}
              viewerId={viewerId}
              picker={picker}
              reactionTypes={reactionTypes}
              className="mt-0"
            />
          )
        }
      >
        <Body href={href}>{profilePost.bodyHtml}</Body>
        <PostAttachments attachments={profilePost.attachments} />
      </Card>
    );
  }

  const { thread, post } = item;
  const isThread = item.type === "thread";
  const threadHref = `/threads/${thread.id}`;
  const href = isThread ? threadHref : `${threadHref}#post-${post.id}`;
  const card = threadCard(thread, (id) => author(id).member);
  const anchor = `feed-post-${post.id}`;
  return (
    <Card
      id={anchor}
      author={author(post.author.id)}
      createdAt={item.createdAt}
      context={t.rich(isThread ? "threadContext" : "replyContext", {
        title: thread.node.title,
        forum: (chunks) => (
          <Link href={`/forums/${thread.node.id}`} className={contextLinkClass}>
            {chunks}
          </Link>
        ),
      })}
      highlighted={
        isThread &&
        thread.highlightedUntil !== null &&
        Date.parse(thread.highlightedUntil) > now
      }
      cover={isThread ? card.coverPicture : null}
      reaction={
        <Reactions
          target="post"
          id={post.id}
          reactions={post.reactions}
          authorId={post.author.id}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
        />
      }
      href={href}
      answerHref={answerHref(item.canReply, anchor, viewerId, returnTo, href)}
      count={thread.replyCount}
      noun="replies"
      views={isThread ? thread.viewCount : undefined}
      answers={
        item.canReply && (
          <div id={`${anchor}-comment`} className="scroll-mt-24">
            <LineComposer
              action={replyFromFeed.bind(null, thread.id, returnTo)}
              placeholder={t("replyPlaceholder")}
              submitLabel={t("replySubmit")}
            />
          </div>
        )
      }
    >
      <h2
        className={cn(
          isThread ? "text-base md:text-lg" : "text-sm md:text-base",
          "leading-snug font-semibold [overflow-wrap:anywhere]",
        )}
      >
        <ThreadHoverCard
          thread={card}
          className="underline-offset-4 hover:underline"
        />
      </h2>
      {!isThread && (
        <p className="mt-2 truncate border-l-2 pl-2.5 text-xs text-muted-foreground">
          <UserLink user={card.author.member} className="font-medium" />:{" "}
          {thread.excerpt}
        </p>
      )}
      <Body href={href}>{post.bodyHtml}</Body>
    </Card>
  );
}
