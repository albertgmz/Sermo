import Link from "next/link";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { NotificationView } from "@/lib/db";
import { cn } from "@/lib/utils";

export function NotificationRow({
  item,
  size = "md",
}: {
  item: Pick<
    NotificationView,
    "href" | "read" | "actor" | "text" | "createdAt"
  > & { prefix?: NotificationView["prefix"] };
  size?: "md" | "lg";
}) {
  const titleStart = item.text.indexOf("“") + 1;
  return (
    <div
      className={cn(
        "relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
        !item.read && "bg-primary/5",
      )}
    >
      <UserAvatar user={item.actor} size={size} link={false} />
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        <UserLink user={item.actor} className="relative z-10" />{" "}
        <Link
          href={item.href}
          className={cn(
            "after:absolute after:inset-0",
            item.read && "text-muted-foreground",
          )}
        >
          {item.prefix && titleStart > 0 ? (
            <>
              {item.text.slice(0, titleStart)}
              <PrefixTag
                prefix={item.prefix}
                className="mr-1.5 align-(--prefix-offset)"
              />
              {item.text.slice(titleStart)}
            </>
          ) : (
            item.text
          )}
        </Link>
        <RelativeTime
          date={item.createdAt}
          className="mt-0.5 block text-xs text-muted-foreground"
        />
      </span>
      {!item.read && <UnreadDot className="mt-1.5" />}
    </div>
  );
}
