import Link from "next/link";
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
  >;
  size?: "md" | "lg";
}) {
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
          {item.text}
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
