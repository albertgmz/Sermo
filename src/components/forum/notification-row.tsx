import Link from "next/link";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
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
    <Link
      href={item.href}
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
        !item.read && "bg-primary/5",
      )}
    >
      <UserAvatar user={item.actor} size={size} link={false} />
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        <span className="font-semibold">{item.actor.username}</span>{" "}
        <span className={item.read ? "text-muted-foreground" : undefined}>
          {item.prefix && titleStart > 0 ? (
            <>
              {item.text.slice(0, titleStart)}
              <PrefixTag
                prefix={item.prefix}
                className="mr-1.5 align-[0.0625rem]"
              />
              {item.text.slice(titleStart)}
            </>
          ) : (
            item.text
          )}
        </span>
        <RelativeTime
          date={item.createdAt}
          className="mt-0.5 block text-xs text-muted-foreground"
        />
      </span>
      {!item.read && <UnreadDot className="mt-1.5" />}
    </Link>
  );
}
