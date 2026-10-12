import Link from "next/link";
import { useTranslations } from "next-intl";
import { Art } from "@/components/forum/art";
import { ForumIcon } from "@/components/forum/forum-icon";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { Badge } from "@/components/ui/badge";
import type { ForumView } from "@/lib/db";
import { cn } from "@/lib/utils";

const quietClass = "text-xs text-muted-foreground";

// The photo fills the upper part at full strength. Only the side the title
// sits on is darkened, and the last post has a plain footer of its own, so
// the text keeps its contrast on the brightest picture.
export function ForumCard({
  forum,
  className,
}: {
  forum: ForumView;
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
        <Art
          category="forumArt"
          src={forum.image}
          className="absolute inset-0 -z-20 transition-transform duration-300 group-focus-within:scale-[1.03] group-hover:scale-[1.03] motion-reduce:transition-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-r from-background/95 from-25% via-background/75 via-60% to-background/10"
        />
        <ForumIcon name={forum.icon} className="size-5 shrink-0" />
        <div className="max-w-[70%] min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold">
              <Link
                href={`/forums/${forum.id}`}
                data-forum-link=""
                className="outline-none after:absolute after:inset-0"
              >
                {forum.title}
              </Link>
            </h3>
            {forum.isNew && <Badge>{t("newBadge")}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/80 tabular-nums">
            {t("threads", { count: forum.threadCount })}
            {forum.subforums?.map((subforum) => (
              <span key={subforum.title}>
                <span aria-hidden="true"> · </span>
                {subforum.title}
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
