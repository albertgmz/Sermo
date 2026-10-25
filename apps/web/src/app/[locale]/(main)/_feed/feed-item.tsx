import type { feedList } from "@sermo/core/contracts";
import { Eye, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import type * as z from "zod";
import { ClampedBody } from "@/app/[locale]/(main)/_feed/clamped-body";
import { CompactFeedItem } from "@/app/[locale]/(main)/_feed/compact-item";
import { replyFromFeed } from "@/app/[locale]/(main)/actions";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { commentOnWallPost } from "@/app/[locale]/(main)/members/actions";
import { earlierComments } from "@/app/[locale]/(main)/members/earlier-comments";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { AdultBadge, adultMarked } from "@/components/forum/adult-badge";
import { Art } from "@/components/forum/art";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { FeatureMark } from "@/components/forum/feature-mark";
import { FirstUnreadLink } from "@/components/forum/first-unread-link";
import { HideForumButton } from "@/components/forum/hide-forum-button";
import { HtmlContent } from "@/components/forum/html-content";
import { InlineReply } from "@/components/forum/inline-reply";
import { LevelBadge } from "@/components/forum/level";
import { messageActionClass } from "@/components/forum/message-row";
import { PollBadge } from "@/components/forum/poll-badge";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import type { SpoilerContent } from "@/components/forum/spoiler-reveal";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import {
  hasWallComments,
  oldestFirst,
  WallComments,
} from "@/components/forum/wall-comments";
import {
  WallItemActions,
  WallItemSummary,
} from "@/components/forum/wall-item-actions";
import {
  contextLinkClass,
  UnnamedWall,
  WallOwner,
  wallPlace,
} from "@/components/forum/wall-owner";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import type { FeedView } from "@/lib/feed-view";
import { formatCompact } from "@/lib/format";
import { type Lookup, memberIdOf } from "@/lib/sermo/authors";
import { threadOpenHref } from "@/lib/sermo/open-links";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { threadCard } from "@/lib/sermo/threads";
import type { AuthorView, PictureView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type ApiFeedItem = z.output<typeof feedList.output>["items"][number];

// About what the clamped box holds on a phone.
const CLAMP_LENGTH = 440;
const CLAMP_LINES = 7;

// A guess for the first HTML, from the markup alone.
function looksLong(html: string) {
  const text = html.replace(/<[^>]*>/g, "");
  const blocks = html.match(/<(?:p|li|h[1-6]|pre|blockquote)\b/g) ?? [];
  return text.length > CLAMP_LENGTH || blocks.length > CLAMP_LINES;
}

function Body({
  href,
  content,
  attachments,
  children,
}: {
  href: string;
  content: SpoilerContent;
  attachments?: ComponentProps<typeof HtmlContent>["attachments"];
  children: string;
}) {
  return (
    <ClampedBody href={href} expectLong={looksLong(children)}>
      <HtmlContent content={content} attachments={attachments}>
        {children}
      </HtmlContent>
    </ClampedBody>
  );
}

// The count of answers, a link to where they are: the card's own composer when the viewer may answer
// there, otherwise the item itself.
function AnswerCount({
  href,
  count,
  noun,
}: {
  href: string;
  count: number;
  noun: "comments" | "replies";
}) {
  const t = useTranslations("home.feedItem");
  const format = useFormatter();
  const formattedCount = format.number(count, { useGrouping: false });
  return (
    <Link
      href={href}
      aria-label={t(noun, { count, value: formattedCount })}
      className={messageActionClass}
    >
      <MessageCircle />
      {formattedCount}
    </Link>
  );
}

function Card({
  id,
  author,
  createdAt,
  context,
  attribution,
  highlighted = false,
  featured = null,
  cover,
  footer,
  answers,
  children,
}: {
  id: string;
  author: AuthorView;
  createdAt: string;
  context: React.ReactNode;
  // After the author's name and badges: `▸ Owner` on a wall post made on another member's wall.
  attribution?: React.ReactNode;
  highlighted?: boolean;
  // Why the thread is featured: a moderator picked it, or its author paid for a promotion.
  featured?: "staff" | "paid" | null;
  cover?: PictureView | null;
  // The card's actions: a thread's `Footer`, or a wall post's own bar, the same as on the profile
  // wall (`WallItemActions`).
  footer: React.ReactNode;
  // What sits under the card's actions: the comments, the composer.
  answers?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("home.feedItem");
  const { member } = author;
  return (
    <article
      id={id}
      data-shortcut-item=""
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
            {attribution}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {context}
            {context && <span aria-hidden="true"> · </span>}
            <RelativeTime date={createdAt} className="whitespace-nowrap" />
          </p>
        </div>
        {(highlighted || featured) && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {featured && (
              <FeatureMark
                kind={featured}
                className="text-(length:--text-caption)"
              />
            )}
            {highlighted && (
              <span className="inline-flex items-center gap-1 text-(length:--text-caption) font-medium text-primary-ink">
                <Sparkles aria-hidden="true" className="size-3" />
                {t("highlighted")}
              </span>
            )}
          </div>
        )}
      </header>
      <div className="px-4 pt-3">{children}</div>
      {footer}
      {answers && <div className="px-4 pb-4">{answers}</div>}
    </article>
  );
}

// A thread card's footer: react, the count of answers, its own actions (the unread count, the
// Reply button), the views, share and the button that keeps the forum out of the member's feed.
function Footer({
  reaction,
  count,
  actions,
  views,
  href,
  hideForum,
}: {
  reaction: React.ReactNode;
  count: React.ReactNode;
  actions: React.ReactNode;
  views?: number;
  // The address the card shares.
  href: string;
  // The forum a member may keep out of their own feed from the card.
  hideForum?: { id: number; title: string };
}) {
  const locale = useLocale();
  const t = useTranslations("home.feedItem");
  return (
    <footer className="flex flex-wrap items-center gap-1 px-2 pt-1 pb-2">
      {reaction}
      {count}
      {actions}
      {views !== undefined && (
        <span className="inline-flex h-10 items-center gap-1.5 px-2 text-xs font-medium tabular-nums text-muted-foreground md:h-8">
          <Eye aria-hidden="true" className="size-4" />
          {t.rich("views", {
            count: views,
            value: formatCompact(views, locale),
            label: (chunks) => <span className="sr-only">{chunks}</span>,
          })}
        </span>
      )}
      <ShareButton href={href} className={messageActionClass} />
      {hideForum && (
        <HideForumButton
          nodeId={hideForum.id}
          title={hideForum.title}
          className={messageActionClass}
        />
      )}
    </footer>
  );
}

export function FeedItem({
  item,
  author,
  now,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  view = "cards",
  adultMode = false,
}: {
  item: ApiFeedItem;
  author: Lookup<AuthorView>;
  // The clock, read by the page after its request data.
  now: number;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
  // Full cards, or one compact row each.
  view?: FeedView;
  // The site's +18 mode is on: a thread marked +18 (or in a +18 forum) carries the mark.
  adultMode?: boolean;
}) {
  const t = useTranslations("home.feedItem");
  if (view === "compact") {
    return (
      <CompactFeedItem
        item={item}
        author={author}
        now={now}
        signedIn={viewerId !== null}
        adultMode={adultMode}
      />
    );
  }
  if (item.type === "profilePost") {
    const { profilePost } = item;
    const href = wallTargetHref(profilePost.profileUserId, profilePost.id);
    const anchor = `feed-profile-post-${profilePost.id}`;
    const place = wallPlace(
      memberIdOf(profilePost.author),
      profilePost.profileUserId,
      (id) => author(id).member,
    );
    const comments = profilePost.latestComments;
    const answerHref = profilePost.canComment ? `#${anchor}-comment` : href;
    const oldest = oldestFirst(comments)[0];
    const earlier =
      oldest && profilePost.commentCount > comments.length
        ? {
            load: earlierComments.bind(
              null,
              profilePost.id,
              profilePost.profileUserId,
              oldest.id,
              null,
            ),
          }
        : undefined;
    // Who reacted heads the block of comments, as on the profile wall; with no block, it sits under
    // the bar.
    const block = hasWallComments(profilePost, comments, earlier);
    const reactions = {
      kind: "post" as const,
      item: profilePost,
      viewerId,
      picker,
      reactionTypes,
      viewList,
    };
    return (
      <Card
        id={anchor}
        author={author(profilePost.author)}
        createdAt={item.createdAt}
        attribution={
          place.kind === "other" && (
            <WallOwner
              owner={place.owner}
              className="[overflow-wrap:anywhere]"
            />
          )
        }
        context={
          place.kind === "unnamed" && (
            <UnnamedWall ownerId={profilePost.profileUserId} />
          )
        }
        footer={
          <footer className="px-4 pb-2">
            <WallItemActions
              {...reactions}
              address={{
                profileUserId: profilePost.profileUserId,
                postId: profilePost.id,
              }}
              summary={!block}
              start={
                <AnswerCount
                  href={answerHref}
                  count={profilePost.commentCount}
                  noun="comments"
                />
              }
            />
          </footer>
        }
        answers={
          block && (
            <WallComments
              anchor={anchor}
              profileUserId={profilePost.profileUserId}
              comments={comments}
              earlier={earlier}
              summary={<WallItemSummary {...reactions} />}
              action={
                profilePost.canComment
                  ? commentOnWallPost.bind(null, profilePost.id, undefined)
                  : undefined
              }
              member={(id) => author(id).member}
              viewerId={viewerId}
              picker={picker}
              reactionTypes={reactionTypes}
              viewList={viewList}
              className="mt-0"
            />
          )
        }
      >
        <Body
          href={href}
          content={{ type: "profile_post", id: profilePost.id }}
          attachments={profilePost.attachments}
        >
          {profilePost.bodyHtml}
        </Body>
        <PostAttachments
          attachments={profilePost.attachments}
          inline={inlineAttachmentIds(
            profilePost.bodyHtml,
            profilePost.attachments,
          )}
        />
      </Card>
    );
  }

  const { thread, post } = item;
  const isThread = item.type === "thread";
  // The address the card shares and its text expands to: no reading position in it.
  const href = isThread
    ? threadHref(thread.id, 0)
    : threadHref(thread.id, post.position, post.id);
  // Where the count of answers leads: a thread opens where the member left off.
  const answersHref = isThread
    ? threadOpenHref(thread.id, viewerId !== null)
    : href;
  const card = threadCard(thread, (ref) => author(ref).member);
  const anchor = `feed-post-${post.id}`;
  return (
    <Card
      id={anchor}
      author={author(post.author)}
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
      featured={item.featured}
      cover={isThread ? card.coverPicture : null}
      footer={
        <Footer
          reaction={
            <Reactions
              target="post"
              id={post.id}
              reactions={post.reactions}
              authorId={memberIdOf(post.author)}
              viewerId={viewerId}
              picker={picker}
              reactionTypes={reactionTypes}
              viewList={viewList}
            />
          }
          count={
            <AnswerCount
              href={answersHref}
              count={thread.replyCount}
              noun="replies"
            />
          }
          views={isThread ? thread.viewCount : undefined}
          href={href}
          hideForum={
            viewerId === null
              ? undefined
              : { id: thread.node.id, title: thread.node.title }
          }
          actions={
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
              {item.canReply && (
                <InlineReply
                  action={replyFromFeed.bind(null, thread.id)}
                  label={t("reply")}
                  placeholder={t("replyPlaceholder")}
                  submitLabel={t("replySubmit")}
                  anchor={`${anchor}-comment`}
                />
              )}
            </>
          }
        />
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
          href={threadOpenHref(thread.id, viewerId !== null)}
          className="underline-offset-4 hover:underline"
        />
      </h2>
      {(thread.pollKind ||
        adultMarked(adultMode, thread.isAdult, thread.adultByForum)) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {adultMarked(adultMode, thread.isAdult, thread.adultByForum) && (
            <AdultBadge className="h-6" />
          )}
          {thread.pollKind && (
            <PollBadge kind={thread.pollKind} className="h-6" />
          )}
        </div>
      )}
      {!isThread && (
        <p className="mt-2 truncate border-l-2 pl-2.5 text-xs text-muted-foreground">
          <UserLink user={card.author.member} className="font-medium" />:{" "}
          {thread.excerpt}
        </p>
      )}
      <Body href={href} content={{ type: "post", id: post.id }}>
        {post.bodyHtml}
      </Body>
    </Card>
  );
}
