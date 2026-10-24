import { Eye, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Art } from "@/components/forum/art";
import { MemberCardScope } from "@/components/forum/member-card-scope";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { formatCompact, formatDate } from "@/lib/format";
import type { MemberView, PictureView, PrefixView } from "@/lib/sermo/views";

// What the card needs of a thread: a thread from the backend is mapped to it by `threadCard` in
// lib/sermo/threads.ts.
export type ThreadCardData = {
  id: number;
  title: string;
  prefix: PrefixView | null;
  /** Plain text the backend wrote; it names no picture. */
  excerpt: string;
  createdAt: string;
  views: number;
  replyCount: number;
  coverPicture: PictureView | null;
  forum: { id: number; title: string };
  author: { member: MemberView };
  lastPost: { createdAt: string; author: { member: MemberView } };
};

// A link to the thread that previews it on hover or keyboard focus. Touch
// devices get the plain link.
export function ThreadHoverCard({
  thread,
  href,
  className,
  children,
}: {
  thread: ThreadCardData;
  // Where the link leads, from `threadOpenHref`.
  href: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.threadHoverCard");
  const last = thread.lastPost;
  return (
    <HoverCard>
      <HoverCardTrigger render={<Link href={href} className={className} />}>
        {children ?? (
          <>
            {thread.prefix && (
              <PrefixTag
                prefix={thread.prefix}
                className="mr-1.5 align-(--prefix-offset)"
              />
            )}
            {thread.title}
          </>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        <MemberCardScope disabled>
          {thread.coverPicture && (
            <Art
              category="threadCovers"
              src={thread.coverPicture.url}
              className="aspect-[4/1] w-full rounded-t-[inherit] border-b"
            />
          )}
          <div className="p-3">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <Link
                href={`/forums/${thread.forum.id}`}
                className="font-medium underline-offset-4 hover:text-foreground hover:underline"
              >
                {thread.forum.title}
              </Link>
            </p>
            <p className="mt-1.5 text-sm leading-snug font-semibold [overflow-wrap:anywhere]">
              {thread.prefix && (
                <PrefixTag
                  prefix={thread.prefix}
                  className="mr-1.5 align-(--prefix-offset)"
                />
              )}
              {thread.title}
            </p>
            <p className="mt-1 line-clamp-3 text-(length:--text-compact) text-muted-foreground [overflow-wrap:anywhere]">
              {thread.excerpt}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <UserAvatar user={thread.author.member} size="sm" />
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                <UserLink user={thread.author.member} /> ·{" "}
                <time dateTime={thread.createdAt}>
                  {formatDate(thread.createdAt, locale)}
                </time>
              </p>
            </div>
          </div>
          <dl className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground tabular-nums">
            <div className="flex items-center gap-1">
              <dt>
                <MessageCircle aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("aria.replies")}</span>
              </dt>
              <dd>{formatCompact(thread.replyCount, locale)}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt>
                <Eye aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("aria.views")}</span>
              </dt>
              <dd>{formatCompact(thread.views, locale)}</dd>
            </div>
            {thread.replyCount > 0 && (
              <div className="ml-auto flex min-w-0 gap-1">
                <dt className="shrink-0">{t("lastReply")}</dt>
                <dd className="truncate">
                  <RelativeTime date={last.createdAt} /> ·{" "}
                  <UserLink user={last.author.member} />
                </dd>
              </div>
            )}
          </dl>
        </MemberCardScope>
      </HoverCardContent>
    </HoverCard>
  );
}
