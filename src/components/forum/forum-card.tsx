import Link from "next/link";
import { Art } from "@/components/forum/art";
import { ForumIcon } from "@/components/forum/forum-icon";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserHoverCard } from "@/components/forum/user-hover-card";
import { Badge } from "@/components/ui/badge";
import type { ForumView } from "@/lib/db";
import { formatNumber } from "@/lib/format";
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
                href={`/forums/${forum.slug}`}
                data-forum-link=""
                className="outline-none after:absolute after:inset-0"
              >
                {forum.title}
              </Link>
            </h3>
            {forum.isNew && <Badge>New</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/80 tabular-nums">
            {formatNumber(forum.threadCount)}{" "}
            {forum.threadCount === 1 ? "thread" : "threads"}
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
            user={last.author}
            size="sm"
            className="relative after:absolute after:-inset-2"
          />
          <Link
            href={`/threads/${last.threadId}`}
            className="flex h-10 min-w-0 flex-1 items-center text-xs font-medium hover:underline"
          >
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
            <UserHoverCard
              user={last.author}
              className="flex h-10 min-w-0 items-center"
            >
              <span className="truncate">{last.author.username}</span>
            </UserHoverCard>
          </p>
        </div>
      ) : (
        <p className={cn("flex h-10 items-center border-t px-3", quietClass)}>
          No posts yet
        </p>
      )}
    </li>
  );
}
