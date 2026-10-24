import { Eye, Lock, MessageCircle, Pin } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { pageCount } from "@/app/[locale]/(main)/threads/[id]/pages";
import { Art } from "@/components/forum/art";
import { ThreadPageLinks } from "@/components/forum/page-nav";
import { PollBadge } from "@/components/forum/poll-badge";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { ThreadTick } from "@/components/staff/thread-batch";
import { formatCompact } from "@/lib/format";
import type { membersFor } from "@/lib/sermo/members";
import { threadOpenHref } from "@/lib/sermo/open-links";
import { type ApiThread, threadCard } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

// One row of a forum's list of threads.
export function ThreadRow({
  thread,
  member,
  highlighted,
  signedIn,
  showForum = false,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
  highlighted: boolean;
  // Whether the viewer is a member: the thread opens where they left off (`threadOpenHref`).
  signedIn: boolean;
  // Threads of several forums share the list (a tag's page): the forum is named.
  showForum?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("forums.forum");
  const format = useFormatter();
  const now = useNow();
  const card = threadCard(thread, member);
  const href = threadOpenHref(thread.id, signedIn);
  return (
    <div
      data-shortcut-item=""
      className={cn(
        "relative isolate flex scroll-mt-4 items-center gap-3 px-3 py-2.5 md:px-4",
        highlighted &&
          "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      <ThreadTick id={thread.id} title={card.title} />
      {card.coverPicture && (
        <Art
          category="threadCovers"
          src={card.coverPicture.url}
          className="absolute inset-y-0 right-0 -z-10 w-2/3 opacity-25 [mask-image:linear-gradient(to_left,black,transparent)] md:w-1/2"
        />
      )}
      <UserAvatar
        user={card.author.member}
        size="lg"
        className="relative z-10"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0"
        />
        <ThreadHoverCard
          thread={card}
          href={href}
          className={cn(
            "relative z-10 flex w-fit max-w-full items-start gap-1.5 text-sm hover:underline",
            thread.isUnread ? "font-bold" : "font-medium",
          )}
        >
          {thread.isUnread && <UnreadDot className="mt-1.5" />}
          {thread.isSticky && (
            <Pin
              aria-label={t("aria.pinned")}
              className="mt-0.5 size-3.5 shrink-0 text-primary-ink"
            />
          )}
          {thread.isLocked && (
            <Lock
              aria-label={t("aria.locked")}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <span className="line-clamp-2 [overflow-wrap:anywhere]">
            {card.prefix && (
              <PrefixTag
                prefix={card.prefix}
                className="mr-1.5 align-(--prefix-offset)"
              />
            )}
            {card.title}
            {highlighted && (
              <span className="sr-only">{t("aria.highlighted")}</span>
            )}
          </span>
        </ThreadHoverCard>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {thread.pollKind && (
            <PollBadge kind={thread.pollKind} className="h-5 shrink-0" />
          )}
          <p className="min-w-0 truncate">
            {t.rich(showForum ? "createdIn" : "created", {
              forum: () => (
                <Link
                  href={`/forums/${thread.node.id}`}
                  className="relative z-10 hover:underline"
                >
                  {thread.node.title}
                </Link>
              ),
              author: () => (
                <UserLink user={card.author.member} className="relative z-10" />
              ),
              time: format.relativeTime(new Date(thread.createdAt), now),
            })}
          </p>
          <ThreadPageLinks
            threadId={thread.id}
            pages={pageCount(thread.lastPost.position)}
          />
        </div>
      </div>
      <dl className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground tabular-nums sm:flex-row sm:gap-0">
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <MessageCircle aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("aria.replies")}</span>
          </dt>
          <dd>{formatCompact(card.replyCount, locale)}</dd>
        </div>
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <Eye aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("aria.views")}</span>
          </dt>
          <dd>{formatCompact(card.views, locale)}</dd>
        </div>
      </dl>
      <p className="hidden w-52 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
        {t.rich("lastPost", {
          time: format.relativeTime(new Date(card.lastPost.createdAt), now),
          author: () => (
            <UserLink
              user={card.lastPost.author.member}
              className="relative z-10"
            />
          ),
        })}
      </p>
    </div>
  );
}
