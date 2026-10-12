import type { feedList } from "@sermo/core/contracts";
import { Eye, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type * as z from "zod";
import { ClampedBody } from "@/app/(main)/_feed/clamped-body";
import { react } from "@/app/(main)/actions";
import { Art } from "@/components/forum/art";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { HtmlContent } from "@/components/forum/html-content";
import { LevelBadge } from "@/components/forum/level";
import { messageActionClass } from "@/components/forum/message-row";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { formatCompact } from "@/lib/format";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { reactionsView } from "@/lib/sermo/reactions";
import { threadCard } from "@/lib/sermo/threads";
import type { AuthorView, PictureView } from "@/lib/sermo/views";
import type { ReactionType } from "@/lib/types";
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

function Card({
  author,
  createdAt,
  context,
  highlighted = false,
  cover,
  reaction,
  summary,
  href,
  count,
  noun,
  views,
  children,
}: {
  author: AuthorView;
  createdAt: string;
  context: React.ReactNode;
  highlighted?: boolean;
  cover?: PictureView | null;
  reaction: React.ReactNode;
  summary: React.ReactNode;
  href: string;
  count: number;
  noun: "comments" | "replies";
  views?: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("home.feedItem");
  const format = useFormatter();
  const formattedCount = format.number(count, { useGrouping: false });
  const { member } = author;
  return (
    <article
      className={cn(
        "relative isolate overflow-hidden rounded-lg border bg-card",
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
          href={href}
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
        {summary}
      </footer>
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
}: {
  item: ApiFeedItem;
  author: (id: number) => AuthorView;
  // The clock, read by the page after its request data.
  now: number;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
}) {
  const t = useTranslations("home.feedItem");
  if (item.type === "profilePost") {
    const { profilePost } = item;
    const href = `/members/${profilePost.profileUserId}#profile-post-${profilePost.id}`;
    return (
      <Card
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
        // Reactions to wall posts are still kept with the profiles: only the count shows here.
        reaction={null}
        summary={
          <ReactionSummary
            reactions={reactionsView(profilePost.reactions, reactionTypes)}
            loadUsers={loadReactionUsers.bind(
              null,
              "profile_post",
              profilePost.id,
            )}
            className="ml-auto"
          />
        }
        href={href}
        count={profilePost.commentCount}
        noun="comments"
      >
        <Body href={href}>{profilePost.bodyHtml}</Body>
      </Card>
    );
  }

  const { thread, post } = item;
  const isThread = item.type === "thread";
  const threadHref = `/threads/${thread.id}`;
  const href = isThread ? threadHref : `${threadHref}#post-${post.id}`;
  const card = threadCard(thread, (id) => author(id).member);
  return (
    <Card
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
        <ReactionButton
          action={react.bind(null, "post", post.id)}
          total={post.reactions.total}
          viewerTypeId={post.reactions.mine}
          types={picker}
          viewerId={viewerId}
          authorId={post.author.id}
        />
      }
      summary={
        <ReactionSummary
          reactions={reactionsView(post.reactions, reactionTypes)}
          loadUsers={loadReactionUsers.bind(null, "post", post.id)}
          className="ml-auto"
        />
      }
      href={href}
      count={thread.replyCount}
      noun="replies"
      views={isThread ? thread.viewCount : undefined}
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
