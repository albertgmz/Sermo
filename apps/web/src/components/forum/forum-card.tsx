import Link from "next/link";
import { useTranslations } from "next-intl";
import { Art } from "@/components/forum/art";
import { ForumIcon } from "@/components/forum/forum-icon";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { Badge } from "@/components/ui/badge";
import type { MemberView, PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// What the card needs of a forum: a node from the backend is mapped to it on the forum list.
export type ForumCardData = {
  id: number;
  title: string;
  icon: string;
  /** The picture behind the title; none draws the plain card. */
  image: string | null;
  isNew?: boolean;
  /** The forum or one under it holds a thread the viewer has not read. */
  unread?: boolean;
  /** `id` makes the title a link. */
  subforums?: { id?: number; title: string }[];
  threadCount: number;
  postCount: number;
  lastPost: {
    threadId: number;
    threadTitle: string;
    prefix: PrefixView | null;
    createdAt: string;
    author: { username: string; member: MemberView };
  } | null;
};

const quietClass = "text-xs text-muted-foreground";

// The photo fills the upper part at full strength. Only the side the title
// sits on is darkened, and the last post has a plain footer of its own, so
// the text keeps its contrast on the brightest picture.
export function ForumCard({
  forum,
  className,
}: {
  forum: ForumCardData;
  className?: string;
}) {
  const t = useTranslations("forum.forumCard");
  const last = forum.lastPost;
  return (
    <li
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-md border bg-card has-[[data-forum-link]:focus-visible]:ring-2 has-[[data-forum-link]:focus-visible]:ring-ring",
        className,
      )}
    >
      <div className="relative isolate flex min-h-20 flex-1 items-center gap-3 overflow-hidden px-3 py-3 md:min-h-24">
        {forum.image && (
          <Art
            category="forumArt"
            src={forum.image}
            className="absolute inset-0 -z-20 transition-transform duration-300 motion-safe:group-focus-within:scale-[1.03] motion-safe:group-hover:scale-[1.03]"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-r from-background/95 from-25% via-background/75 via-60% to-background/10"
        />
        <ForumIcon
          name={forum.icon}
          className={cn("size-5 shrink-0", forum.unread && "text-primary-ink")}
        />
        <div className="max-w-[70%] min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className={cn(
                "min-w-0 truncate text-sm",
                forum.unread ? "font-bold" : "font-medium",
              )}
            >
              <Link
                href={`/forums/${forum.id}`}
                data-forum-link=""
                className="outline-none after:absolute after:inset-0"
              >
                {forum.title}
                {forum.unread && (
                  <span className="sr-only"> {t("unread")}</span>
                )}
              </Link>
            </h3>
            {forum.isNew && <Badge>{t("newBadge")}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/80 tabular-nums">
            {t("threads", { count: forum.threadCount })}
            <span aria-hidden="true"> · </span>
            {t("messages", { count: forum.postCount })}
            {forum.subforums?.map((subforum) => (
              <span key={subforum.id ?? subforum.title}>
                <span aria-hidden="true"> · </span>
                {subforum.id === undefined ? (
                  subforum.title
                ) : (
                  <Link
                    href={`/forums/${subforum.id}`}
                    className="relative z-10 after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline"
                  >
                    {subforum.title}
                  </Link>
                )}
              </span>
            ))}
          </p>
        </div>
      </div>
      {last ? (
        <div className="flex h-10 items-center gap-2 border-t px-3">
          <UserAvatar
            user={last.author.member}
            size="sm"
            className="relative after:absolute after:-inset-2"
          />
          <Link
            href={`/threads/${last.threadId}`}
            className="flex h-10 min-w-0 flex-1 items-center gap-1.5 text-xs font-medium hover:underline"
          >
            {last.prefix && <PrefixTag prefix={last.prefix} />}
            <span className="truncate">{last.threadTitle}</span>
          </Link>
          <p
            className={cn(
              "flex h-10 max-w-[55%] shrink-0 items-center gap-1",
              quietClass,
            )}
          >
            <RelativeTime date={last.createdAt} className="shrink-0" />
            <span aria-hidden="true">·</span>
            <UserLink
              user={last.author.member}
              className="flex h-10 min-w-0 items-center"
            >
              <span className="truncate">{last.author.username}</span>
            </UserLink>
          </p>
        </div>
      ) : (
        <p className={cn("flex h-10 items-center border-t px-3", quietClass)}>
          {t("empty")}
        </p>
      )}
    </li>
  );
}
